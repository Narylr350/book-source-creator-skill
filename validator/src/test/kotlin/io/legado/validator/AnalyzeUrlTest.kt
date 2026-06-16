package io.legado.validator

import io.legado.validator.analyzeRule.AnalyzeUrl
import io.legado.validator.model.BookSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class AnalyzeUrlTest {
    @Test
    fun `relative URL resolves against baseUrl`() {
        val source = BookSource(bookSourceUrl = "http://appi.kuwo.cn")
        val au = AnalyzeUrl(
            mUrl = "/novels/api/book/search?keyword={{key}}&pi={{page}}",
            key = "test", page = 1,
            source = source
        )
        assertEquals("http://appi.kuwo.cn/novels/api/book/search?keyword=test&pi=1", au.url)
    }

    @Test
    fun `js URL rule executes and produces URL`() {
        val source = BookSource(bookSourceUrl = "https://example.com")
        val au = AnalyzeUrl(
            mUrl = """@js:'https://example.com/search?keyword=' + java.encodeURI(key)""",
            key = "测试",
            source = source
        )
        assertEquals("https://example.com/search?keyword=%E6%B5%8B%E8%AF%95", au.url)
    }

    @Test
    fun `js tag URL rule executes`() {
        val source = BookSource(bookSourceUrl = "https://example.com")
        val au = AnalyzeUrl(
            mUrl = """<js>'/search.html,' + JSON.stringify({"method":"POST","body":"key=" + key})</js>""",
            key = "test",
            source = source
        )
        assertEquals("/search.html", au.url)
    }

    @Test
    fun `JSON option method POST sets method and body`() {
        val source = BookSource(bookSourceUrl = "https://example.com")
        val au = AnalyzeUrl(
            mUrl = """/search.html,{"method":"POST","body":"searchkey={{key}}"}""",
            key = "测试",
            source = source
        )
        assertTrue(au.isPost())
        assertEquals("searchkey=测试", au.body)
        assertEquals("https://example.com/search.html", au.url)
    }

    @Test
    fun `JSON option charset sets charset`() {
        val source = BookSource(bookSourceUrl = "https://example.com")
        val au = AnalyzeUrl(
            mUrl = """/search.php,{"charset":"gbk"}""",
            source = source
        )
        assertEquals("gbk", au.charset)
        assertEquals("https://example.com/search.php", au.url)
    }

    @Test
    fun `JSON option headers sets headerMap`() {
        val source = BookSource(bookSourceUrl = "https://example.com")
        val au = AnalyzeUrl(
            mUrl = """/api,{"headers":{"X-Custom":"foo","Authorization":"Bearer token"}}""",
            source = source
        )
        assertEquals("foo", au.headerMap["X-Custom"])
        assertEquals("Bearer token", au.headerMap["Authorization"])
        assertEquals("https://example.com/api", au.url)
    }

    @Test
    fun `malformed JSON is treated as part of URL`() {
        val source = BookSource(bookSourceUrl = "https://example.com")
        val au = AnalyzeUrl(
            mUrl = """/search,{not valid json""",
            source = source
        )
        // Should not crash, URL stays as-is (relative resolved)
        assertEquals("https://example.com/search,{not valid json", au.url)
    }
}
