package io.legado.validator

import io.legado.validator.model.BookSource
import io.legado.validator.model.rule.BookInfoRule
import io.legado.validator.model.rule.ContentRule
import io.legado.validator.model.rule.SearchRule
import io.legado.validator.model.rule.TocRule
import io.legado.validator.web.RuleValidator
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class RuleValidatorTest {

    private fun makeSource(
        chapterUrl: String? = null,
        searchUrl: String? = null,
        header: String? = null
    ): BookSource {
        return BookSource(
            bookSourceUrl = "https://example.com",
            bookSourceName = "test",
            searchUrl = searchUrl ?: "/search/{{key}}/{{page}}",
            ruleSearch = SearchRule(bookList = ".list li", name = "a@text", bookUrl = "a@href"),
            ruleBookInfo = BookInfoRule(name = "h1@text"),
            ruleToc = chapterUrl?.let { TocRule(chapterList = "li a", chapterName = "a@text", chapterUrl = it) },
            ruleContent = ContentRule(content = ".content@text"),
            header = header
        )
    }

    @Test
    fun `chapterUrl with webView but no chain operator reports error`() {
        val source = makeSource(chapterUrl = """a@href,{"webView":true}""")
        val issues = RuleValidator.validate(source)
        assertTrue(issues.any { it.field == "ruleToc.chapterUrl" && it.severity == "error" },
            "Expected error for webView without ##\$##, got: $issues")
    }

    @Test
    fun `chapterUrl with chain operator and webView passes`() {
        val source = makeSource(chapterUrl = """a@href##${'$'}##,{"webView":true}""")
        val issues = RuleValidator.validate(source)
        assertTrue(issues.none { it.field == "ruleToc.chapterUrl" },
            "Expected no issues for correct ##\$## format, got: $issues")
    }

    @Test
    fun `chapterUrl with plain URL webView passes`() {
        val source = makeSource(chapterUrl = """/chapter/123,{"webView":true}""")
        val issues = RuleValidator.validate(source)
        assertTrue(issues.none { it.field == "ruleToc.chapterUrl" },
            "Expected no issues for plain URL webView, got: $issues")
    }

    @Test
    fun `searchUrl with webView reports error`() {
        val source = makeSource(searchUrl = """/search/{{key}},{"webView":true}""")
        val issues = RuleValidator.validate(source)
        assertTrue(issues.any { it.field == "searchUrl" && it.severity == "error" },
            "Expected error for webView on searchUrl, got: $issues")
    }
}
