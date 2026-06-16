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
}
