package io.legado.validator.debug

import io.legado.validator.analyzeRule.AnalyzeUrl
import io.legado.validator.analyzeRule.AnalyzeRule
import io.legado.validator.analyzeRule.RuleData
import io.legado.validator.help.WebViewNotSupportedException
import io.legado.validator.help.http.StrResponse
import io.legado.validator.model.*
import io.legado.validator.probe.AndroidProbeService
import io.legado.validator.probe.ProbeRenderRequest
import io.legado.validator.render.RenderService
import io.legado.validator.webBook.BookChapterList
import io.legado.validator.webBook.BookContent
import io.legado.validator.webBook.BookList
import io.legado.validator.webBook.WebBook
import kotlinx.coroutines.*
import java.util.concurrent.ConcurrentLinkedQueue

class DebugService {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val steps = ConcurrentLinkedQueue<DebugStep>()
    private var listener: ((DebugStep) -> Unit)? = null

    fun onStep(listener: (DebugStep) -> Unit) {
        this.listener = listener
    }

    fun getSteps(): List<DebugStep> = steps.toList()

    private fun collectWarnings(source: BookSource, analyzeUrl: AnalyzeUrl? = null): List<DebugStep.CompatibilityWarning> {
        val warnings = mutableListOf<DebugStep.CompatibilityWarning>()
        if (source.enabledCookieJar == true) {
            warnings.add(DebugStep.CompatibilityWarning(
                "cookieJar", "源启用了 enabledCookieJar，validator 无持久 Cookie，结果可能与 App 不一致"
            ))
        }
        if (!source.jsLib.isNullOrBlank()) {
            warnings.add(DebugStep.CompatibilityWarning(
                "jsLib", "源使用了 jsLib，validator 已尝试加载但复杂依赖可能不完整"
            ))
        }
        if (!source.loginUrl.isNullOrBlank()) {
            warnings.add(DebugStep.CompatibilityWarning(
                "loginUrl", "源定义了登录流程，validator 无法执行登录"
            ))
        }
        if (analyzeUrl?.hasWebView == true) {
            warnings.add(DebugStep.CompatibilityWarning(
                "webView", "URL 包含 webView:true，validator 无法执行 WebView 渲染"
            ))
        }
        return warnings
    }

    private fun DebugStep.withWarnings(warnings: List<DebugStep.CompatibilityWarning>): DebugStep {
        val allWarnings = warnings.toMutableList()
        var needsReview = this.needsAppReview
        var reviewRsn = this.reviewReason
        // 检查当前步骤的 AnalyzeUrl 是否有 webView:true
        if (WebBook.lastAnalyzeUrl?.hasWebView == true) {
            if (allWarnings.none { it.feature == "webView" }) {
                allWarnings.add(DebugStep.CompatibilityWarning(
                    "webView", "URL 包含 webView:true，validator 无法执行 WebView 渲染"
                ))
            }
            needsReview = true
            reviewRsn = reviewRsn ?: "URL 包含 webView:true，需 App/WebView 复核"
        }
        return copy(
            compatibilityWarnings = allWarnings.ifEmpty { null },
            needsAppReview = needsReview,
            reviewReason = reviewRsn
        )
    }

    suspend fun runFull(source: BookSource, keyword: String, mode: String = "http"): List<DebugStep> {
        steps.clear()
        val book = Book()
        val warnings = collectWarnings(source)

        // Step 1: Search
        val searchStep = (when (mode) {
            "android" -> runSearchAndroid(source, keyword)
            "browser" -> runSearchBrowser(source, keyword)
            else -> { // "http" or "auto"
                // auto: check if searchUrl requires WebView before trying HTTP
                if (mode == "auto") {
                    val searchAnalyzeUrl = AnalyzeUrl(
                        mUrl = source.searchUrl ?: "", key = keyword, page = 1, source = source
                    )
                    if (searchAnalyzeUrl.hasWebView) {
                        // webView:true → try Android first, then browser, then give up
                        val androidStep = runSearchAndroid(source, keyword)
                        if (androidStep.status == "success") androidStep
                        else {
                            val browserStep = runSearchBrowser(source, keyword)
                            if (browserStep.status == "success") browserStep else androidStep
                        }
                    } else {
                        val httpStep = runSearch(source, keyword)
                        when {
                            httpStep.status == "success" -> httpStep
                            httpStep.needsAppReview -> {
                                val androidStep = runSearchAndroid(source, keyword)
                                if (androidStep.status == "success") androidStep else httpStep
                            }
                            else -> {
                                val browserStep = runSearchBrowser(source, keyword)
                                if (browserStep.status == "success") browserStep else httpStep
                            }
                        }
                    }
                } else {
                    runSearch(source, keyword)
                }
            }
        }).withWarnings(warnings)
        steps.add(searchStep)
        listener?.invoke(searchStep)
        if (searchStep.status == "error") return steps.toList()

        // 后续步骤继承 search 的实际模式
        val actualMode = searchStep.mode

        val firstBook = searchStep.extracted["firstBook"] as? SearchBook ?: return steps.toList()
        book.bookUrl = firstBook.bookUrl
        book.name = firstBook.name
        book.author = firstBook.author
        book.tocUrl = firstBook.bookUrl

        // Step 2: Detail
        val detailStep = runDetail(source, book, actualMode).withWarnings(warnings)
        steps.add(detailStep)
        listener?.invoke(detailStep)
        if (detailStep.status == "error") return steps.toList()

        // Step 3: TOC
        val tocStep = runToc(source, book, actualMode).withWarnings(warnings)
        steps.add(tocStep)
        listener?.invoke(tocStep)
        if (tocStep.status == "error") return steps.toList()

        val chapters = tocStep.extracted["chapters"] as? List<BookChapter> ?: emptyList()

        // Step 4: Content (first 2 chapters)
        for (ch in chapters.take(2)) {
            val contentStep = if (actualMode == "android") {
                runContentAndroid(source, book, ch)
            } else {
                runContent(source, book, ch, actualMode)
            }.withWarnings(warnings)
            steps.add(contentStep)
            listener?.invoke(contentStep)
        }

        return steps.toList()
    }

    private fun toRuleHits(entries: List<AnalyzeRule.RuleHitEntry>): List<DebugStep.RuleHit> {
        return entries.map { DebugStep.RuleHit(it.field, "${it.mode}:${it.rule}", it.value, it.success) }
    }

    private fun buildResponseInfo(res: StrResponse?): DebugStep.ResponseInfo? {
        if (res == null) return null
        val bodyPreview = res.body.take(2000)
        val contentType = res.headers["Content-Type"]
        return DebugStep.ResponseInfo(
            code = res.code,
            contentType = contentType,
            bodyPreview = bodyPreview,
            bodyLength = res.body.length
        )
    }

    private fun buildRequestInfo(): DebugStep.RequestInfo? {
        val aUrl = WebBook.lastAnalyzeUrl ?: return null
        return DebugStep.RequestInfo(
            url = aUrl.url,
            method = if (aUrl.isPost()) "POST" else "GET",
            headers = aUrl.headerMap,
            body = aUrl.body
        )
    }

    private fun makeHttpError(res: StrResponse?, phase: String): String {
        if (res == null) return "${phase}失败: 无响应"
        val code = res.code
        val snippet = res.body.take(500)
        val headers = res.headers
        return when {
            code == 403 && headers["Cf-Mitigated"]?.contains("challenge") == true ->
                "HTTP 403 — Cloudflare 反爬拦截 (Cf-Mitigated: challenge)，需浏览器/App 复核"
            snippet.contains("challenges.cloudflare.com/turnstile", ignoreCase = true)
                || snippet.contains("turnstile.render", ignoreCase = true) ->
                "Cloudflare Turnstile 验证页，需浏览器/App 复核"
            snippet.contains("Just a moment", ignoreCase = true) ->
                "Cloudflare challenge 页面，需浏览器/App 复核"
            snippet.contains("captcha", ignoreCase = true) ->
                "需要验证码，需浏览器/App 复核"
            code == 403 -> "HTTP 403 Forbidden"
            code == 404 -> "HTTP 404 Not Found"
            code == 503 -> "HTTP 503 Service Unavailable"
            code >= 400 -> "HTTP $code"
            else -> "HTTP $code, 响应体前200字: ${res.body.take(200)}"
        }
    }

    private suspend fun runSearch(source: BookSource, keyword: String): DebugStep {
        return withContext(Dispatchers.IO) {
            try {
                WebBook.clearState()
                val books = WebBook.searchBookAwait(source, keyword)
                val res = WebBook.lastResponse
                val first = books.firstOrNull()
                val reqInfo = buildRequestInfo()
                val resInfo = buildResponseInfo(res)

                if (first != null) {
                    DebugStep(
                        phase = "search", status = "success",
                        request = reqInfo, response = resInfo,
                        ruleHits = toRuleHits(WebBook.lastRuleHits),
                        extracted = mapOf(
                            "resultCount" to books.size,
                            "firstBook" to first,
                            "books" to books.take(10)
                        )
                    )
                } else {
                    val errorMsg = if (res != null) {
                        val snippet = res.body.take(500)
                        when {
                            snippet.contains("challenges.cloudflare.com/turnstile", ignoreCase = true)
                                || snippet.contains("turnstile.render", ignoreCase = true) ->
                                "Cloudflare Turnstile 验证页，需浏览器/App 复核"
                            snippet.contains("Just a moment", ignoreCase = true) ->
                                "Cloudflare challenge 页面，需浏览器/App 复核"
                            res.code != 200 -> makeHttpError(res, "搜索")
                            else -> "搜索结果为空 (HTTP ${res.code}, 列表大小:0)"
                        }
                    } else "搜索结果为空"
                    DebugStep(
                        phase = "search", status = "error",
                        request = reqInfo, response = resInfo,
                        error = errorMsg
                    )
                }
            } catch (e: WebViewNotSupportedException) {
                DebugStep(
                    phase = "search", status = "error",
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    error = e.message,
                    needsAppReview = true,
                    reviewReason = e.message
                )
            } catch (e: Exception) {
                DebugStep(
                    phase = "search", status = "error",
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    error = "${e::class.simpleName}: ${e.message}"
                )
            }
        }
    }

    private suspend fun runSearchBrowser(source: BookSource, keyword: String): DebugStep {
        return withContext(Dispatchers.IO) {
            WebBook.clearState()
            val ruleData = RuleData()
            val searchUrlTemplate = source.searchUrl ?: ""
            val analyzeUrl = AnalyzeUrl(
                mUrl = searchUrlTemplate,
                key = keyword,
                page = 1,
                baseUrl = source.bookSourceUrl,
                source = source,
                ruleData = ruleData
            )

            val reqInfo = DebugStep.RequestInfo(
                url = analyzeUrl.url,
                method = if (analyzeUrl.isPost()) "POST" else "GET",
                headers = analyzeUrl.headerMap,
                body = analyzeUrl.body
            )

            // POST 请求：浏览器模式暂不支持，标记需 App 复核
            if (analyzeUrl.isPost()) {
                return@withContext DebugStep(
                    phase = "search", status = "error", mode = "browser",
                    request = reqInfo,
                    error = "浏览器模式暂不支持 POST 搜索，需 App 复核",
                    needsAppReview = true,
                    reviewReason = "POST 搜索需 App 复核"
                )
            }

            // GET 请求：让 Python 端用 quote() 编码中文关键词，避免 Java→Python 编码不一致
            val render = RenderService.render(
                url = analyzeUrl.url,
                searchKeyword = keyword,
                searchUrlTemplate = searchUrlTemplate
            )

            if (!render.ok) {
                return@withContext DebugStep(
                    phase = "search", status = "error", mode = "browser",
                    request = reqInfo,
                    error = render.error ?: "浏览器渲染失败",
                    finalUrl = render.finalUrl,
                    renderedHtmlPreview = render.html?.take(2000),
                    screenshotBase64 = render.screenshot,
                    renderError = render.error,
                    needsAppReview = render.needsAppReview,
                    reviewReason = render.reviewReason
                )
            }

            // Cloudflare/验证码检测
            if (render.needsAppReview) {
                return@withContext DebugStep(
                    phase = "search", status = "error", mode = "browser",
                    request = reqInfo,
                    error = render.reviewReason ?: "需 App 复核",
                    finalUrl = render.finalUrl,
                    renderedHtmlPreview = render.html?.take(2000),
                    screenshotBase64 = render.screenshot,
                    needsAppReview = true,
                    reviewReason = render.reviewReason
                )
            }

            // 用书源规则解析渲染后的 HTML
            val html = render.html ?: ""
            val baseUrl = render.finalUrl ?: analyzeUrl.url
            try {
                val books = BookList.analyzeBookList(
                    bookSource = source,
                    ruleData = ruleData,
                    analyzeUrl = analyzeUrl,
                    baseUrl = baseUrl,
                    body = html,
                    isSearch = true
                )
                val first = books.firstOrNull()
                if (first != null) {
                    DebugStep(
                        phase = "search", status = "success", mode = "browser",
                        request = reqInfo,
                        extracted = mapOf(
                            "resultCount" to books.size,
                            "firstBook" to first,
                            "books" to books.take(10)
                        ),
                        finalUrl = render.finalUrl,
                        renderedHtmlPreview = html.take(2000),
                        screenshotBase64 = render.screenshot
                    )
                } else {
                    DebugStep(
                        phase = "search", status = "error", mode = "browser",
                        request = reqInfo,
                        error = "浏览器渲染成功但规则解析无结果 (列表大小:0)",
                        finalUrl = render.finalUrl,
                        renderedHtmlPreview = html.take(2000),
                        screenshotBase64 = render.screenshot
                    )
                }
            } catch (e: Exception) {
                DebugStep(
                    phase = "search", status = "error", mode = "browser",
                    request = reqInfo,
                    error = "规则解析异常: ${e::class.simpleName}: ${e.message}",
                    finalUrl = render.finalUrl,
                    renderedHtmlPreview = html.take(2000),
                    screenshotBase64 = render.screenshot,
                    renderError = e.message
                )
            }
        }
    }

    private suspend fun runDetail(source: BookSource, book: Book, mode: String = "http"): DebugStep {
        return withContext(Dispatchers.IO) {
            try {
                WebBook.clearState()
                val result = WebBook.getBookInfoAwait(source, book)
                val res = WebBook.lastResponse
                DebugStep(
                    phase = "detail", status = "success", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(res),
                    ruleHits = toRuleHits(WebBook.lastRuleHits),
                    extracted = mapOf(
                        "name" to result.name,
                        "author" to result.author,
                        "coverUrl" to result.coverUrl,
                        "intro" to result.intro?.take(200),
                        "tocUrl" to result.tocUrl
                    )
                )
            } catch (e: WebViewNotSupportedException) {
                DebugStep(
                    phase = "detail", status = "error", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    error = e.message,
                    needsAppReview = true,
                    reviewReason = e.message
                )
            } catch (e: Exception) {
                DebugStep(
                    phase = "detail", status = "error", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    error = "${e::class.simpleName}: ${e.message}"
                )
            }
        }
    }

    private suspend fun runToc(source: BookSource, book: Book, mode: String = "http"): DebugStep {
        return withContext(Dispatchers.IO) {
            try {
                WebBook.clearState()
                val chapters = WebBook.getChapterListAwait(source, book)
                val res = WebBook.lastResponse
                DebugStep(
                    phase = "toc", status = "success", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(res),
                    ruleHits = toRuleHits(BookChapterList.lastRuleHits),
                    extracted = mapOf(
                        "chapterCount" to chapters.size,
                        "chapters" to chapters,
                        "first5" to chapters.take(5).map { mapOf("title" to it.title, "url" to it.url) }
                    )
                )
            } catch (e: WebViewNotSupportedException) {
                DebugStep(
                    phase = "toc", status = "error", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    error = e.message,
                    needsAppReview = true,
                    reviewReason = e.message
                )
            } catch (e: Exception) {
                DebugStep(
                    phase = "toc", status = "error", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    error = "${e::class.simpleName}: ${e.message}"
                )
            }
        }
    }

    private suspend fun runContent(source: BookSource, book: Book, chapter: BookChapter, mode: String = "http"): DebugStep {
        return withContext(Dispatchers.IO) {
            try {
                WebBook.clearState()
                val content = WebBook.getContentAwait(source, book, chapter)
                val res = WebBook.lastResponse
                DebugStep(
                    phase = "content", status = "success", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(res),
                    ruleHits = toRuleHits(BookContent.lastRuleHits),
                    extracted = mapOf(
                        "chapterTitle" to chapter.title,
                        "contentLength" to content.length
                    ),
                    preview = content.take(500)
                )
            } catch (e: WebViewNotSupportedException) {
                DebugStep(
                    phase = "content", status = "error", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    error = e.message,
                    needsAppReview = true,
                    reviewReason = e.message
                )
            } catch (e: Exception) {
                DebugStep(
                    phase = "content", status = "error", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    error = "${e::class.simpleName}: ${e.message}"
                )
            }
        }
    }

    private suspend fun runSearchAndroid(source: BookSource, keyword: String): DebugStep {
        return withContext(Dispatchers.IO) {
            val probeInfo = AndroidProbeService.probeCheck()
            if (!probeInfo.available) {
                return@withContext DebugStep(
                    phase = "search", status = "error", mode = "android",
                    error = "Android Probe 不可用: ${probeInfo.error}",
                    probeAvailable = false
                )
            }
            val searchUrl = source.searchUrl ?: ""
            val analyzeUrl = AnalyzeUrl(mUrl = searchUrl, key = keyword, page = 1, source = source)
            val needsWebView = analyzeUrl.hasWebView
            try {
                WebBook.clearState()
                if (needsWebView) {
                    val probeReq = ProbeRenderRequest(
                        url = analyzeUrl.url, headers = analyzeUrl.headerMap,
                        timeout = 60000L, screenshot = true
                    )
                    val probeRes = AndroidProbeService.render(probeReq)
                    if (!probeRes.ok) {
                        return@withContext DebugStep(
                            phase = "search", status = "error", mode = "android",
                            error = "Probe 搜索渲染失败: ${probeRes.error}",
                            probeAvailable = true, probeDevice = probeInfo.device?.serial,
                            androidWebViewVersion = probeInfo.webViewVersion,
                            webViewHtmlPreview = probeRes.html?.take(2000),
                            webViewScreenshotBase64 = probeRes.screenshotBase64
                        )
                    }
                    val ruleData = io.legado.validator.analyzeRule.RuleData()
                    val analyzeRule = io.legado.validator.analyzeRule.AnalyzeRule(ruleData, source)
                    analyzeRule.setContent(probeRes.html ?: "", analyzeUrl.url)
                    val searchRule = source.getSearchRule()
                    val elements = analyzeRule.getElements(searchRule.bookList ?: "")
                    val books = elements.mapNotNull { element ->
                        analyzeRule.setContent(element)
                        val name = analyzeRule.getString(searchRule.name)
                        if (name.isBlank()) null
                        else io.legado.validator.model.SearchBook(
                            bookUrl = analyzeRule.getString(searchRule.bookUrl, isUrl = true),
                            name = name, author = analyzeRule.getString(searchRule.author),
                            coverUrl = analyzeRule.getString(searchRule.coverUrl),
                            intro = analyzeRule.getString(searchRule.intro)
                        )
                    }
                    val first = books.firstOrNull()
                    if (first != null) DebugStep(
                        phase = "search", status = "success", mode = "android",
                        extracted = mapOf("resultCount" to books.size, "firstBook" to first, "books" to books.take(10)),
                        probeAvailable = true, probeDevice = probeInfo.device?.serial,
                        androidWebViewVersion = probeInfo.webViewVersion,
                        webViewHtmlPreview = probeRes.html?.take(2000),
                        webViewScreenshotBase64 = probeRes.screenshotBase64
                    ) else DebugStep(
                        phase = "search", status = "error", mode = "android",
                        error = "Probe 搜索渲染成功但未提取到结果",
                        probeAvailable = true, probeDevice = probeInfo.device?.serial,
                        androidWebViewVersion = probeInfo.webViewVersion,
                        webViewHtmlPreview = probeRes.html?.take(2000),
                        webViewScreenshotBase64 = probeRes.screenshotBase64
                    )
                } else {
                    val books = WebBook.searchBookAwait(source, keyword)
                    val res = WebBook.lastResponse
                    val first = books.firstOrNull()
                    val reqInfo = buildRequestInfo()
                    val resInfo = buildResponseInfo(res)
                    if (first != null) DebugStep(
                        phase = "search", status = "success", mode = "android",
                        request = reqInfo, response = resInfo,
                        ruleHits = toRuleHits(WebBook.lastRuleHits),
                        extracted = mapOf("resultCount" to books.size, "firstBook" to first, "books" to books.take(10)),
                        probeAvailable = true, probeDevice = probeInfo.device?.serial,
                        androidWebViewVersion = probeInfo.webViewVersion
                    ) else DebugStep(
                        phase = "search", status = "error", mode = "android",
                        request = reqInfo, response = resInfo, error = "搜索结果为空",
                        probeAvailable = true, probeDevice = probeInfo.device?.serial,
                        androidWebViewVersion = probeInfo.webViewVersion
                    )
                }
            } catch (e: Exception) {
                DebugStep(
                    phase = "search", status = "error", mode = "android",
                    error = "${e::class.simpleName}: ${e.message}",
                    probeAvailable = true, probeDevice = probeInfo.device?.serial,
                    androidWebViewVersion = probeInfo.webViewVersion
                )
            }
        }
    }

    private suspend fun runContentAndroid(source: BookSource, book: Book, chapter: BookChapter): DebugStep {
        return withContext(Dispatchers.IO) {
            val probeInfo = AndroidProbeService.probeCheck()
            if (!probeInfo.available) {
                return@withContext DebugStep(
                    phase = "content", status = "error", mode = "android",
                    error = "Android Probe 不可用: ${probeInfo.error}",
                    probeAvailable = false
                )
            }
            try {
                val contentRule = source.getContentRule()
                val webJs = contentRule.webJs
                val probeReq = ProbeRenderRequest(
                    url = chapter.url,
                    headers = source.getHeaderMap(),
                    javaScript = webJs,
                    screenshot = true
                )
                val probeRes = AndroidProbeService.render(probeReq)
                if (!probeRes.ok) {
                    return@withContext DebugStep(
                        phase = "content", status = "error", mode = "android",
                        error = probeRes.error ?: "Probe render failed",
                        probeAvailable = true,
                        probeDevice = probeInfo.device?.serial,
                            androidWebViewVersion = probeInfo.webViewVersion,
                            webViewHtmlPreview = probeRes.html?.take(2000),
                        webViewScreenshotBase64 = probeRes.screenshotBase64
                    )
                }
                val analyzeRule = AnalyzeRule(book, source)
                analyzeRule.setContent(probeRes.html ?: "", chapter.url)
                val content = analyzeRule.setFieldName("content").getString(contentRule.content)
                val jsErrMsg = probeRes.jsError
                DebugStep(
                    phase = "content",
                    status = if (content.isBlank() && jsErrMsg != null) "error" else "success",
                    mode = "android",
                    error = if (content.isBlank() && jsErrMsg != null) "webJs 执行错误: $jsErrMsg" else jsErrMsg?.let { "webJs 警告: $it" },
                    extracted = mapOf("chapterTitle" to chapter.title, "contentLength" to content.length),
                    preview = content.take(500),
                    probeAvailable = true,
                    probeDevice = probeInfo.device?.serial,
                    androidWebViewVersion = probeInfo.webViewVersion,
                    webViewHtmlPreview = probeRes.html?.take(2000),
                    webViewScreenshotBase64 = probeRes.screenshotBase64
                )
            } catch (e: Exception) {
                DebugStep(
                    phase = "content", status = "error", mode = "android",
                    error = "${e::class.simpleName}: ${e.message}",
                    probeAvailable = true
                )
            }
        }
    }

    fun cancel() {
        scope.coroutineContext.cancelChildren()
    }
}

fun determineFinalStatus(steps: List<DebugStep>): String {
    val hasNeedsAppReview = steps.any { it.needsAppReview }
    val hasUnsupportedFeature = steps.any { !it.compatibilityWarnings.isNullOrEmpty() }
    val hasProbeUnavailable = steps.any { it.mode == "android" && it.probeAvailable == false }
    val allPassed = steps.all { it.status == "success" }

    return when {
        hasNeedsAppReview -> "needs_app_review"
        hasProbeUnavailable -> "validator_limitation"
        hasUnsupportedFeature && allPassed -> "validator_limitation"
        allPassed -> "passed"
        else -> "failed"
    }
}
