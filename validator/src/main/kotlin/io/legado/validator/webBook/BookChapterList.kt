package io.legado.validator.webBook

import io.legado.validator.analyzeRule.AnalyzeRule
import io.legado.validator.analyzeRule.AnalyzeUrl
import io.legado.validator.model.Book
import io.legado.validator.model.BookChapter
import io.legado.validator.model.BookSource
import kotlinx.coroutines.ensureActive
import java.net.URL
import kotlin.coroutines.coroutineContext

object BookChapterList {

    var lastRuleHits: List<AnalyzeRule.RuleHitEntry> = emptyList()
        private set

    suspend fun analyzeChapterList(
        bookSource: BookSource,
        book: Book,
        baseUrl: String,
        redirectUrl: String,
        body: String?
    ): List<BookChapter> {
        body ?: throw IllegalArgumentException("获取网页内容失败: $baseUrl")
        val chapterList = ArrayList<BookChapter>()
        DebugLog.log("≡获取成功:$baseUrl")
        val tocRule = bookSource.getTocRule()
        val nextUrlList = arrayListOf(redirectUrl)
        var reverse = false
        var listRule = tocRule.chapterList ?: ""
        if (listRule.startsWith("-")) {
            reverse = true
            listRule = listRule.substring(1)
        }
        if (listRule.startsWith("+")) {
            listRule = listRule.substring(1)
        }
        var chapterData = analyzeChapterList(
            book, baseUrl, redirectUrl, body,
            tocRule, listRule, bookSource, log = true
        )
        chapterList.addAll(chapterData.first)
        when (chapterData.second.size) {
            0 -> Unit
            1 -> {
                var nextUrl = chapterData.second[0]
                while (nextUrl.isNotEmpty() && !nextUrlList.contains(nextUrl)) {
                    nextUrlList.add(nextUrl)
                    val analyzeUrl = AnalyzeUrl(
                        mUrl = nextUrl,
                        source = bookSource,
                        ruleData = book
                    )
                    val res = analyzeUrl.getStrResponseAwait()
                    res.body.let { nextBody ->
                        chapterData = analyzeChapterList(
                            book, nextUrl, nextUrl,
                            nextBody, tocRule, listRule, bookSource
                        )
                        nextUrl = chapterData.second.firstOrNull() ?: ""
                        chapterList.addAll(chapterData.first)
                    }
                }
                DebugLog.log("◇目录总页数:${nextUrlList.size}")
            }
            else -> {
                DebugLog.log("◇并发解析目录,总页数:${chapterData.second.size}")
                for (urlStr in chapterData.second) {
                    val analyzeUrl = AnalyzeUrl(
                        mUrl = urlStr,
                        source = bookSource,
                        ruleData = book
                    )
                    val res = analyzeUrl.getStrResponseAwait()
                    val data = analyzeChapterList(
                        book, urlStr, res.url,
                        res.body, tocRule, listRule, bookSource, false
                    )
                    chapterList.addAll(data.first)
                }
            }
        }
        if (chapterList.isEmpty()) {
            throw IllegalArgumentException("目录列表为空")
        }
        if (!reverse) {
            chapterList.reverse()
        }
        coroutineContext.ensureActive()
        val lh = LinkedHashSet(chapterList)
        val list = ArrayList(lh)
        list.reverse()
        DebugLog.log("◇目录总数:${list.size}")
        if (nextUrlList.size <= 1 && list.size < 5 && list.size > 0) {
            DebugLog.log("⚠ 目录仅解析到 ${list.size} 章（${nextUrlList.size} 页），如果站点目录是分页 API，请检查 nextTocUrl 规则是否正确配置")
        }
        coroutineContext.ensureActive()
        list.forEachIndexed { index, bookChapter ->
            bookChapter.index = index
        }
        return list
    }

    @Suppress("UNUSED_PARAMETER")
    private suspend fun analyzeChapterList(
        book: Book,
        baseUrl: String,
        redirectUrl: String,
        body: String,
        tocRule: io.legado.validator.model.rule.TocRule,
        listRule: String,
        bookSource: BookSource,
        getNextUrl: Boolean = true,
        log: Boolean = false
    ): Pair<List<BookChapter>, List<String>> {
        val analyzeRule = AnalyzeRule(book, bookSource)
        analyzeRule.setContent(body).setBaseUrl(baseUrl)
        analyzeRule.setRedirectUrl(redirectUrl)
        analyzeRule.setCoroutineContext(coroutineContext)
        val chapterList = arrayListOf<BookChapter>()
        DebugLog.log("┌获取目录列表", )
        val elements = analyzeRule.getElements(listRule)
        DebugLog.log("└列表大小:${elements.size}")
        val nextUrlList = arrayListOf<String>()
        val nextTocRule = tocRule.nextTocUrl
        if (getNextUrl && !nextTocRule.isNullOrEmpty()) {
            DebugLog.log("┌获取目录下一页列表")
            analyzeRule.getStringList(nextTocRule, isUrl = true)?.let {
                for (item in it) {
                    if (item != redirectUrl) {
                        nextUrlList.add(item)
                    }
                }
            }
            DebugLog.log("└" + nextUrlList.joinToString("，\n"))
        }
        coroutineContext.ensureActive()
        if (elements.isNotEmpty()) {
            DebugLog.log("┌解析目录列表")
            val nameRule = analyzeRule.splitSourceRule(tocRule.chapterName)
            val urlRule = analyzeRule.splitSourceRule(tocRule.chapterUrl)
            val isVolumeRule = analyzeRule.splitSourceRule(tocRule.isVolume)
            val isVipRule = analyzeRule.splitSourceRule(tocRule.isVip)
            val isPayRule = analyzeRule.splitSourceRule(tocRule.isPay)
            val upTimeRule = analyzeRule.splitSourceRule(tocRule.updateTime)
            elements.forEachIndexed { index, item ->
                coroutineContext.ensureActive()
                analyzeRule.setContent(item)
                val bookChapter = BookChapter(baseUrl = redirectUrl)
                analyzeRule.chapter = bookChapter
                bookChapter.title = analyzeRule.setFieldName("chapterName").getString(nameRule)
                bookChapter.url = getAbsoluteURL(redirectUrl, analyzeRule.setFieldName("chapterUrl").getString(urlRule))
                val isVolume = analyzeRule.setFieldName("isVolume").getString(isVolumeRule)
                bookChapter.isVolume = isVolume == "true" || isVolume == "1"
                if (bookChapter.url.isEmpty()) {
                    bookChapter.url = baseUrl
                    DebugLog.log("⇒目录${index}未获取到url,使用baseUrl替代")
                }
                if (bookChapter.title.isNotEmpty()) {
                    val isVip = analyzeRule.getString(isVipRule)
                    val isPay = analyzeRule.getString(isPayRule)
                    bookChapter.isVip = isVip == "true" || isVip == "1"
                    bookChapter.isPay = isPay == "true" || isPay == "1"
                    val upTimeStr = analyzeRule.setFieldName("updateTime").getString(upTimeRule)
                    if (upTimeStr.isNotEmpty()) {
                        bookChapter.updateTime = try {
                            java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").parse(upTimeStr)?.time ?: 0L
                        } catch (_: Exception) { 0L }
                    }
                    chapterList.add(bookChapter)
                }
            }
            DebugLog.log("└目录列表解析完成")
            if (chapterList.isEmpty()) {
                DebugLog.log("◇章节列表为空")
            } else {
                DebugLog.log("≡首章信息")
                DebugLog.log("◇章节名称:${chapterList[0].title}")
                DebugLog.log("◇章节链接:${chapterList[0].url}")
            }
        }
        val formatJs = tocRule.formatJs
        if (!formatJs.isNullOrBlank()) {
            chapterList.forEach { chapter ->
                try {
                    analyzeRule.chapter = chapter
                    analyzeRule.setContent(chapter.url)
                    analyzeRule.evalJS(formatJs, chapter.title)
                } catch (e: Exception) {
                    DebugLog.log("formatJs error: ${e.message}")
                }
            }
        }
        lastRuleHits = analyzeRule.ruleHits.toList()
        return Pair(chapterList, nextUrlList)
    }

    private fun getAbsoluteURL(baseUrl: String, relativeUrl: String): String {
        if (relativeUrl.isBlank()) return ""
        @Suppress("HttpUrlsUsage") // string check, not actual HTTP
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
