package io.legado.validator.webBook

import io.legado.validator.analyzeRule.AnalyzeRule
import io.legado.validator.model.Book
import io.legado.validator.model.BookSource
import kotlinx.coroutines.ensureActive
import java.net.URL
import kotlin.coroutines.coroutineContext

object BookInfo {

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
        analyzeRule.getString(infoRule.name).trim().let {
            if (it.isNotEmpty() && (mCanReName || book.name.isEmpty())) {
                book.name = it
            }
            DebugLog.log("└$it")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取作者")
        analyzeRule.getString(infoRule.author).trim().let {
            if (it.isNotEmpty() && (mCanReName || book.author.isEmpty())) {
                book.author = it
            }
            DebugLog.log("└$it")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取分类")
        try {
            analyzeRule.getStringList(infoRule.kind)
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
            analyzeRule.getString(infoRule.wordCount).let {
                if (it.isNotEmpty()) book.wordCount = it
                DebugLog.log("└$it")
            }
        } catch (e: Exception) {
            DebugLog.log("└${e.localizedMessage}")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取最新章节")
        try {
            analyzeRule.getString(infoRule.lastChapter).let {
                if (it.isNotEmpty()) book.lastChapter = it
                DebugLog.log("└$it")
            }
        } catch (e: Exception) {
            DebugLog.log("└${e.localizedMessage}")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取简介")
        try {
            stripHtmlTags(analyzeRule.getString(infoRule.intro)).let {
                if (it.isNotEmpty()) book.intro = it
                DebugLog.log("└$it")
            }
        } catch (e: Exception) {
            DebugLog.log("└${e.localizedMessage}")
        }
        coroutineContext.ensureActive()
        DebugLog.log("┌获取封面链接")
        try {
            analyzeRule.getString(infoRule.coverUrl).let {
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
        book.tocUrl = analyzeRule.getString(infoRule.tocUrl, isUrl = true)
        if (book.tocUrl.isEmpty()) book.tocUrl = baseUrl
        DebugLog.log("└${book.tocUrl}")
    }

    private fun stripHtmlTags(html: String): String {
        return html.replace(Regex("<[^>]+>"), "").trim()
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
