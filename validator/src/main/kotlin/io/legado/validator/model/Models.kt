package io.legado.validator.model

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.reflect.TypeToken
import io.legado.validator.model.rule.*
import io.legado.validator.analyzeRule.RuleData
import io.legado.validator.analyzeRule.RuleDataInterface
import io.legado.validator.analyzeRule.RhinoAdapter
import io.legado.validator.help.JsHelper

data class BookSource(
    var bookSourceUrl: String = "",
    var bookSourceName: String = "",
    var bookSourceGroup: String? = null,
    var bookSourceType: Int = 0,
    var bookUrlPattern: String? = null,
    var enabled: Boolean = true,
    var enabledExplore: Boolean = true,
    var jsLib: String? = null,
    var enabledCookieJar: Boolean? = null,
    var concurrentRate: String? = null,
    var header: String? = null,
    var loginUrl: String? = null,
    var loginCheckJs: String? = null,
    var searchUrl: String? = null,
    var ruleSearch: SearchRule? = null,
    var ruleBookInfo: BookInfoRule? = null,
    var ruleToc: TocRule? = null,
    var ruleContent: ContentRule? = null,
    var exploreUrl: String? = null,
    var ruleExplore: Any? = null,
    var lastUpdateTime: Long = 0,
    var weight: Int = 0
) {
    @Transient
    private val variableMap = hashMapOf<String, String>()

    fun put(key: String, value: String): String {
        variableMap[key] = value
        return value
    }

    fun get(key: String): String = variableMap[key] ?: ""

    companion object {
        val gson: Gson = GsonBuilder().create()

        fun fromJson(json: String): List<BookSource> {
            val type = object : TypeToken<List<BookSource>>() {}.type
            return gson.fromJson(json, type)
        }

        fun fromJsonObject(json: String): BookSource {
            return gson.fromJson(json, BookSource::class.java)
        }
    }

    fun getSearchRule(): SearchRule = ruleSearch ?: SearchRule()
    fun getBookInfoRule(): BookInfoRule = ruleBookInfo ?: BookInfoRule()
    fun getTocRule(): TocRule = ruleToc ?: TocRule()
    fun getContentRule(): ContentRule = ruleContent ?: ContentRule()

    fun getHeaderMap(): Map<String, String> {
        if (header.isNullOrBlank()) return emptyMap()
        val headerStr = header!!.trim()
        val resolved = try {
            if (headerStr.startsWith("@js:")) {
                RhinoAdapter.eval(headerStr.substring(4), mapOf("source" to this, "java" to JsHelper))
            } else if (headerStr.startsWith("<js>") && headerStr.endsWith("</js>")) {
                RhinoAdapter.eval(headerStr.substring(4, headerStr.length - 5), mapOf("source" to this, "java" to JsHelper))
            } else null
        } catch (_: Exception) { null }
        val jsonStr = when {
            resolved is Map<*, *> -> resolved.entries.associate { (k, v) -> k.toString() to v.toString() }
                .let { gson.toJson(it) }
            resolved != null -> resolved.toString()
            else -> headerStr
        }
        return try {
            val type = object : TypeToken<Map<String, String>>() {}.type
            gson.fromJson(jsonStr, type)
        } catch (e: Exception) { emptyMap() }
    }
}

data class SearchBook(
    var bookUrl: String = "",
    var name: String = "",
    var author: String = "",
    var kind: String = "",
    var coverUrl: String = "",
    var intro: String = "",
    var lastChapter: String = "",
    var wordCount: String = ""
)

data class Book(
    var bookUrl: String = "",
    var name: String = "",
    var author: String = "",
    var kind: String = "",
    var coverUrl: String = "",
    var intro: String = "",
    var lastChapter: String = "",
    var wordCount: String = "",
    var tocUrl: String = "",
    var updateTime: String = ""
) : RuleDataInterface {
    override val variableMap = hashMapOf<String, String>()
    override fun putBigVariable(key: String, value: String?) {
        if (value == null) variableMap.remove(key) else variableMap[key] = value
    }
    override fun getBigVariable(key: String): String? = null
}

data class BookChapter(
    var index: Int = 0,
    var title: String = "",
    var url: String = "",
    var baseUrl: String = "",
    var isVip: Boolean = false,
    var isPay: Boolean = false,
    var tag: String? = null,
    var updateTime: Long = 0L,
    var isVolume: Boolean = false
) : RuleDataInterface {
    override val variableMap = hashMapOf<String, String>()
    override fun putBigVariable(key: String, value: String?) {
        if (value == null) variableMap.remove(key) else variableMap[key] = value
    }
    override fun getBigVariable(key: String): String? = null
}
