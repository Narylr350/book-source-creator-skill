package io.legado.validator.webBook

import io.legado.validator.analyzeRule.AnalyzeRule
import io.legado.validator.model.Book
import io.legado.validator.model.BookSource
import kotlinx.coroutines.ensureActive
import java.net.URL
import kotlin.coroutines.coroutineContext

object BookInfo {

    var lastRuleHits: List<AnalyzeRule.RuleHitEntry> = emptyList()
        private set

    suspend fun analyzeBookInfo(
        bookSource: BookSource,
        book: Book,
        baseUrl: String,
        redirectUrl: String,
        body: String?,
        canReName: Boolean = true
    ) {
        body ?: throw IllegalArgumentException("获取网页内容失败: $baseUrl")
        DebugLog.log("≡获取成功:$baseUrl")
        val analyzeRule = AnalyzeRule(book, bookSource)
        analyzeRule.setContent(body).setBaseUrl(baseUrl)
        analyzeRule.setRedirectUrl(redirectUrl)
        analyzeRule.setCoroutineContext(coroutineContext)
        analyzeBookInfo(book, body, analyzeRule, bookSource, baseUrl, redirectUrl, canReName)
    }

    suspend fun analyzeBookInfo(
        book: Book,
        body: String,
        analyzeRule: AnalyzeRule,
        bookSource: BookSource,
        baseUrl: String,
        redirectUrl: String,
        canReName: Boolean
    ) {
        val infoRule = bookSource.getBookInfoRule()
        infoRule.init?.let {
            if (it.isNotBlank()) {
                coroutineContext.ensureActive()
                DebugLog.log("≡执行详情页初始化规则")
                analyzeRule.setContent(analyzeRule.getElement(it))
            }
        }
        val mCanReName = canReName && !infoRule.canReName.isNullOrBlank()
        coroutineContext.ensureActive()
        DebugLog.log("┌获取书名")
        analyzeRule.setFieldName("name").getString(infoRule.name).trim().let {
            if (it.isNotEmpty() && (mCanReName || book.name.isEmpty())) {
                book.name = it
            }
            DebugLog.log("└$it")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取作者")
        analyzeRule.setFieldName("author").getString(infoRule.author).trim().let {
            if (it.isNotEmpty() && (mCanReName || book.author.isEmpty())) {
                book.author = it
            }
            DebugLog.log("└$it")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取分类")
        try {
            analyzeRule.setFieldName("kind").getStringList(infoRule.kind)
                ?.joinToString(",")
                ?.let {
                    if (it.isNotEmpty()) book.kind = it
                    DebugLog.log("└$it")
                } ?: DebugLog.log("└")
        } catch (e: Exception) {
            DebugLog.log("└${e.localizedMessage}")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取字数")
        try {
            analyzeRule.setFieldName("wordCount").getString(infoRule.wordCount).let {
                if (it.isNotEmpty()) book.wordCount = it
                DebugLog.log("└$it")
            }
        } catch (e: Exception) {
            DebugLog.log("└${e.localizedMessage}")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取最新章节")
        try {
            analyzeRule.setFieldName("lastChapter").getString(infoRule.lastChapter).let {
                if (it.isNotEmpty()) book.lastChapter = it
                DebugLog.log("└$it")
            }
        } catch (e: Exception) {
            DebugLog.log("└${e.localizedMessage}")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取更新时间")
        try {
            analyzeRule.setFieldName("updateTime").getString(infoRule.updateTime).let {
                if (it.isNotEmpty()) book.updateTime = it
                DebugLog.log("└$it")
            }
        } catch (e: Exception) {
            DebugLog.log("└${e.localizedMessage}")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取简介")
        try {
            stripHtmlTags(analyzeRule.setFieldName("intro").getString(infoRule.intro)).let {
                if (it.isNotEmpty()) book.intro = it
                DebugLog.log("└$it")
            }
        } catch (e: Exception) {
            DebugLog.log("└${e.localizedMessage}")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取封面链接")
        try {
            analyzeRule.setFieldName("coverUrl").getString(infoRule.coverUrl).let {
                if (it.isNotEmpty()) {
                    book.coverUrl = getAbsoluteURL(redirectUrl, it)
                }
                DebugLog.log("└$it")
            }
        } catch (e: Exception) {
            DebugLog.log("└${e.localizedMessage}")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取目录链接")
        book.tocUrl = analyzeRule.setFieldName("tocUrl").getString(infoRule.tocUrl, isUrl = true)
        if (book.tocUrl.isEmpty()) book.tocUrl = baseUrl
        DebugLog.log("└${book.tocUrl}")
        lastRuleHits = analyzeRule.ruleHits.toList()
    }

    private fun stripHtmlTags(html: String): String {
        return html
            .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("</?(?:p|div)[^>]*>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("<[^>]+>"), "")
            .replace(Regex("&nbsp;"), " ")
            .replace(Regex("&lt;"), "<")
            .replace(Regex("&gt;"), ">")
            .replace(Regex("&amp;"), "&")
            .replace(Regex("&quot;"), "\"")
            .replace(Regex("\\n{3,}"), "\n\n")
            .trim()
    }

    private fun getAbsoluteURL(baseUrl: String, relativeUrl: String): String {
        if (relativeUrl.isBlank()) return ""
        if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) return relativeUrl
        return try {
            URL(URL(baseUrl), relativeUrl).toString()
        } catch (e: Exception) {
            relativeUrl
        }
    }
}
