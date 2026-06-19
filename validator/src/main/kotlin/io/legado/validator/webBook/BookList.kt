package io.legado.validator.webBook

import io.legado.validator.analyzeRule.AnalyzeRule
import io.legado.validator.analyzeRule.AnalyzeUrl
import io.legado.validator.analyzeRule.RuleData
import io.legado.validator.model.Book
import io.legado.validator.model.BookSource
import io.legado.validator.model.SearchBook
import kotlinx.coroutines.ensureActive
import java.net.URL
import kotlin.coroutines.coroutineContext

object BookList {

    var lastRuleHits: List<AnalyzeRule.RuleHitEntry> = emptyList()
        private set

    suspend fun analyzeBookList(
        bookSource: BookSource,
        ruleData: RuleData,
        analyzeUrl: AnalyzeUrl,
        baseUrl: String,
        body: String?,
        isSearch: Boolean = true
    ): ArrayList<SearchBook> {
        body ?: throw IllegalArgumentException("获取网页内容失败: ${analyzeUrl.ruleUrl}")
        val bookList = ArrayList<SearchBook>()
        DebugLog.log("≡获取成功:${analyzeUrl.ruleUrl}")
        val analyzeRule = AnalyzeRule(ruleData, bookSource)
        analyzeRule.setContent(body).setBaseUrl(baseUrl)
        analyzeRule.setRedirectUrl(baseUrl)
        analyzeRule.setCoroutineContext(coroutineContext)
        if (isSearch) bookSource.bookUrlPattern?.let {
            coroutineContext.ensureActive()
            if (baseUrl.matches(it.toRegex())) {
                DebugLog.log("≡链接为详情页")
                getInfoItem(bookSource, analyzeRule, analyzeUrl, body, baseUrl)?.let { searchBook ->
                    bookList.add(searchBook)
                }
                return bookList
            }
        }
        val bookListRule = bookSource.getSearchRule()
        var ruleList = bookListRule.bookList ?: ""
        var reverse = false
        if (ruleList.startsWith("-")) {
            reverse = true
            ruleList = ruleList.substring(1)
        }
        if (ruleList.startsWith("+")) {
            ruleList = ruleList.substring(1)
        }
        DebugLog.log("┌获取书籍列表")
        val collections = analyzeRule.getElements(ruleList)
        coroutineContext.ensureActive()
        if (collections.isEmpty() && bookSource.bookUrlPattern.isNullOrEmpty()) {
            DebugLog.log("└列表为空,按详情页解析")
            getInfoItem(bookSource, analyzeRule, analyzeUrl, body, baseUrl)?.let { searchBook ->
                bookList.add(searchBook)
            }
        } else {
            val ruleName = analyzeRule.splitSourceRule(bookListRule.name)
            val ruleBookUrl = analyzeRule.splitSourceRule(bookListRule.bookUrl)
            val ruleAuthor = analyzeRule.splitSourceRule(bookListRule.author)
            val ruleCoverUrl = analyzeRule.splitSourceRule(bookListRule.coverUrl)
            val ruleIntro = analyzeRule.splitSourceRule(bookListRule.intro)
            val ruleKind = analyzeRule.splitSourceRule(bookListRule.kind)
            val ruleLastChapter = analyzeRule.splitSourceRule(bookListRule.lastChapter)
            val ruleWordCount = analyzeRule.splitSourceRule(bookListRule.wordCount)
            DebugLog.log("└列表大小:${collections.size}")
            for ((index, item) in collections.withIndex()) {
                getSearchItem(
                    bookSource, analyzeRule, item, baseUrl,
                    index == 0,
                    ruleName, ruleBookUrl, ruleAuthor, ruleCoverUrl,
                    ruleIntro, ruleKind, ruleLastChapter, ruleWordCount
                )?.let { searchBook ->
                    bookList.add(searchBook)
                }
            }
            val lh = LinkedHashSet(bookList)
            bookList.clear()
            bookList.addAll(lh)
            if (reverse) {
                bookList.reverse()
            }
        }
        DebugLog.log("◇书籍总数:${bookList.size}")
        lastRuleHits = analyzeRule.ruleHits.toList()
        return bookList
    }

    private suspend fun getInfoItem(
        bookSource: BookSource,
        analyzeRule: AnalyzeRule,
        analyzeUrl: AnalyzeUrl,
        body: String,
        baseUrl: String
    ): SearchBook? {
        val book = Book()
        book.bookUrl = getAbsoluteURL(analyzeUrl.url, analyzeUrl.ruleUrl)
        analyzeRule.ruleData = book
        BookInfo.analyzeBookInfo(book, body, analyzeRule, bookSource, baseUrl, baseUrl, false)
        if (book.name.isNotBlank()) {
            return SearchBook(
                bookUrl = book.bookUrl,
                name = book.name,
                author = book.author,
                kind = book.kind,
                coverUrl = book.coverUrl,
                intro = book.intro,
                lastChapter = book.lastChapter,
                wordCount = book.wordCount
            )
        }
        return null
    }

    @Suppress("UNUSED_PARAMETER")
    private suspend fun getSearchItem(
        bookSource: BookSource,
        analyzeRule: AnalyzeRule,
        item: Any,
        baseUrl: String,
        log: Boolean,
        ruleName: List<AnalyzeRule.SourceRule>,
        ruleBookUrl: List<AnalyzeRule.SourceRule>,
        ruleAuthor: List<AnalyzeRule.SourceRule>,
        ruleCoverUrl: List<AnalyzeRule.SourceRule>,
        ruleIntro: List<AnalyzeRule.SourceRule>,
        ruleKind: List<AnalyzeRule.SourceRule>,
        ruleLastChapter: List<AnalyzeRule.SourceRule>,
        ruleWordCount: List<AnalyzeRule.SourceRule>
    ): SearchBook? {
        val searchBook = SearchBook()
        analyzeRule.ruleData = null
        analyzeRule.setContent(item)
            coroutineContext.ensureActive()
            DebugLog.log("┌获取书名")
            searchBook.name = analyzeRule.setFieldName("name").getString(ruleName).trim()
            DebugLog.log("└${searchBook.name}")
        if (searchBook.name.isNotEmpty()) {
            coroutineContext.ensureActive()
            DebugLog.log("┌获取作者")
            searchBook.author = analyzeRule.setFieldName("author").getString(ruleAuthor).trim()
            DebugLog.log("└${searchBook.author}")
            coroutineContext.ensureActive()
            DebugLog.log("┌获取分类")
            try {
                searchBook.kind = analyzeRule.setFieldName("kind").getStringList(ruleKind)?.joinToString(",") ?: ""
                DebugLog.log("└${searchBook.kind}")
            } catch (e: Exception) {
                DebugLog.log("└${e.localizedMessage}")
            }
            coroutineContext.ensureActive()
            DebugLog.log("┌获取字数")
            try {
                searchBook.wordCount = analyzeRule.setFieldName("wordCount").getString(ruleWordCount)
                DebugLog.log("└${searchBook.wordCount}")
            } catch (e: Exception) {
                DebugLog.log("└${e.localizedMessage}")
            }
            coroutineContext.ensureActive()
            DebugLog.log("┌获取最新章节")
            try {
                searchBook.lastChapter = analyzeRule.setFieldName("lastChapter").getString(ruleLastChapter)
                DebugLog.log("└${searchBook.lastChapter}")
            } catch (e: Exception) {
                DebugLog.log("└${e.localizedMessage}")
            }
            coroutineContext.ensureActive()
            DebugLog.log("┌获取简介")
            try {
                searchBook.intro = stripHtmlTags(analyzeRule.setFieldName("intro").getString(ruleIntro))
                DebugLog.log("└${searchBook.intro}")
            } catch (e: Exception) {
                DebugLog.log("└${e.localizedMessage}")
            }
            coroutineContext.ensureActive()
            DebugLog.log("┌获取封面链接")
            try {
                analyzeRule.setFieldName("coverUrl").getString(ruleCoverUrl).let {
                    if (it.isNotEmpty()) {
                        searchBook.coverUrl = getAbsoluteURL(baseUrl, it)
                    }
                }
                DebugLog.log("└${searchBook.coverUrl}")
            } catch (e: Exception) {
                DebugLog.log("└${e.localizedMessage}")
            }
            coroutineContext.ensureActive()
            DebugLog.log("┌获取详情页链接")
            searchBook.bookUrl = analyzeRule.setFieldName("bookUrl").getString(ruleBookUrl, isUrl = true)
            if (searchBook.bookUrl.isEmpty()) {
                searchBook.bookUrl = baseUrl
            }
            DebugLog.log("└${searchBook.bookUrl}")
            return searchBook
        }
        return null
    }

    private fun stripHtmlTags(html: String): String {
        return html.replace(Regex("<[^>]+>"), "").trim()
    }

    private fun getAbsoluteURL(baseUrl: String, relativeUrl: String): String {
        if (relativeUrl.isBlank()) return ""
        if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) return relativeUrl
        return try {
            runCatching {
                java.net.URI.create(baseUrl).resolve(relativeUrl).toURL().toString()
            }.getOrElse {
                @Suppress("DEPRECATION")
                java.net.URL(java.net.URL(baseUrl), relativeUrl).toString()
            }
        } catch (e: Exception) {
            relativeUrl
        }
    }
}
