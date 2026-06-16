package io.legado.validator.webBook

import io.legado.validator.analyzeRule.AnalyzeRule
import io.legado.validator.analyzeRule.AnalyzeUrl
import io.legado.validator.model.Book
import io.legado.validator.model.BookChapter
import io.legado.validator.model.BookSource
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

object BookContent {

    var lastRuleHits: List<AnalyzeRule.RuleHitEntry> = emptyList()
        private set

    suspend fun analyzeContent(
        bookSource: BookSource,
        book: Book,
        bookChapter: BookChapter,
        baseUrl: String,
        redirectUrl: String,
        body: String?,
        nextChapterUrl: String? = null
    ): String {
        body ?: throw IllegalArgumentException("获取网页内容失败: $baseUrl")
        DebugLog.log("≡获取成功:$baseUrl")
        val contentList = arrayListOf<String>()
        val nextUrlList = arrayListOf(redirectUrl)
        val contentRule = bookSource.getContentRule()
        val analyzeRule = AnalyzeRule(book, bookSource)
        analyzeRule.setContent(body, baseUrl)
        analyzeRule.setRedirectUrl(redirectUrl)
        analyzeRule.setCoroutineContext(coroutineContext)
        analyzeRule.chapter = bookChapter
        analyzeRule.nextChapterUrl = nextChapterUrl
        coroutineContext.ensureActive()
        val titleRule = contentRule.title
        if (!titleRule.isNullOrBlank()) {
            val title = analyzeRule.runCatching {
                getString(titleRule)
            }.onFailure {
                DebugLog.log("获取标题出错, ${it.localizedMessage}")
            }.getOrNull()
            if (!title.isNullOrBlank()) {
                bookChapter.title = title
            }
        }
        var contentData = analyzeContent(
            book, baseUrl, redirectUrl, body, contentRule, bookChapter, bookSource, nextChapterUrl
        )
        contentList.add(contentData.first)
        if (contentData.second.size == 1) {
            var nextUrl = contentData.second[0]
            while (nextUrl.isNotEmpty() && !nextUrlList.contains(nextUrl)) {
                nextUrlList.add(nextUrl)
                coroutineContext.ensureActive()
                val analyzeUrl = AnalyzeUrl(
                    mUrl = nextUrl,
                    source = bookSource,
                    ruleData = book,
                    chapter = bookChapter
                )
                val res = analyzeUrl.getStrResponseAwait()
                res.body.let { nextBody ->
                    contentData = analyzeContent(
                        book, nextUrl, res.url, nextBody, contentRule,
                        bookChapter, bookSource, nextChapterUrl, printLog = false
                    )
                    nextUrl = if (contentData.second.isNotEmpty()) contentData.second[0] else ""
                    contentList.add(contentData.first)
                    DebugLog.log("第${contentList.size}页完成")
                }
            }
            DebugLog.log("◇本章总页数:${nextUrlList.size}")
        } else if (contentData.second.size > 1) {
            DebugLog.log("◇并发解析正文,总页数:${contentData.second.size}")
            for (urlStr in contentData.second) {
                val analyzeUrl = AnalyzeUrl(
                    mUrl = urlStr,
                    source = bookSource,
                    ruleData = book,
                    chapter = bookChapter
                )
                val res = analyzeUrl.getStrResponseAwait()
                coroutineContext.ensureActive()
                contentList.add(
                    analyzeContent(
                        book, urlStr, res.url, res.body, contentRule,
                        bookChapter, bookSource, nextChapterUrl,
                        getNextPageUrl = false, printLog = false
                    ).first
                )
            }
        }
        var contentStr = contentList.joinToString("\n")
        val replaceRegex = contentRule.replaceRegex
        if (!replaceRegex.isNullOrEmpty()) {
            contentStr = contentStr.split("\n").joinToString("\n") { it.trim() }
            contentStr = analyzeRule.getString(replaceRegex, contentStr)
            contentStr = contentStr.split("\n").joinToString("\n") { "　　$it" }
        }
        DebugLog.log("┌获取章节名称")
        DebugLog.log("└${bookChapter.title}")
        DebugLog.log("┌获取正文内容")
        DebugLog.log("└\n$contentStr")
        if (contentStr.isBlank()) {
            throw IllegalArgumentException("内容为空")
        }
        return contentStr
    }

    private suspend fun analyzeContent(
        book: Book,
        baseUrl: String,
        redirectUrl: String,
        body: String,
        contentRule: io.legado.validator.model.rule.ContentRule,
        chapter: BookChapter,
        bookSource: BookSource,
        nextChapterUrl: String? = null,
        getNextPageUrl: Boolean = true,
        printLog: Boolean = true
    ): Pair<String, List<String>> {
        val analyzeRule = AnalyzeRule(book, bookSource)
        analyzeRule.setContent(body, baseUrl)
        analyzeRule.setCoroutineContext(coroutineContext)
        val rUrl = analyzeRule.setRedirectUrl(redirectUrl)
        analyzeRule.chapter = chapter
        analyzeRule.nextChapterUrl = nextChapterUrl
        val nextUrlList = arrayListOf<String>()
        var content = analyzeRule.setFieldName("content").getString(contentRule.content)
        content = stripHtmlTagsKeepNewlines(content)
        if (getNextPageUrl) {
            val nextUrlRule = contentRule.nextContentUrl
            if (!nextUrlRule.isNullOrEmpty()) {
                DebugLog.log("┌获取正文下一页链接")
                analyzeRule.getStringList(nextUrlRule, isUrl = true)?.let {
                    nextUrlList.addAll(it)
                }
                DebugLog.log("└" + nextUrlList.joinToString("，"))
            }
        }
        lastRuleHits = analyzeRule.ruleHits.toList()
        return Pair(content, nextUrlList)
    }

    private fun stripHtmlTagsKeepNewlines(html: String): String {
        return html
            .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("<img\\s+([^>]*)/?>", RegexOption.IGNORE_CASE), "<img $1>")
            .replace(Regex("</?(?!img)[a-zA-Z]+(?=[ >])[^<>]*>"), "")
            .replace(Regex("&nbsp;"), " ")
            .replace(Regex("&lt;"), "<")
            .replace(Regex("&gt;"), ">")
            .replace(Regex("&amp;"), "&")
            .replace(Regex("&quot;"), "\"")
            .replace(Regex("&apos;"), "'")
            .replace(Regex("&#(\\d+);")) { it.groupValues[1].toIntOrNull()?.let { c -> Char(c).toString() } ?: it.value }
            .replace(Regex("&#x([0-9a-fA-F]+);")) { it.groupValues[1].toIntOrNull(16)?.let { c -> Char(c).toString() } ?: it.value }
            .trim()
    }
}
