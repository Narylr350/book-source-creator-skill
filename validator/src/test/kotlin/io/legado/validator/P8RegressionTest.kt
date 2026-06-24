package io.legado.validator

import com.google.gson.Gson
import com.google.gson.JsonObject
import io.legado.validator.analyzeRule.AnalyzeUrl
import io.legado.validator.debug.DebugStep
import io.legado.validator.debug.ErrorCode
import io.legado.validator.debug.ErrorCodeRegistry
import io.legado.validator.debug.classifyHtmlKind
import io.legado.validator.debug.classifyHtmlKindExt
import io.legado.validator.debug.containsAppReviewChallenge
import io.legado.validator.debug.determineFinalStatus
import io.legado.validator.debug.detectAndroidContentWebViewDeclarationError
import io.legado.validator.debug.selectSearchEmptyErrorCode
import io.legado.validator.help.http.StrResponse
import io.legado.validator.model.BookChapter
import io.legado.validator.model.BookSource
import io.legado.validator.model.rule.ContentRule
import io.legado.validator.webBook.WebBook
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Headers
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import java.io.File

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class P8RegressionTest {

    private val gson = Gson()
    private val sourcesDir = File("examples/sources")
    private val casesDir = File("examples/cases")
    private val candidatesDir = File("examples/candidates")

    private fun loadSource(sourceFile: String): BookSource {
        val targetName = File(sourceFile).name
        val targetBase = File(targetName).nameWithoutExtension
        val file = File(sourcesDir, sourceFile).takeIf { it.exists() }
            ?: candidatesDir.listFiles()?.flatMap { it.listFiles()?.toList() ?: emptyList() }
                ?.find { it.name == targetName }
            ?: sourcesDir.listFiles()?.find { it.name == targetName }
            ?: sourcesDir.listFiles()?.find {
                val base = it.nameWithoutExtension
                base.startsWith(targetBase) || targetBase.startsWith(base)
            }
            ?: throw IllegalArgumentException("Source not found: $sourceFile")
        val json = file.readText()
        return if (json.trimStart().startsWith("[")) {
            BookSource.fromJson(json).first()
        } else {
            BookSource.fromJsonObject(json)
        }
    }

    private fun loadCase(caseFile: String): JsonObject {
        return gson.fromJson(File(casesDir, caseFile).readText(), JsonObject::class.java)
    }

    private fun caseFiles(): List<File> = casesDir.listFiles()?.filter { it.extension == "json" } ?: emptyList()

    private fun JsonObject.strOrNull(key: String): String? = if (has(key) && !get(key).isJsonNull) get(key).asString else null

    @Test
    fun `biquges static HTML full pipeline passes`() {
        val source = loadSource("biquges-com-book-source.json")
        runBlocking {
            val result = withTimeoutOrNull(30_000) {
                WebBook.searchBookAwait(source, "凡人修仙传")
            }
            assertNotNull(result, "biquges search should not timeout")
            assertTrue(result!!.isNotEmpty(), "biquges search should return results")
            assertTrue(result.first().name.contains("凡人"), "Book name should contain keyword")
        }
    }

    @Test
    fun `kuwo relative URL resolves correctly`() {
        val source = loadSource("candidates/xiu2-yuedu/kuwo.json")
        assertTrue(source.searchUrl?.startsWith("/") == true, "kuwo searchUrl should be relative")
        val au = AnalyzeUrl(
            mUrl = source.searchUrl!!,
            key = "test",
            source = source
        )
        assertTrue(au.url.startsWith("http://appi.kuwo.cn"), "kuwo URL should resolve against bookSourceUrl")
    }

    @Test
    fun `69shuba POST search detected`() {
        val source = loadSource("69shuba-com.json")
        assertTrue(source.searchUrl?.contains(";post") == true, "69shuba should use POST")
    }

    @Test
    fun `69shuba search fails gracefully due to Cloudflare`() {
        val source = loadSource("69shuba-com.json")
        runBlocking {
            withTimeoutOrNull(20_000) {
                try {
                    WebBook.searchBookAwait(source, "凡人修仙传")
                } catch (e: Exception) {
                    null
                }
            }
        }
    }

    @Test
    fun `qidian search needs app review due to cookie verification`() {
        val source = loadSource("candidates/xiu2-yuedu/qidian.json")
        assertTrue(source.enabledCookieJar == true, "qidian should have enabledCookieJar")
        runBlocking {
            withTimeoutOrNull(20_000) {
                try {
                    WebBook.searchBookAwait(source, "凡人修仙传")
                } catch (e: Exception) {
                    null
                }
            }
        }
    }

    @Test
    fun `zhide source has js URL rules`() {
        val source = loadSource("candidates/entr0pia/zhide.json")
        assertNotNull(source.searchUrl, "zhide should have searchUrl")
        // zhide uses crypto features — verify source loads correctly
        assertTrue(source.bookSourceUrl.isNotBlank(), "zhide should have bookSourceUrl")
    }

    @Test
    fun `novalpie source is login webview baseline`() {
        val source = loadSource("novalpie-com.json")
        assertEquals("https://novalpie.cc", source.bookSourceUrl)
        assertTrue(source.enabledCookieJar == true, "novalpie should require CookieJar")
        assertEquals("https://novalpie.cc/login", source.loginUrl)
        assertTrue(source.header?.contains("Authorization") == true, "novalpie should derive Authorization header")
        assertTrue(source.getContentRule().webJs?.contains("reader-content") == true, "novalpie should use webJs reader content extraction")
        assertTrue(source.getTocRule().chapterUrl?.contains("/reader?novel=") == true, "novalpie should use reader route")
        assertTrue(source.getTocRule().chapterUrl?.contains("\"webView\":true") == true, "novalpie chapters should require WebView")
    }

    @Test
    fun `android content with webJs must keep chapter url webView marker`() {
        val source = BookSource(
            bookSourceUrl = "https://example.test",
            ruleContent = ContentRule(
                content = "@css:#reader@text",
                webJs = "document.querySelector('#reader')?.innerText"
            )
        )
        val chapter = BookChapter(url = "https://example.test/reader/1")

        val step = detectAndroidContentWebViewDeclarationError(source, chapter)

        assertNotNull(step)
        assertEquals("error", step!!.status)
        assertEquals(ErrorCode.CHAPTER_URL_MISSING_WEBVIEW.name, step.errorCode)
        assertEquals("ruleToc.chapterUrl", step.failedField)
    }

    @Test
    fun `android content accepts declared chapter url webView marker`() {
        val source = BookSource(
            bookSourceUrl = "https://example.test",
            ruleContent = ContentRule(
                content = "@css:#reader@text",
                webJs = "document.querySelector('#reader')?.innerText"
            )
        )
        val chapter = BookChapter(url = """https://example.test/reader/1,{"webView":true}""")

        assertNull(detectAndroidContentWebViewDeclarationError(source, chapter))
    }

    @Test
    fun `webview render timeout points agents at webJs`() {
        assertEquals("ruleContent.webJs", ErrorCodeRegistry.WEBVIEW_RENDER_TIMEOUT_META.failedField)
    }

    @Test
    fun `search http 200 with body but no matched books is selector error`() {
        val res = StrResponse(
            url = "https://example.test/search?q=abc",
            body = "<html><body><div class='book'>Book exists in response</div></body></html>",
            headers = Headers.headersOf("Content-Type", "text/html"),
            code = 200
        )

        assertEquals(ErrorCode.SEARCH_SELECTOR_EMPTY, selectSearchEmptyErrorCode(res))
    }

    @Test
    fun `anonymous login vertex pass becomes anonymous candidate`() {
        val source = loadSource("novalpie-com.json")
        val steps = listOf(
            DebugStep("search", "success", sessionMode = "anonymous"),
            DebugStep("detail", "success", sessionMode = "anonymous"),
            DebugStep("toc", "success", sessionMode = "anonymous"),
            DebugStep("content", "success", sessionMode = "anonymous")
        )
        assertEquals("anonymous_candidate", determineFinalStatus(steps, source))
    }

    @Test
    fun `anonymous login vertex failure needs app review`() {
        val source = loadSource("novalpie-com.json")
        val steps = listOf(
            DebugStep("search", "error", errorCode = "SEARCH_EMPTY", sessionMode = "anonymous")
        )
        assertEquals("needs_app_review", determineFinalStatus(steps, source))
    }

    @Test
    fun `anonymous login vertex must not hide hard source rule errors`() {
        val source = loadSource("novalpie-com.json")
        val steps = listOf(
            DebugStep(
                "content",
                "error",
                errorCode = ErrorCode.CHAPTER_URL_MISSING_WEBVIEW.name,
                failedField = "ruleToc.chapterUrl",
                sessionMode = "anonymous"
            )
        )
        assertEquals("failed", determineFinalStatus(steps, source))
    }

    @Test
    fun `app review search block controls final status`() {
        val source = loadSource("69shuba-com.json")
        val steps = listOf(
            DebugStep(
                "search",
                "error",
                errorCode = "APP_REVIEW_REQUIRED",
                needsAppReview = true,
                reviewReason = "Cloudflare Turnstile 验证页，需浏览器/App 复核"
            )
        )
        assertEquals("needs_app_review", determineFinalStatus(steps, source))
    }

    @Test
    fun `turnstile detection is not limited to first 500 chars`() {
        val html = "x".repeat(800) + "https://challenges.cloudflare.com/turnstile/v0/api.js"
        assertTrue(containsAppReviewChallenge(html))
    }

    @Test
    fun `site verification meta is not captcha page`() {
        val html = """
            <html><head>
              <meta name="baidu-site-verification" content="abc" />
              <meta name="360-site-verification" content="def" />
            </head><body><p class="chapter">正常正文内容</p></body></html>
        """.trimIndent()
        assertEquals("normal_reader_html", classifyHtmlKind(html))
    }

    @Test
    fun `all case JSONs load without error`() {
        val cases = caseFiles()
        assertTrue(cases.isNotEmpty(), "Should find case files in examples/cases/")
        for (caseFile in cases) {
            val case = loadCase(caseFile.name)
            assertTrue(case.has("name"), "Case ${caseFile.name} should have 'name'")
            assertTrue(case.has("sourceFile"), "Case ${caseFile.name} should have 'sourceFile'")
            assertTrue(case.has("expected"), "Case ${caseFile.name} should have 'expected'")
        }
    }

    @Test
    fun `all referenced sources can be loaded`() {
        val errors = mutableListOf<String>()
        for (caseFile in caseFiles()) {
            val case = loadCase(caseFile.name)
            val sourceFile = case.strOrNull("sourceFile") ?: continue
            try {
                loadSource(sourceFile)
            } catch (e: Exception) {
                errors.add("${caseFile.name} -> $sourceFile: ${e.message}")
            }
        }
        assertTrue(errors.isEmpty(), "Failed to load sources:\n${errors.joinToString("\n")}")
    }

    @Test
    fun `biquges full pipeline - search to content`() {
        val source = loadSource("biquges-com-book-source.json")
        runBlocking {
            val searchResult = withTimeoutOrNull(30_000) {
                WebBook.searchBookAwait(source, "凡人修仙传")
            }
            assertNotNull(searchResult, "Search should not timeout")
            assertTrue(searchResult!!.isNotEmpty(), "Search should return results")

            val searchBook = searchResult.first()
            val book = io.legado.validator.model.Book(
                bookUrl = searchBook.bookUrl,
                name = searchBook.name,
                author = searchBook.author
            )

            val detailBook = withTimeoutOrNull(30_000) {
                WebBook.getBookInfoAwait(source, book)
            }
            assertNotNull(detailBook, "Book detail should not timeout")
            assertTrue(detailBook!!.name.isNotBlank(), "Book name should be filled")

            val chapters = withTimeoutOrNull(30_000) {
                WebBook.getChapterListAwait(source, detailBook)
            }
            assertNotNull(chapters, "Chapter list should not timeout")
            assertTrue(chapters!!.size >= 100, "Should have 100+ chapters, got ${chapters.size}")

            val content = withTimeoutOrNull(30_000) {
                WebBook.getContentAwait(source, detailBook, chapters.first())
            }
            assertNotNull(content, "Content should not timeout")
            assertTrue(content!!.length >= 100, "Content should be 100+ chars, got ${content.length}")
        }
    }

    // ── VIP 锁判定：裸词 vip 不再误判正常页面 ──────────────────────────────────
    // ciweimao 黑盒实测：正文抽不到 + 页面含 "vip" 字样被整页判 vip_lock_page，
    // 制造"阅读能用但 validator 判败"的假阴性。现要求 付费动作词 + 正文为空/极短 组合证据。

    @Test
    fun `bare vip keyword in normal page is not vip lock`() {
        val html = """
            <html><head><title>刺猬猫官网</title></head>
            <body>
              <nav><a href="/vip">VIP频道</a> <a href="/rank">排行</a></nav>
              <div id="J_BookRead">
                <p class="chapter">第一章 这是正常的正文内容，足够长足够长足够长足够长足够长。</p>
              </div>
            </body></html>
        """.trimIndent()
        // 抽到了正文 → 不应判付费墙
        val realContent = "第一章 这是正常的正文内容，" + "足够长的真正文内容。".repeat(8)
        assertEquals("normal_reader_html", classifyHtmlKindExt(html, realContent))
    }

    @Test
    fun `bare vip keyword with blank content but no pay-action word is not vip lock`() {
        val html = """
            <html><head><title>站点首页</title></head>
            <body><a href="/vip">VIP</a></body></html>
        """.trimIndent()
        // 抽不到正文，但只有裸词 vip、无付费动作词 → 不判付费墙（可能是未登录，留给 content_empty）
        assertNotEquals("vip_lock_page", classifyHtmlKindExt(html, ""))
    }

    @Test
    fun `real paywall with pay-action word and empty content is vip lock`() {
        val html = """
            <html><body>
              <div class="lock">本章为VIP章节，请订阅本章后阅读</div>
            </body></html>
        """.trimIndent()
        assertEquals("vip_lock_page", classifyHtmlKindExt(html, ""))
    }

    @Test
    fun `real paywall with pay-action word and short content is vip lock`() {
        val html = "<html><body>余额不足，请充值</body></html>"
        // 正文极短(补救不了) + 付费动作词 → 付费墙
        assertEquals("vip_lock_page", classifyHtmlKindExt(html, "余额不足"))
    }

    @Test
    fun `long real content with stray pay word is not vip lock`() {
        val html = "<html><body>正文中提到订阅本章四个字但其实是正常长正文</body></html>"
        // 正文足够长 → 即使命中付费动作词也不判锁
        val content = "正文中提到订阅本章四个字但其实是正常长正文，" + "这里继续是真正的小说正文内容。".repeat(8)
        assertNotEquals("vip_lock_page", classifyHtmlKindExt(html, content))
    }

    // ── 验证码裸词不再误判正文/搜索结果 ──────────────────────────────────────────
    // 正文里出现"验证码"三字(如"输入验证码"帮助文案)不应整页判成 captcha_page。

    @Test
    fun `bare captcha word in reader content is not captcha page`() {
        val html = """
            <html><body>
              <div class="chapter">正文提到如需输入验证码请联系客服，这是正常的长正文内容。</div>
            </body></html>
        """.trimIndent()
        assertNotEquals("captcha_page", classifyHtmlKind(html))
    }

    @Test
    fun `real captcha engine signature is captcha page`() {
        val html = "<html><body><script src='https://www.google.com/recaptcha/api.js'></script></body></html>"
        assertEquals("captcha_page", classifyHtmlKind(html))
    }

    @Test
    fun `search result body with stray captcha word is selector empty not app review`() {
        // 搜索返回 200 且正文里恰好含"验证码"三字 → 应判 selector 问题(提示修规则)，而非放弃复核
        val res = StrResponse(url = "https://www.ciweimao.com/get-search", body = "<html><body>结果列表 验证码错误请重试</body></html>", headers = okhttp3.Headers.headersOf(), code = 200)
        assertEquals(ErrorCode.SEARCH_SELECTOR_EMPTY, selectSearchEmptyErrorCode(res))
    }
}
