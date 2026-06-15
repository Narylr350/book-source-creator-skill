package io.legado.validator.webBook

import io.legado.validator.analyzeRule.AnalyzeRule
import io.legado.validator.analyzeRule.AnalyzeUrl
import io.legado.validator.analyzeRule.RuleData
import io.legado.validator.help.http.StrResponse
import io.legado.validator.model.Book
import io.legado.validator.model.BookChapter
import io.legado.validator.model.BookSource
import io.legado.validator.model.SearchBook
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object WebBook {

    var lastResponse: StrResponse? = null
        private set
    var lastAnalyzeUrl: AnalyzeUrl? = null
        private set
    var lastRuleHits: List<AnalyzeRule.RuleHitEntry> = emptyList()
        private set

    fun clearState() {
        lastResponse = null
        lastAnalyzeUrl = null
        lastRuleHits = emptyList()
    }

    suspend fun searchBookAwait(
        bookSource: BookSource,
        key: String,
        page: Int? = 1
    ): ArrayList<SearchBook> = withContext(Dispatchers.IO) {
        val searchUrl = bookSource.searchUrl
        if (searchUrl.isNullOrBlank()) {
            throw IllegalArgumentException("搜索url不能为空")
        }
        val ruleData = RuleData()
        val analyzeUrl = AnalyzeUrl(
            mUrl = searchUrl,
            key = key,
            page = page,
            baseUrl = bookSource.bookSourceUrl,
            source = bookSource,
            ruleData = ruleData
        )
        val res = analyzeUrl.getStrResponseAwait()
        lastResponse = res
        lastAnalyzeUrl = analyzeUrl
        BookList.analyzeBookList(
            bookSource = bookSource,
            ruleData = ruleData,
            analyzeUrl = analyzeUrl,
            baseUrl = res.url,
            body = res.body,
            isSearch = true
        )
    }

    suspend fun getBookInfoAwait(
        bookSource: BookSource,
        book: Book
    ): Book = withContext(Dispatchers.IO) {
        val analyzeUrl = AnalyzeUrl(
            mUrl = book.bookUrl,
            baseUrl = bookSource.bookSourceUrl,
            source = bookSource,
            ruleData = book
        )
        val res = analyzeUrl.getStrResponseAwait()
        lastResponse = res
        lastAnalyzeUrl = analyzeUrl
        BookInfo.analyzeBookInfo(
            bookSource = bookSource,
            book = book,
            baseUrl = book.bookUrl,
            redirectUrl = res.url,
            body = res.body
        )
        book
    }

    suspend fun getChapterListAwait(
        bookSource: BookSource,
        book: Book
    ): List<BookChapter> = withContext(Dispatchers.IO) {
        val analyzeUrl = AnalyzeUrl(
            mUrl = book.tocUrl,
            baseUrl = book.bookUrl,
            source = bookSource,
            ruleData = book
        )
        val res = analyzeUrl.getStrResponseAwait()
        lastResponse = res
        lastAnalyzeUrl = analyzeUrl
        BookChapterList.analyzeChapterList(
            bookSource = bookSource,
            book = book,
            baseUrl = book.tocUrl,
            redirectUrl = res.url,
            body = res.body
        )
    }

    suspend fun getContentAwait(
        bookSource: BookSource,
        book: Book,
        bookChapter: BookChapter,
        nextChapterUrl: String? = null
    ): String = withContext(Dispatchers.IO) {
        val contentRule = bookSource.getContentRule()
        if (contentRule.content.isNullOrEmpty()) {
            DebugLog.log("⇒正文规则为空,使用章节链接:${bookChapter.url}")
            return@withContext bookChapter.url
        }
        val analyzeUrl = AnalyzeUrl(
            mUrl = bookChapter.url,
            baseUrl = book.tocUrl,
            source = bookSource,
            ruleData = book,
            chapter = bookChapter
        )
        val res = analyzeUrl.getStrResponseAwait()
        lastResponse = res
        lastAnalyzeUrl = analyzeUrl
        BookContent.analyzeContent(
            bookSource = bookSource,
            book = book,
            bookChapter = bookChapter,
            baseUrl = bookChapter.url,
            redirectUrl = res.url,
            body = res.body,
            nextChapterUrl = nextChapterUrl
        )
    }
}
