package io.legado.validator.debug

import com.google.gson.Gson
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

internal fun containsAppReviewChallenge(text: String): Boolean {
    return text.contains("challenges.cloudflare.com/turnstile", ignoreCase = true)
        || text.contains("turnstile.render", ignoreCase = true)
        || text.contains("Just a moment", ignoreCase = true)
        || containsCaptchaChallenge(text)
}

internal fun selectSearchEmptyErrorCode(res: StrResponse?): ErrorCode {
    val body = res?.body ?: ""
    return when {
        res != null && containsAppReviewChallenge(body) -> ErrorCode.APP_REVIEW_REQUIRED
        res != null && res.code != 200 -> ErrorCode.HTTP_BLOCKED
        res != null && body.isNotBlank() -> ErrorCode.SEARCH_SELECTOR_EMPTY
        else -> ErrorCode.SEARCH_EMPTY
    }
}

internal fun hasWebViewTrueOption(url: String?): Boolean {
    if (url.isNullOrBlank()) return false
    return Regex("""["']?webView["']?\s*:\s*true""", RegexOption.IGNORE_CASE).containsMatchIn(url)
}

internal fun detectAndroidContentWebViewDeclarationError(source: BookSource, chapter: BookChapter): DebugStep? {
    if (source.getContentRule().webJs.isNullOrBlank()) return null
    if (hasWebViewTrueOption(chapter.url)) return null

    val meta = ErrorCodeRegistry.CHAPTER_URL_MISSING_WEBVIEW_META
    return DebugStep(
        phase = "content",
        status = "error",
        mode = "android",
        request = DebugStep.RequestInfo(url = chapter.url, method = "GET", headers = source.getHeaderMap(), body = null),
        androidBackend = "pc_rule_check",
        androidProbeUsed = false,
        error = meta.messageTemplate,
        errorCode = meta.code.name,
        subphase = meta.subphase.name.lowercase(),
        failedField = meta.failedField,
        allowedFixes = meta.allowedFixes,
        forbiddenFixes = meta.forbiddenFixes,
        evidence = mapOf(
            "chapterUrl" to chapter.url,
            "hasWebJs" to true,
            "mode" to "android"
        )
    )
}

internal fun containsCaptchaChallenge(text: String): Boolean {
    // 只匹配验证码引擎特征词与表单结构，不靠裸词"验证码"——
    // 后者会误命中正文里"输入验证码/验证码错误"等文案，把正常正文页判成 captcha_page。
    val patterns = listOf(
        "recaptcha", "hcaptcha", "geetest", "verify you are a human", "are you a robot",
        "人机验证", "安全验证", "滑块验证"
    )
    if (patterns.any { text.contains(it, ignoreCase = true) }) return true
    val captchaRegexes = listOf(
        Regex("""(?i)(/|_|-|\b)captcha(\.php|\.jpg|\.png|/|_|-|\b)"""),
        Regex("""(?i)(id|class|name)=["'][^"']*captcha[^"']*["']""")
    )
    return captchaRegexes.any { it.containsMatchIn(text) }
}

internal fun classifyHtmlKindExt(html: String?, content: String?): String {
    if (html.isNullOrBlank()) return "empty"
    val lower = html.lowercase()

    // 调用方若已抽到一段足够长的正文，说明规则命中的是真正文：
    // 即便页面引用了 CSR 框架资源 / 含登录入口 / 含付费词，也不应判成空壳/锁页。
    // CSR 空壳的客观特征是"几乎没有正文、主要是 JS 脚手架"，不是"引用了 Next/Nuxt"。
    val hasRealContent = !content.isNullOrBlank() && content.length >= 50

    // CSR 空壳检测
    // 注意：__next/_next/static/<div id="app"></div> 等是通用前端模板，SSR 水合页也会引用，
    // 仅凭这些词命中会把"正文已渲染、只是选择器写错"的页面误判成空壳，误导 AI 去加 webView
    // 而不是修选择器。因此叠加正文护栏：已抽到正文就不判空壳，让它落到 CONTENT_SELECTOR_EMPTY。
    if (!hasRealContent) {
        val csrShells = listOf(
            "import.meta.url", "__nuxt", "__vite", "vite_is_modern",
            "window.__nuxt__", """<div id="__nuxt">""", """<div id="app"></div>""",
            """id="__next"""", "_next/static", "webpackJsonp"
        )
        if (csrShells.any { lower.contains(it, ignoreCase = true) }) return "csr_shell"
    }

    // 登录页检测
    // 大型页面（>25KB）即使含登录表单也优先判定为 reader_page——登录表单常出现在页头/页脚模板中
    val loginPatterns = listOf("login", "signin", "log-in", "sign-in")
    val loginFormPatterns = listOf(
        """<input[^>]*type=["']?password""",
        """name=["']?password""",
        """id=["']?password"""
    )
    val hasLoginKeyword = loginPatterns.any { lower.contains(it) }
    val hasLoginForm = loginFormPatterns.any {
        Regex(it, RegexOption.IGNORE_CASE).containsMatchIn(html)
    }
    if (!hasRealContent && hasLoginKeyword && hasLoginForm) {
        if (html.length < 25000) return "login_page"
        val stripped = html.replace(Regex("""<(script|style|noscript)[^>]*>.*?</\1>""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ").trim()
        if (stripped.length < 3000) return "login_page"
    }

    if (containsCaptchaChallenge(html)) return "captcha_page"

    // VIP/付费锁章检测
    // 裸词 vip/付费/订阅 会误命中正常页面的 VIP 频道入口/等级标记/侧栏广告，制造假阴性。
    // 改用只在"付费提示"语境出现的动作短语（不会是导航链接文本），并叠加正文证据：
    // 若调用方已抽到一段足够长的正文，说明规则命中的是真正文，即便页面含付费词也不判锁。
    if (!hasRealContent) {
        val vipActionPatterns = listOf(
            "订阅本章", "本章为 vip", "本章为付费", "余额不足", "充值", "购买本章",
            "解锁本章", "付费解锁", "vip章节", "付费章节", "请订阅"
        )
        if (vipActionPatterns.any { lower.contains(it) }) return "vip_lock_page"
    }

    return "normal_reader_html"
}

internal fun classifyHtmlKind(html: String?): String = classifyHtmlKindExt(html, null)

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
        // 但如果 Android Probe 已成功渲染 WebView（有 webViewHtmlPreview 或 probeAvailable），
        // 则不追加 "无法执行 WebView" 警告——Probe 已经执行了。
        val probeDidRender = probeAvailable == true || !webViewHtmlPreview.isNullOrBlank()
        // 只对成功步骤追加 webView 复核标记。
        // 失败步骤已有具体错误（选择器为空、超时、404 等），不应被 needsAppReview 覆盖。
        if (WebBook.lastAnalyzeUrl?.hasWebView == true && !probeDidRender) {
            if (allWarnings.none { it.feature == "webView" }) {
                allWarnings.add(DebugStep.CompatibilityWarning(
                    "webView", "URL 包含 webView:true，validator 无法执行 WebView 渲染"
                ))
            }
            if (this.status == "success") {
                needsReview = true
                reviewRsn = reviewRsn ?: "URL 包含 webView:true，需 App/WebView 复核"
            }
        }
        return copy(
            compatibilityWarnings = allWarnings.ifEmpty { null },
            needsAppReview = needsReview,
            reviewReason = reviewRsn
        )
    }

    private var debugDir: java.io.File? = null

    suspend fun runFull(source: BookSource, keyword: String, mode: String = "http", debugDir: java.io.File? = null): List<DebugStep> {
        this.debugDir = debugDir
        steps.clear()
        val book = Book()
        val warnings = collectWarnings(source)
        val sourceDomain = try { java.net.URI(source.bookSourceUrl).toURL().host.lowercase() } catch (_: Exception) { "" }
        val sessionMode = if (sourceDomain.isNotEmpty() && io.legado.validator.web.CookieStore.getCookie(sourceDomain) != null) "authenticated" else "anonymous"

        // Step 1: Search
        val searchStep = (when (mode) {
            "android" -> runSearchAndroid(source, keyword)
            "browser" -> runSearchBrowser(source, keyword)
            else -> runSearch(source, keyword) // "http"
        }).withWarnings(warnings).copy(sessionMode = sessionMode)
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
        val detailStep = runDetail(source, book, actualMode).withWarnings(warnings).copy(sessionMode = sessionMode)
        steps.add(detailStep)
        listener?.invoke(detailStep)
        if (detailStep.status == "error") return steps.toList()

        // Step 3: TOC
        val tocStep = runToc(source, book, actualMode).withWarnings(warnings).copy(sessionMode = sessionMode)
        steps.add(tocStep)
        listener?.invoke(tocStep)
        if (tocStep.status == "error") return steps.toList()

        @Suppress("UNCHECKED_CAST")
        val chapters = tocStep.extracted["chapters"] as? List<BookChapter> ?: emptyList()

        // Step 4: Content (first 2 chapters)
        chLoop@ for ((ci, ch) in chapters.take(2).withIndex()) {
            val cIdx = ci + 1  // 1-based for artifact naming
            val contentStep = if (actualMode == "android") {
                runContentAndroid(source, book, ch, cIdx)
            } else {
                runContent(source, book, ch, actualMode, cIdx)
            }.withWarnings(warnings).copy(sessionMode = sessionMode)
            steps.add(contentStep)
            listener?.invoke(contentStep)
        }

        // ── 正文去重 post-check ──
        val contentSteps = steps.filter { it.phase == "content" && it.status == "success" }
        if (contentSteps.size >= 2) {
            val c1 = contentSteps[0]
            val c2 = contentSteps[1]
            val p1 = c1.preview ?: ""
            val p2 = c2.preview ?: ""
            if (p1.isNotBlank() && p1 == p2) {
                // 更新第二个 content step，添加去重错误
                val dedupEvidence = c2.evidence.toMutableMap()
                dedupEvidence["contentHash"] = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(p1.toByteArray()).take(8).joinToString("") { "%02x".format(it) }
                dedupEvidence["chapter1Title"] = c1.extracted["chapterTitle"]?.toString() ?: ""
                dedupEvidence["chapter2Title"] = c2.extracted["chapterTitle"]?.toString() ?: ""
                val dedupMeta = ErrorCodeRegistry.get(ErrorCode.CONTENT_DUPLICATE_BETWEEN_CHAPTERS)
                val updated = c2.copy(
                    status = "error",
                    error = dedupMeta?.messageTemplate ?: "两章正文内容完全相同",
                    errorCode = ErrorCode.CONTENT_DUPLICATE_BETWEEN_CHAPTERS.name,
                    subphase = dedupMeta?.subphase?.name?.lowercase(),
                    failedField = dedupMeta?.failedField,
                    allowedFixes = dedupMeta?.allowedFixes ?: emptyList(),
                    forbiddenFixes = dedupMeta?.forbiddenFixes ?: emptyList(),
                    evidence = dedupEvidence
                )
                // Replace the second content step
                val idx = steps.indexOf(c2)
                if (idx >= 0) {
                    val mutableSteps = steps.toMutableList()
                    mutableSteps[idx] = updated
                    steps.clear()
                    steps.addAll(mutableSteps)
                }
                listener?.invoke(updated)
            }
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
        val headers = res.headers
        return when {
            code == 403 && headers["Cf-Mitigated"]?.contains("challenge") == true ->
                "HTTP 403 — Cloudflare 反爬拦截 (Cf-Mitigated: challenge)，需浏览器/App 复核"
            res.body.contains("challenges.cloudflare.com/turnstile", ignoreCase = true)
                || res.body.contains("turnstile.render", ignoreCase = true) ->
                "Cloudflare Turnstile 验证页，需浏览器/App 复核"
            res.body.contains("Just a moment", ignoreCase = true) ->
                "Cloudflare challenge 页面，需浏览器/App 复核"
            res.body.contains("captcha", ignoreCase = true) ->
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
                        when {
                            containsAppReviewChallenge(res.body) && res.body.contains("turnstile", ignoreCase = true) ->
                                "Cloudflare Turnstile 验证页，需浏览器/App 复核"
                            containsAppReviewChallenge(res.body) && res.body.contains("Just a moment", ignoreCase = true) ->
                                "Cloudflare challenge 页面，需浏览器/App 复核"
                            containsAppReviewChallenge(res.body) ->
                                "需要验证码，需浏览器/App 复核"
                            res.code != 200 -> makeHttpError(res, "搜索")
                            else -> "搜索结果为空 (HTTP ${res.code}, 列表大小:0)"
                        }
                    } else "搜索结果为空"
                    val sErrorCode = selectSearchEmptyErrorCode(res).name
                    val sMeta = try { ErrorCodeRegistry.get(ErrorCode.valueOf(sErrorCode)) } catch (_: Exception) { null }
                    val needsReview = sErrorCode == ErrorCode.APP_REVIEW_REQUIRED.name
                    DebugStep(
                        phase = "search", status = "error",
                        request = reqInfo, response = resInfo,
                        error = errorMsg,
                        errorCode = sErrorCode,
                        subphase = sMeta?.subphase?.name?.lowercase(),
                        failedField = sMeta?.failedField,
                        allowedFixes = sMeta?.allowedFixes ?: emptyList(),
                        forbiddenFixes = sMeta?.forbiddenFixes ?: emptyList(),
                        needsAppReview = needsReview,
                        reviewReason = if (needsReview) errorMsg else null
                    )
                }
            } catch (e: WebViewNotSupportedException) {
                val wvMeta = ErrorCodeRegistry.get(ErrorCode.ANDROID_PROBE_UNAVAILABLE)
                DebugStep(
                    phase = "search", status = "error",
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    error = e.message,
                    errorCode = ErrorCode.ANDROID_PROBE_UNAVAILABLE.name,
                    subphase = wvMeta?.subphase?.name?.lowercase(),
                    failedField = wvMeta?.failedField,
                    allowedFixes = wvMeta?.allowedFixes ?: emptyList(),
                    forbiddenFixes = wvMeta?.forbiddenFixes ?: emptyList(),
                    needsAppReview = true,
                    reviewReason = e.message
                )
            } catch (e: Exception) {
                DebugStep(
                    phase = "search", status = "error",
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    error = "${e::class.simpleName}: ${e.message}",
                    errorCode = ErrorCode.HTTP_BLOCKED.name
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
                    androidBackend = androidBackendFor(mode),
                    androidProbeUsed = androidProbeUsedFor(mode),
                    ruleHits = toRuleHits(WebBook.lastRuleHits),
                    extracted = mapOf(
                        "name" to result.name,
                        "author" to result.author,
                        "coverUrl" to result.coverUrl,
                        "intro" to result.intro.take(200),
                        "tocUrl" to result.tocUrl
                    )
                )
            } catch (e: WebViewNotSupportedException) {
                DebugStep(
                    phase = "detail", status = "error", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    androidBackend = androidBackendFor(mode),
                    androidProbeUsed = androidProbeUsedFor(mode),
                    error = e.message,
                    needsAppReview = true,
                    reviewReason = e.message
                )
            } catch (e: Exception) {
                DebugStep(
                    phase = "detail", status = "error", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    androidBackend = androidBackendFor(mode),
                    androidProbeUsed = androidProbeUsedFor(mode),
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
                    androidBackend = androidBackendFor(mode),
                    androidProbeUsed = androidProbeUsedFor(mode),
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
                    androidBackend = androidBackendFor(mode),
                    androidProbeUsed = androidProbeUsedFor(mode),
                    error = e.message,
                    needsAppReview = true,
                    reviewReason = e.message
                )
            } catch (e: Exception) {
                DebugStep(
                    phase = "toc", status = "error", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(WebBook.lastResponse),
                    androidBackend = androidBackendFor(mode),
                    androidProbeUsed = androidProbeUsedFor(mode),
                    error = "${e::class.simpleName}: ${e.message}"
                )
            }
        }
    }

    private suspend fun runContent(source: BookSource, book: Book, chapter: BookChapter, mode: String = "http", cIdx: Int = 0): DebugStep {
        return withContext(Dispatchers.IO) {
            try {
                WebBook.clearState()
                val content = WebBook.getContentAwait(source, book, chapter)
                val res = WebBook.lastResponse
                val body = res?.body ?: ""
                val htmlKind = classifyHtml(body, content)

                // ── 调试产物 ──
                val artifacts = mutableMapOf<String, String>()
                val req = buildRequestInfo()
                writeDebugArtifact("content", cIdx, "request.json", Gson().toJson(req))?.let { artifacts["request.json"] = it }
                writeDebugArtifact("content", cIdx, "response.raw.html", body)?.let { artifacts["response.raw.html"] = it }
                writeDebugArtifact("content", cIdx, "rule-hits.json", Gson().toJson(toRuleHits(BookContent.lastRuleHits)))?.let { artifacts["rule-hits.json"] = it }
                writeDebugArtifact("content", cIdx, "extracted.txt", content)?.let { artifacts["extracted.txt"] = it }

                // ── 错误归因 ──
                val errorCode: String? = when {
                    content.isBlank() && htmlKind == "normal_reader_html" && body.length > 0 ->
                        ErrorCode.CONTENT_SELECTOR_EMPTY.name
                    htmlKind == "csr_shell" -> ErrorCode.CONTENT_IS_CSR_SHELL.name
                    htmlKind == "login_page" -> ErrorCode.CONTENT_IS_LOGIN_PAGE.name
                    htmlKind == "captcha_page" -> ErrorCode.CONTENT_IS_CAPTCHA_PAGE.name
                    htmlKind == "vip_lock_page" -> ErrorCode.CONTENT_IS_VIP_LOCK_PAGE.name
                    else -> null
                }
                val resolvedCode = errorCode?.let { code -> try { ErrorCode.valueOf(code) } catch (_: Exception) { null } }
                val meta = resolvedCode?.let { ErrorCodeRegistry.get(it) }

                // ── 正文质量检查 ──
                var qualityCode: String? = null
                var qualitySeverity = false
                var isLikelyNoticeOrLock = false
                var titleFoundInContent: Boolean? = null
                if (!content.isBlank() && content.length < 100) {
                    qualityCode = ErrorCode.CONTENT_TOO_SHORT.name
                    val noticeKeywords = listOf("公告", "通知", "请假", "停更", "VIP", "付费", "订阅")
                    isLikelyNoticeOrLock = noticeKeywords.any { content.contains(it, ignoreCase = true) }
                    if (isLikelyNoticeOrLock) qualitySeverity = true
                }
                var mismatchCode: String? = null
                if (!content.isBlank() && chapter.title.isNotBlank()) {
                    val titleClean = chapter.title.replace(Regex("""^\d+[\.\、\s]+"""), "").take(4)
                    if (titleClean.length >= 2 && !content.contains(titleClean, ignoreCase = true)) {
                        mismatchCode = ErrorCode.CONTENT_CHAPTER_MISMATCH.name
                        titleFoundInContent = false
                    } else {
                        titleFoundInContent = true
                    }
                }

                val fullEvidence = buildContentEvidence(body, content, artifacts).toMutableMap()
                if (!content.isBlank()) {
                    fullEvidence["contentPreview"] = content.take(100)
                }
                fullEvidence["chapterTitle"] = chapter.title
                if (isLikelyNoticeOrLock) fullEvidence["isLikelyNoticeOrLock"] = true
                if (titleFoundInContent != null) fullEvidence["titleFoundInContent"] = titleFoundInContent

                val status = when {
                    content.isBlank() -> "error"
                    htmlKind in listOf("csr_shell", "login_page", "captcha_page", "vip_lock_page") -> "error"
                    qualitySeverity -> "error"  // CONTENT_TOO_SHORT with isLikelyNoticeOrLock
                    else -> "success"
                }
                val finalErrorCode = when {
                    errorCode != null -> errorCode
                    qualityCode != null -> qualityCode
                    mismatchCode != null -> mismatchCode
                    else -> null
                }
                val resolvedFinalCode = finalErrorCode?.let { code -> try { ErrorCode.valueOf(code) } catch (_: Exception) { null } }
                val finalMeta = if (status == "error") resolvedFinalCode?.let { ErrorCodeRegistry.get(it) } ?: meta else null
                val errorMsg = when {
                    htmlKind == "csr_shell" -> ErrorCodeRegistry.CONTENT_IS_CSR_SHELL_META.messageTemplate
                    htmlKind == "login_page" -> ErrorCodeRegistry.CONTENT_IS_LOGIN_PAGE_META.messageTemplate
                    htmlKind == "captcha_page" -> ErrorCodeRegistry.CONTENT_IS_CAPTCHA_PAGE_META.messageTemplate
                    htmlKind == "vip_lock_page" -> ErrorCodeRegistry.CONTENT_IS_VIP_LOCK_PAGE_META.messageTemplate
                    content.isBlank() -> "正文为空"
                    qualityCode != null -> ErrorCodeRegistry.CONTENT_TOO_SHORT_META.messageTemplate
                    else -> null
                }

                DebugStep(
                    phase = "content", status = status, mode = mode,
                    request = req,
                    response = buildResponseInfo(res),
                    ruleHits = toRuleHits(BookContent.lastRuleHits),
                    extracted = mapOf(
                        "chapterTitle" to chapter.title,
                        "contentLength" to content.length
                    ),
                    preview = content.take(500),
                    error = errorMsg,
                    errorCode = if (status == "error") finalErrorCode else null,
                    subphase = finalMeta?.subphase?.name?.lowercase(),
                    failedField = finalMeta?.failedField,
                    allowedFixes = finalMeta?.allowedFixes ?: emptyList(),
                    forbiddenFixes = finalMeta?.forbiddenFixes ?: emptyList(),
                    evidence = fullEvidence,
                    debugArtifacts = artifacts.ifEmpty { null }
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
                val res = WebBook.lastResponse
                val body = res?.body ?: ""
                val htmlKind = classifyHtml(body)
                val excErrorCode = when {
                    htmlKind == "csr_shell" -> ErrorCode.CONTENT_IS_CSR_SHELL.name
                    htmlKind == "login_page" -> ErrorCode.CONTENT_IS_LOGIN_PAGE.name
                    htmlKind == "captcha_page" -> ErrorCode.CONTENT_IS_CAPTCHA_PAGE.name
                    htmlKind == "vip_lock_page" -> ErrorCode.CONTENT_IS_VIP_LOCK_PAGE.name
                    body.isNotBlank() && htmlKind == "normal_reader_html" -> ErrorCode.CONTENT_SELECTOR_EMPTY.name
                    else -> null
                }
                val excMeta = excErrorCode?.let { code -> try { ErrorCodeRegistry.get(ErrorCode.valueOf(code)) } catch (_: Exception) { null } }
                val excArtifacts = mutableMapOf<String, String>()
                writeDebugArtifact("content", cIdx, "response.raw.html", body)?.let { excArtifacts["response.raw.html"] = it }
                DebugStep(
                    phase = "content", status = "error", mode = mode,
                    request = buildRequestInfo(),
                    response = buildResponseInfo(res),
                    error = "${e::class.simpleName}: ${e.message}",
                    errorCode = excErrorCode,
                    subphase = excMeta?.subphase?.name?.lowercase(),
                    failedField = excMeta?.failedField,
                    allowedFixes = excMeta?.allowedFixes ?: emptyList(),
                    forbiddenFixes = excMeta?.forbiddenFixes ?: emptyList(),
                    evidence = mapOf("htmlLength" to body.length, "htmlKind" to htmlKind, "contentLength" to 0),
                    debugArtifacts = excArtifacts.ifEmpty { null }
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
                    probeAvailable = false,
                    androidBackend = "probe_unavailable",
                    androidProbeUsed = false
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
                            androidBackend = "probe_webview",
                            androidProbeUsed = true,
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
                        androidBackend = "probe_webview",
                        androidProbeUsed = true,
                        webViewHtmlPreview = probeRes.html?.take(2000),
                        webViewScreenshotBase64 = probeRes.screenshotBase64
                    ) else {
                        val sErrorCode = selectSearchEmptyErrorCode(
                            StrResponse(analyzeUrl.url, probeRes.html ?: "", okhttp3.Headers.headersOf("Content-Type", "text/html"), 200)
                        )
                        val sMeta = ErrorCodeRegistry.get(sErrorCode)
                        DebugStep(
                        phase = "search", status = "error", mode = "android",
                        error = "Probe 搜索渲染成功但未提取到结果",
                        errorCode = sErrorCode.name,
                        subphase = sMeta?.subphase?.name?.lowercase(),
                        failedField = sMeta?.failedField,
                        allowedFixes = sMeta?.allowedFixes ?: emptyList(),
                        forbiddenFixes = sMeta?.forbiddenFixes ?: emptyList(),
                        probeAvailable = true, probeDevice = probeInfo.device?.serial,
                        androidWebViewVersion = probeInfo.webViewVersion,
                        androidBackend = "probe_webview",
                        androidProbeUsed = true,
                        webViewHtmlPreview = probeRes.html?.take(2000),
                        webViewScreenshotBase64 = probeRes.screenshotBase64
                    )
                    }
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
                        androidWebViewVersion = probeInfo.webViewVersion,
                        androidBackend = "pc_http",
                        androidProbeUsed = false
                    ) else {
                        val sErrorCode = selectSearchEmptyErrorCode(res)
                        val sMeta = ErrorCodeRegistry.get(sErrorCode)
                        DebugStep(
                        phase = "search", status = "error", mode = "android",
                        request = reqInfo, response = resInfo, error = "搜索结果为空",
                        errorCode = sErrorCode.name,
                        subphase = sMeta?.subphase?.name?.lowercase(),
                        failedField = sMeta?.failedField,
                        allowedFixes = sMeta?.allowedFixes ?: emptyList(),
                        forbiddenFixes = sMeta?.forbiddenFixes ?: emptyList(),
                        probeAvailable = true, probeDevice = probeInfo.device?.serial,
                        androidWebViewVersion = probeInfo.webViewVersion,
                        androidBackend = "pc_http",
                        androidProbeUsed = false
                    )
                    }
                }
            } catch (e: Exception) {
                DebugStep(
                    phase = "search", status = "error", mode = "android",
                    error = "${e::class.simpleName}: ${e.message}",
                    probeAvailable = true, probeDevice = probeInfo.device?.serial,
                    androidWebViewVersion = probeInfo.webViewVersion,
                    androidBackend = "pc_http",
                    androidProbeUsed = false
                )
            }
        }
    }

    private suspend fun runContentAndroid(source: BookSource, book: Book, chapter: BookChapter, cIdx: Int = 0): DebugStep {
        return withContext(Dispatchers.IO) {
            detectAndroidContentWebViewDeclarationError(source, chapter)?.let { return@withContext it }
            val probeInfo = AndroidProbeService.probeCheck()
            if (!probeInfo.available) {
                return@withContext DebugStep(
                    phase = "content", status = "error", mode = "android",
                    error = "Android Probe 不可用: ${probeInfo.error}",
                    errorCode = ErrorCode.ANDROID_PROBE_UNAVAILABLE.name,
                    probeAvailable = false,
                    androidBackend = "probe_unavailable",
                    androidProbeUsed = false
                )
            }
            try {
                val contentRule = source.getContentRule()
                val webJs = contentRule.webJs
                val cleanUrl = chapter.url.replace(Regex(",\\{[^}]*\\}$"), "")
                val probeReq = ProbeRenderRequest(
                    url = cleanUrl,
                    headers = source.getHeaderMap(),
                    javaScript = webJs,
                    timeout = 120000L,
                    jsRetries = 150,
                    jsDelay = 200L,
                    screenshot = true
                )
                val probeRes = AndroidProbeService.render(probeReq)
                if (!probeRes.ok) {
                    val pError = probeRes.error ?: "Probe render failed"
                    val pErrorCode = when {
                        pError.contains("timeout", ignoreCase = true) -> ErrorCode.WEBVIEW_RENDER_TIMEOUT
                        pError.contains("unavailable", ignoreCase = true) -> ErrorCode.ANDROID_PROBE_UNAVAILABLE
                        pError.contains("ACCESS_DENIED", ignoreCase = true) || pError.contains("ERR_", ignoreCase = true) ->
                            ErrorCode.HTTP_BLOCKED
                        pError.contains("login", ignoreCase = true) -> ErrorCode.COOKIE_REQUIRED
                        else -> ErrorCode.ANDROID_PROBE_UNAVAILABLE
                    }
                    val pMeta = ErrorCodeRegistry.get(pErrorCode)
                    return@withContext DebugStep(
                        phase = "content", status = "error", mode = "android",
                        request = DebugStep.RequestInfo(url = cleanUrl, method = "GET", headers = source.getHeaderMap(), body = null),
                        error = pError,
                        errorCode = pErrorCode.name,
                        subphase = pMeta?.subphase?.name?.lowercase(),
                        failedField = pMeta?.failedField,
                        allowedFixes = pMeta?.allowedFixes ?: emptyList(),
                        forbiddenFixes = pMeta?.forbiddenFixes ?: emptyList(),
                        probeAvailable = true,
                        probeDevice = probeInfo.device?.serial,
                        androidWebViewVersion = probeInfo.webViewVersion,
                        androidBackend = "probe_webview",
                        androidProbeUsed = true,
                        webViewHtmlPreview = probeRes.html?.take(2000),
                        webViewScreenshotBase64 = probeRes.screenshotBase64
                    )
                }
                val probeHtml = probeRes.html ?: ""

                // ── 调试产物 ──
                val artifacts = mutableMapOf<String, String>()
                val reqInfo = DebugStep.RequestInfo(url = cleanUrl, method = "GET", headers = source.getHeaderMap(), body = null)
                writeDebugArtifact("content", cIdx, "request.json", Gson().toJson(reqInfo))?.let { artifacts["request.json"] = it }
                writeDebugArtifact("content", cIdx, "response.rendered.html", probeHtml)?.let { artifacts["response.rendered.html"] = it }
                if (probeRes.screenshotBase64 != null) {
                    try {
                        val screenshotBytes = java.util.Base64.getDecoder().decode(probeRes.screenshotBase64)
                        writeDebugArtifactBinary("content", cIdx, "screenshot.png", screenshotBytes)?.let { artifacts["screenshot.png"] = it }
                    } catch (_: Exception) { }
                }

                val analyzeRule = AnalyzeRule(book, source)
                analyzeRule.setContent(probeHtml, cleanUrl)
                val content = analyzeRule.setFieldName("content").getString(contentRule.content)
                writeDebugArtifact("content", cIdx, "rule-hits.json", Gson().toJson(toRuleHits(analyzeRule.ruleHits)))?.let { artifacts["rule-hits.json"] = it }
                writeDebugArtifact("content", cIdx, "extracted.txt", content)?.let { artifacts["extracted.txt"] = it }

                val htmlKind = classifyHtml(probeHtml, content)

                val jsErrMsg = probeRes.jsError
                val contentBlank = content.isBlank()

                // ── 错误归因 ──
                val errorCode: String? = when {
                    htmlKind == "csr_shell" -> ErrorCode.CONTENT_IS_CSR_SHELL.name
                    htmlKind == "login_page" -> ErrorCode.CONTENT_IS_LOGIN_PAGE.name
                    htmlKind == "captcha_page" -> ErrorCode.CONTENT_IS_CAPTCHA_PAGE.name
                    htmlKind == "vip_lock_page" -> ErrorCode.CONTENT_IS_VIP_LOCK_PAGE.name
                    contentBlank && htmlKind == "normal_reader_html" && probeHtml.length > 0 ->
                        ErrorCode.CONTENT_SELECTOR_EMPTY.name
                    contentBlank && jsErrMsg != null -> ErrorCode.WEBJS_EXEC_ERROR.name
                    contentBlank && probeRes.ok -> ErrorCode.WEBJS_RETURN_EMPTY.name
                    else -> null
                }

                val resolvedCode = errorCode?.let { code -> try { ErrorCode.valueOf(code) } catch (_: Exception) { null } }
                val meta = resolvedCode?.let { ErrorCodeRegistry.get(it) }

                // ── 正文质量检查（先收集标志，后合并到 evidence） ──
                var qualityCode: String? = null
                var qualitySeverity = false  // true = change status to error
                var isLikelyNoticeOrLock = false
                var titleFoundInContent: Boolean? = null
                if (!content.isBlank() && content.length < 100) {
                    qualityCode = ErrorCode.CONTENT_TOO_SHORT.name
                    val noticeKeywords = listOf("公告", "通知", "请假", "停更", "VIP", "付费", "订阅")
                    isLikelyNoticeOrLock = noticeKeywords.any { content.contains(it, ignoreCase = true) }
                    if (isLikelyNoticeOrLock) qualitySeverity = true
                }
                var mismatchCode: String? = null
                if (!content.isBlank() && chapter.title.isNotBlank()) {
                    val titleClean = chapter.title.replace(Regex("""^\d+[\.\、\s]+"""), "").take(4)
                    if (titleClean.length >= 2 && !content.contains(titleClean, ignoreCase = true)) {
                        mismatchCode = ErrorCode.CONTENT_CHAPTER_MISMATCH.name
                        titleFoundInContent = false
                    } else {
                        titleFoundInContent = true
                    }
                }

                val status = when {
                    contentBlank -> "error"
                    htmlKind in listOf("csr_shell", "login_page", "captcha_page", "vip_lock_page") -> "error"
                    qualitySeverity -> "error"
                    else -> "success"
                }
                val finalErrorCode = when {
                    errorCode != null -> errorCode
                    qualityCode != null -> qualityCode
                    mismatchCode != null -> mismatchCode
                    else -> null
                }
                val resolvedFinalCode = finalErrorCode?.let { code -> try { ErrorCode.valueOf(code) } catch (_: Exception) { null } }
                val finalMeta = if (status == "error") resolvedFinalCode?.let { ErrorCodeRegistry.get(it) } ?: meta else null
                val errorMsg = when {
                    htmlKind == "csr_shell" -> ErrorCodeRegistry.CONTENT_IS_CSR_SHELL_META.messageTemplate
                    htmlKind == "login_page" -> ErrorCodeRegistry.CONTENT_IS_LOGIN_PAGE_META.messageTemplate
                    htmlKind == "captcha_page" -> ErrorCodeRegistry.CONTENT_IS_CAPTCHA_PAGE_META.messageTemplate
                    htmlKind == "vip_lock_page" -> ErrorCodeRegistry.CONTENT_IS_VIP_LOCK_PAGE_META.messageTemplate
                    contentBlank && jsErrMsg != null -> "webJs 执行错误: $jsErrMsg"
                    contentBlank -> "正文为空"
                    jsErrMsg != null -> "webJs 警告: $jsErrMsg"
                    else -> null
                }

                val fullEvidence = buildContentEvidence(probeHtml, content, artifacts).toMutableMap()
                if (!content.isBlank()) {
                    fullEvidence["contentPreview"] = content.take(100)
                }
                fullEvidence["chapterTitle"] = chapter.title
                if (isLikelyNoticeOrLock) fullEvidence["isLikelyNoticeOrLock"] = true
                if (titleFoundInContent != null) fullEvidence["titleFoundInContent"] = titleFoundInContent

                DebugStep(
                    phase = "content",
                    status = status,
                    mode = "android",
                    request = reqInfo,
                    response = DebugStep.ResponseInfo(
                        code = 200,
                        contentType = "text/html",
                        bodyPreview = probeHtml.take(2000),
                        bodyLength = probeHtml.length
                    ),
                    error = errorMsg,
                    errorCode = if (status == "error") finalErrorCode else null,
                    subphase = finalMeta?.subphase?.name?.lowercase(),
                    failedField = finalMeta?.failedField,
                    allowedFixes = finalMeta?.allowedFixes ?: emptyList(),
                    forbiddenFixes = finalMeta?.forbiddenFixes ?: emptyList(),
                    ruleHits = toRuleHits(analyzeRule.ruleHits),
                    extracted = mapOf("chapterTitle" to chapter.title, "contentLength" to content.length),
                    preview = content.take(500),
                    evidence = fullEvidence,
                    debugArtifacts = artifacts.ifEmpty { null },
                    probeAvailable = true,
                    probeDevice = probeInfo.device?.serial,
                    androidWebViewVersion = probeInfo.webViewVersion,
                    androidBackend = "probe_webview",
                    androidProbeUsed = true,
                    webViewHtmlPreview = probeHtml.take(2000),
                    webViewScreenshotBase64 = probeRes.screenshotBase64
                )
            } catch (e: Exception) {
                DebugStep(
                    phase = "content", status = "error", mode = "android",
                    error = "${e::class.simpleName}: ${e.message}",
                    errorCode = if (e is WebViewNotSupportedException) ErrorCode.ANDROID_PROBE_UNAVAILABLE.name else null,
                    probeAvailable = true,
                    androidBackend = "probe_webview",
                    androidProbeUsed = true
                )
            }
        }
    }

    fun cancel() {
        scope.coroutineContext.cancelChildren()
    }

    // ── 调试产物 ────────────────────────────────────────────────────────────────

    private fun writeDebugArtifact(phase: String, index: Int?, kind: String, content: String): String? {
        val dir = debugDir ?: return null
        val filename = if (index != null) "$phase-$index-$kind" else "$phase-$kind"
        val file = java.io.File(dir, filename)
        return try {
            // 安全边界：确保结果路径在 debugDir 内部
            if (!file.canonicalPath.startsWith(dir.canonicalPath + java.io.File.separator)
                && file.canonicalPath != dir.canonicalPath) {
                null  // 路径穿越拒绝
            } else {
                file.parentFile?.mkdirs()
                file.writeText(content, Charsets.UTF_8)
                filename  // 返回相对路径
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun writeDebugArtifactBinary(phase: String, index: Int?, kind: String, content: ByteArray): String? {
        val dir = debugDir ?: return null
        val filename = if (index != null) "$phase-$index-$kind" else "$phase-$kind"
        val file = java.io.File(dir, filename)
        return try {
            if (!file.canonicalPath.startsWith(dir.canonicalPath + java.io.File.separator)
                && file.canonicalPath != dir.canonicalPath) {
                null
            } else {
                file.parentFile?.mkdirs()
                file.writeBytes(content)
                filename
            }
        } catch (_: Exception) {
            null
        }
    }

    // ── HTML 分类 ──────────────────────────────────────────────────────────────

    /** 对原始/渲染后的 HTML 做页面分类，用于归因安全 */
    private fun classifyHtml(html: String?, content: String? = null): String {
        return classifyHtmlKindExt(html, content)
    }

    // ── 构建 evidence ──────────────────────────────────────────────────────────

    private fun buildContentEvidence(html: String?, content: String, artifacts: MutableMap<String, String>): Map<String, Any?> {
        val htmlKind = classifyHtml(html)
        return mapOf(
            "htmlLength" to (html?.length ?: 0),
            "contentLength" to content.length,
            "htmlKind" to htmlKind
        ) + artifacts.mapKeys { "debugArtifacts.${it.key}" }
    }
}

private fun isAnonymousLoginCandidate(step: DebugStep): Boolean {
    if (step.status != "error") return false
    if (step.needsAppReview) return true
    return when (step.errorCode) {
        null,
        ErrorCode.SEARCH_EMPTY.name,
        ErrorCode.CONTENT_IS_LOGIN_PAGE.name,
        ErrorCode.CONTENT_IS_VIP_LOCK_PAGE.name,
        ErrorCode.COOKIE_REQUIRED.name -> true
        else -> false
    }
}

private fun androidBackendFor(mode: String): String? =
    if (mode == "android") "pc_http" else null

private fun androidProbeUsedFor(mode: String): Boolean? =
    if (mode == "android") false else null

fun determineFinalStatus(steps: List<DebugStep>, source: BookSource? = null): String {
    val hasNeedsAppReview = steps.any { it.needsAppReview }
    val hasUnsupportedFeature = steps.any { !it.compatibilityWarnings.isNullOrEmpty() }
    val hasProbeUnavailable = steps.any { it.mode == "android" && it.probeAvailable == false }
    val allPassed = steps.all { it.status == "success" }
    val isAnonymous = steps.all { it.sessionMode != "authenticated" }
    val hasLoginVertex = source != null && (
        !source.loginUrl.isNullOrBlank() ||
        source.enabledCookieJar == true ||
        (!source.header.isNullOrBlank() && source.header!!.contains("Authorization", ignoreCase = true))
    )
    val hasAnonymousLoginFailure = hasLoginVertex && isAnonymous && steps.any { isAnonymousLoginCandidate(it) }
    // 不带 needsAppReview 标记的真实错误（规则写错、404 等），不应被 needs_app_review 掩盖
    val hasHardError = steps.any { it.status == "error" && !it.needsAppReview }
    val hasHardSourceRuleError = steps.any { it.status == "error" && !it.needsAppReview && !isAnonymousLoginCandidate(it) }

    return when {
        hasNeedsAppReview && hasHardError -> "failed"
        hasNeedsAppReview -> "needs_app_review"
        hasProbeUnavailable && hasHardError -> "failed"
        hasProbeUnavailable -> "validator_limitation"
        hasHardSourceRuleError -> "failed"
        hasAnonymousLoginFailure -> "needs_app_review"
        allPassed && isAnonymous && hasLoginVertex -> "anonymous_candidate"
        hasUnsupportedFeature && allPassed -> "validator_limitation"
        allPassed -> "passed"
        else -> "failed"
    }
}
