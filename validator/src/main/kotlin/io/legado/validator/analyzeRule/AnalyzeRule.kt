package io.legado.validator.analyzeRule

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import io.legado.validator.help.JsExtensions
import io.legado.validator.model.Book
import io.legado.validator.model.BookChapter
import io.legado.validator.model.BookSource
import org.apache.commons.text.StringEscapeUtils
import org.jsoup.nodes.Node
import org.mozilla.javascript.NativeObject
import java.net.URL
import java.util.regex.Pattern
import kotlin.coroutines.ContinuationInterceptor
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext

private val JS_PATTERN = Pattern.compile("<js>[\\w\\W]*?</js>|`[\\w\\W]*?`")
private fun String.isJson(): Boolean {
    val t = trim()
    return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))
}

class AnalyzeRule(
    var ruleData: RuleDataInterface? = null,
    private val source: BookSource? = null
) : JsExtensions {

    val book get() = ruleData as? Book

    var chapter: BookChapter? = null
    var nextChapterUrl: String? = null
    var content: Any? = null
        private set
    var baseUrl: String? = null
        private set
    var redirectUrl: URL? = null
        private set
    private var isJSON: Boolean = false
    private var isRegex: Boolean = false

    private var analyzeByXPath: AnalyzeByXPath? = null
    private var analyzeByJSoup: AnalyzeByJSoup? = null
    private var analyzeByJSonPath: AnalyzeByJSonPath? = null

    private var objectChangedXP = false
    private var objectChangedJS = false
    private var objectChangedJP = false

    private val stringRuleCache = hashMapOf<String, List<SourceRule>>()
    private var coroutineContext: CoroutineContext = EmptyCoroutineContext

    @JvmOverloads
    fun setContent(content: Any?, baseUrl: String? = null): AnalyzeRule {
        if (content == null) throw AssertionError("内容不可空")
        this.content = content
        isJSON = when (content) {
            is Node -> false
            else -> content.toString().isJson()
        }
        setBaseUrl(baseUrl)
        objectChangedXP = true
        objectChangedJS = true
        objectChangedJP = true
        return this
    }

    fun setCoroutineContext(context: CoroutineContext): AnalyzeRule {
        coroutineContext = context.minusKey(ContinuationInterceptor)
        return this
    }

    fun setBaseUrl(baseUrl: String?): AnalyzeRule {
        baseUrl?.let { this.baseUrl = baseUrl }
        return this
    }

    fun setRedirectUrl(url: String): URL? {
        try { redirectUrl = URL(url) } catch (e: Exception) { log("URL($url) error\n${e.localizedMessage}") }
        return redirectUrl
    }

    private fun getAnalyzeByXPath(o: Any): AnalyzeByXPath {
        return if (o != content) AnalyzeByXPath(o)
        else {
            if (analyzeByXPath == null || objectChangedXP) {
                analyzeByXPath = AnalyzeByXPath(content!!)
                objectChangedXP = false
            }
            analyzeByXPath!!
        }
    }

    private fun getAnalyzeByJSoup(o: Any): AnalyzeByJSoup {
        return if (o != content) AnalyzeByJSoup(o)
        else {
            if (analyzeByJSoup == null || objectChangedJS) {
                analyzeByJSoup = AnalyzeByJSoup(content!!)
                objectChangedJS = false
            }
            analyzeByJSoup!!
        }
    }

    private fun getAnalyzeByJSonPath(o: Any): AnalyzeByJSonPath {
        return if (o != content) AnalyzeByJSonPath(o)
        else {
            if (analyzeByJSonPath == null || objectChangedJP) {
                analyzeByJSonPath = AnalyzeByJSonPath(content!!)
                objectChangedJP = false
            }
            analyzeByJSonPath!!
        }
    }

    @JvmOverloads
    fun getStringList(rule: String?, mContent: Any? = null, isUrl: Boolean = false): List<String>? {
        if (rule.isNullOrEmpty()) return null
        val ruleList = splitSourceRuleCacheString(rule)
        return getStringList(ruleList, mContent, isUrl)
    }

    @JvmOverloads
    fun getStringList(ruleList: List<SourceRule>, mContent: Any? = null, isUrl: Boolean = false): List<String>? {
        var result: Any? = null
        val content = mContent ?: this.content
        if (content != null && ruleList.isNotEmpty()) {
            result = content
            if (result is NativeObject) {
                val sourceRule = ruleList.first()
                putRule(sourceRule.putMap)
                sourceRule.makeUpRule(result)
                result = if (sourceRule.getParamSize() > 1) sourceRule.rule
                else result[sourceRule.rule]
                result?.let {
                    if (sourceRule.replaceRegex.isNotEmpty() && it is List<*>) {
                        result = it.map { o -> replaceRegex(o.toString(), sourceRule) }
                    } else if (sourceRule.replaceRegex.isNotEmpty()) {
                        result = replaceRegex(result.toString(), sourceRule)
                    }
                }
            } else {
                for (sourceRule in ruleList) {
                    putRule(sourceRule.putMap)
                    sourceRule.makeUpRule(result)
                    result?.let { currentContent ->
                        if (sourceRule.rule.isNotEmpty()) {
                            result = when (sourceRule.mode) {
                                Mode.Js -> evalJS(sourceRule.rule, result)
                                Mode.Json -> getAnalyzeByJSonPath(currentContent).getStringList(sourceRule.rule)
                                Mode.XPath -> getAnalyzeByXPath(currentContent).getStringList(sourceRule.rule)
                                Mode.Default -> getAnalyzeByJSoup(currentContent).getStringList(sourceRule.rule)
                                else -> sourceRule.rule
                            }
                        }
                        val curResult = result
                        if (sourceRule.replaceRegex.isNotEmpty() && curResult is List<*>) {
                            val newList = ArrayList<String>()
                            for (item in curResult) {
                                newList.add(replaceRegex(item.toString(), sourceRule))
                            }
                            result = newList
                        } else if (sourceRule.replaceRegex.isNotEmpty()) {
                            result = replaceRegex(curResult.toString(), sourceRule)
                        }
                    }
                }
            }
        }
        if (result == null) return null
        if (result is String) result = result.toString().split("\n")
        if (isUrl) {
            val urlList = ArrayList<String>()
            val curResult = result
            if (curResult is List<*>) {
                for (url in curResult) {
                    val absoluteURL = getAbsoluteURL(redirectUrl, url.toString())
                    if (absoluteURL.isNotEmpty() && !urlList.contains(absoluteURL)) {
                        urlList.add(absoluteURL)
                    }
                }
            }
            return urlList
        }
        @Suppress("UNCHECKED_CAST")
        return result as? List<String>
    }

    @JvmOverloads
    fun getString(ruleStr: String?, mContent: Any? = null, isUrl: Boolean = false): String {
        if (ruleStr.isNullOrEmpty()) return ""
        val ruleList = splitSourceRuleCacheString(ruleStr)
        return getString(ruleList, mContent, isUrl)
    }

    @JvmOverloads
    fun getString(ruleList: List<SourceRule>, mContent: Any? = null, isUrl: Boolean = false, unescape: Boolean = true): String {
        var result: Any? = null
        val content = mContent ?: this.content
        if (content != null && ruleList.isNotEmpty()) {
            result = content
            if (result is NativeObject) {
                val sourceRule = ruleList.first()
                putRule(sourceRule.putMap)
                sourceRule.makeUpRule(result)
                result = if (sourceRule.getParamSize() > 1) sourceRule.rule
                else (result as NativeObject)[sourceRule.rule]?.toString()
                    ?.let { replaceRegex(it, sourceRule) }
            } else {
                for (sourceRule in ruleList) {
                    putRule(sourceRule.putMap)
                    sourceRule.makeUpRule(result)
                    result?.let {
                        if (sourceRule.rule.isNotBlank() || sourceRule.replaceRegex.isEmpty()) {
                            result = when (sourceRule.mode) {
                                Mode.Js -> evalJS(sourceRule.rule, it)
                                Mode.Json -> getAnalyzeByJSonPath(it).getString(sourceRule.rule)
                                Mode.XPath -> getAnalyzeByXPath(it).getString(sourceRule.rule)
                                Mode.Default -> if (isUrl) getAnalyzeByJSoup(it).getString0(sourceRule.rule)
                                else getAnalyzeByJSoup(it).getString(sourceRule.rule)
                                else -> sourceRule.rule
                            }
                        }
                        if ((result != null) && sourceRule.replaceRegex.isNotEmpty()) {
                            result = replaceRegex(result.toString(), sourceRule)
                        }
                    }
                }
            }
        }
        if (result == null) result = ""
        val resultStr = result.toString()
        val str = if (unescape && resultStr.indexOf('&') > -1) {
            StringEscapeUtils.unescapeHtml4(resultStr)
        } else resultStr
        if (isUrl) {
            return if (str.isBlank()) baseUrl ?: ""
            else getAbsoluteURL(redirectUrl, str)
        }
        return str
    }

    fun getElement(ruleStr: String): Any? {
        if (ruleStr.isNullOrEmpty()) return null
        var result: Any? = null
        val content = this.content
        val ruleList = splitSourceRule(ruleStr, true)
        if (content != null && ruleList.isNotEmpty()) {
            result = content
            for (sourceRule in ruleList) {
                putRule(sourceRule.putMap)
                sourceRule.makeUpRule(result)
                result?.let {
                    result = when (sourceRule.mode) {
                        Mode.Regex -> AnalyzeByRegex.getElement(result.toString(), sourceRule.rule.splitNotBlank("&&"))
                        Mode.Js -> evalJS(sourceRule.rule, it)
                        Mode.Json -> getAnalyzeByJSonPath(it).getObject(sourceRule.rule)
                        Mode.XPath -> getAnalyzeByXPath(it).getElements(sourceRule.rule)
                        else -> getAnalyzeByJSoup(it).getElements(sourceRule.rule)
                    }
                    if (sourceRule.replaceRegex.isNotEmpty()) {
                        result = replaceRegex(result.toString(), sourceRule)
                    }
                }
            }
        }
        return result
    }

    @Suppress("UNCHECKED_CAST")
    fun getElements(ruleStr: String): List<Any> {
        var result: Any? = null
        val content = this.content
        val ruleList = splitSourceRule(ruleStr, true)
        if (content != null && ruleList.isNotEmpty()) {
            result = content
            for (sourceRule in ruleList) {
                putRule(sourceRule.putMap)
                result?.let {
                    result = when (sourceRule.mode) {
                        Mode.Regex -> AnalyzeByRegex.getElements(result.toString(), sourceRule.rule.splitNotBlank("&&"))
                        Mode.Js -> evalJS(sourceRule.rule, result)
                        Mode.Json -> getAnalyzeByJSonPath(it).getList(sourceRule.rule)
                        Mode.XPath -> getAnalyzeByXPath(it).getElements(sourceRule.rule)
                        else -> getAnalyzeByJSoup(it).getElements(sourceRule.rule)
                    }
                    if (sourceRule.replaceRegex.isNotEmpty()) {
                        result = replaceRegex(result.toString(), sourceRule)
                    }
                }
            }
        }
        result?.let { return it as List<Any> }
        return ArrayList()
    }

    private fun putRule(map: Map<String, String>) {
        for ((key, value) in map) put(key, getString(value))
    }

    private fun splitPutRule(ruleStr: String, putMap: HashMap<String, String>): String {
        var vRuleStr = ruleStr
        val putMatcher = putPattern.matcher(vRuleStr)
        while (putMatcher.find()) {
            vRuleStr = vRuleStr.replace(putMatcher.group(), "")
            try {
                val type = object : TypeToken<Map<String, String>>() {}.type
                val map: Map<String, String> = Gson().fromJson(putMatcher.group(1), type)
                putMap.putAll(map)
            } catch (_: Exception) {}
        }
        return vRuleStr
    }

    private fun replaceRegex(result: String, rule: SourceRule): String {
        if (rule.replaceRegex.isEmpty()) return result
        var vResult = result
        vResult = if (rule.replaceFirst) {
            kotlin.runCatching {
                val pattern = Pattern.compile(rule.replaceRegex)
                val matcher = pattern.matcher(vResult)
                if (matcher.find()) {
                    matcher.group(0)!!.replaceFirst(rule.replaceRegex.toRegex(), rule.replacement)
                } else ""
            }.getOrElse { rule.replacement }
        } else {
            kotlin.runCatching {
                vResult.replace(rule.replaceRegex.toRegex(), rule.replacement)
            }.getOrElse { vResult.replace(rule.replaceRegex, rule.replacement) }
        }
        return vResult
    }

    fun splitSourceRuleCacheString(ruleStr: String?): List<SourceRule> {
        if (ruleStr.isNullOrEmpty()) return emptyList()
        val cacheRule = stringRuleCache[ruleStr]
        return if (cacheRule != null) cacheRule
        else {
            val rules = splitSourceRule(ruleStr)
            stringRuleCache[ruleStr] = rules
            rules
        }
    }

    fun splitSourceRule(ruleStr: String?, allInOne: Boolean = false): List<SourceRule> {
        if (ruleStr.isNullOrEmpty()) return emptyList()
        val ruleList = ArrayList<SourceRule>()
        var mMode: Mode = Mode.Default
        var start = 0
        if (allInOne && ruleStr.startsWith(":")) {
            mMode = Mode.Regex
            isRegex = true
            start = 1
        } else if (isRegex) {
            mMode = Mode.Regex
        }
        var tmp: String
        val jsMatcher = JS_PATTERN.matcher(ruleStr)
        while (jsMatcher.find()) {
            if (jsMatcher.start() > start) {
                tmp = ruleStr.substring(start, jsMatcher.start()).trim { it <= ' ' }
                if (tmp.isNotEmpty()) ruleList.add(SourceRule(tmp, mMode))
            }
            ruleList.add(SourceRule(jsMatcher.group(2) ?: jsMatcher.group(1), Mode.Js))
            start = jsMatcher.end()
        }
        if (ruleStr.length > start) {
            tmp = ruleStr.substring(start).trim { it <= ' ' }
            if (tmp.isNotEmpty()) ruleList.add(SourceRule(tmp, mMode))
        }
        return ruleList
    }

    inner class SourceRule internal constructor(ruleStr: String, internal var mode: Mode = Mode.Default) {
        internal var rule: String
        internal var replaceRegex = ""
        internal var replacement = ""
        internal var replaceFirst = false
        internal val putMap = HashMap<String, String>()
        private val ruleParam = ArrayList<String>()
        private val ruleType = ArrayList<Int>()
        private val getRuleType = -2
        private val jsRuleType = -1
        private val defaultRuleType = 0

        init {
            rule = when {
                mode == Mode.Js || mode == Mode.Regex -> ruleStr
                ruleStr.startsWith("@CSS:", true) -> { mode = Mode.Default; ruleStr }
                ruleStr.startsWith("@@") -> { mode = Mode.Default; ruleStr.substring(2) }
                ruleStr.startsWith("@XPath:", true) -> { mode = Mode.XPath; ruleStr.substring(7) }
                ruleStr.startsWith("@Json:", true) -> { mode = Mode.Json; ruleStr.substring(6) }
                isJSON || ruleStr.startsWith("$.") || ruleStr.startsWith("$[") -> { mode = Mode.Json; ruleStr }
                ruleStr.startsWith("/") -> { mode = Mode.XPath; ruleStr }
                else -> ruleStr
            }
            rule = splitPutRule(rule, putMap)
            var start = 0
            var tmp: String
            val evalMatcher = evalPattern.matcher(rule)
            if (evalMatcher.find()) {
                tmp = rule.substring(start, evalMatcher.start())
                if (mode != Mode.Js && mode != Mode.Regex && (evalMatcher.start() == 0 || !tmp.contains("##"))) {
                    mode = Mode.Regex
                }
                do {
                    if (evalMatcher.start() > start) {
                        tmp = rule.substring(start, evalMatcher.start())
                        splitRegex(tmp)
                    }
                    tmp = evalMatcher.group()
                    when {
                        tmp.startsWith("@get:", true) -> {
                            ruleType.add(getRuleType)
                            ruleParam.add(tmp.substring(6, tmp.lastIndex))
                        }
                        tmp.startsWith("{{") -> {
                            ruleType.add(jsRuleType)
                            ruleParam.add(tmp.substring(2, tmp.length - 2))
                        }
                        else -> splitRegex(tmp)
                    }
                    start = evalMatcher.end()
                } while (evalMatcher.find())
            }
            if (rule.length > start) {
                tmp = rule.substring(start)
                splitRegex(tmp)
            }
        }

        private fun splitRegex(ruleStr: String) {
            var start = 0
            var tmp: String
            val ruleStrArray = ruleStr.split("##")
            val regexMatcher = regexPattern.matcher(ruleStrArray[0])
            if (regexMatcher.find()) {
                if (mode != Mode.Js && mode != Mode.Regex) mode = Mode.Regex
                do {
                    if (regexMatcher.start() > start) {
                        tmp = ruleStr.substring(start, regexMatcher.start())
                        ruleType.add(defaultRuleType)
                        ruleParam.add(tmp)
                    }
                    tmp = regexMatcher.group()
                    ruleType.add(tmp.substring(1).toInt())
                    ruleParam.add(tmp)
                    start = regexMatcher.end()
                } while (regexMatcher.find())
            }
            if (ruleStr.length > start) {
                tmp = ruleStr.substring(start)
                ruleType.add(defaultRuleType)
                ruleParam.add(tmp)
            }
        }

        fun makeUpRule(result: Any?) {
            val infoVal = StringBuilder()
            if (ruleParam.isNotEmpty()) {
                var index = ruleParam.size
                while (index-- > 0) {
                    val regType = ruleType[index]
                    when {
                        regType > defaultRuleType -> {
                            @Suppress("UNCHECKED_CAST")
                            (result as? List<String?>)?.run {
                                if (this.size > regType) this[regType]?.let { infoVal.insert(0, it) }
                            } ?: infoVal.insert(0, ruleParam[index])
                        }
                        regType == jsRuleType -> {
                            if (isRule(ruleParam[index])) {
                                getString(arrayListOf(SourceRule(ruleParam[index]))).let { infoVal.insert(0, it) }
                            } else {
                                val jsEval: Any? = evalJS(ruleParam[index], result)
                                when {
                                    jsEval == null -> Unit
                                    jsEval is String -> infoVal.insert(0, jsEval)
                                    jsEval is Double && jsEval % 1.0 == 0.0 -> infoVal.insert(0, String.format("%.0f", jsEval))
                                    else -> infoVal.insert(0, jsEval.toString())
                                }
                            }
                        }
                        regType == getRuleType -> infoVal.insert(0, get(ruleParam[index]))
                        else -> infoVal.insert(0, ruleParam[index])
                    }
                }
                rule = infoVal.toString()
            }
            val ruleStrS = rule.split("##")
            rule = ruleStrS[0].trim()
            if (ruleStrS.size > 1) replaceRegex = ruleStrS[1]
            if (ruleStrS.size > 2) replacement = ruleStrS[2]
            if (ruleStrS.size > 3) replaceFirst = true
        }

        private fun isRule(ruleStr: String): Boolean {
            return ruleStr.startsWith('@') || ruleStr.startsWith("$.") || ruleStr.startsWith("$[") || ruleStr.startsWith("//")
        }

        fun getParamSize(): Int = ruleParam.size
    }

    enum class Mode { XPath, Json, Default, Js, Regex }

    fun put(key: String, value: String): String {
        chapter?.putVariable(key, value)
            ?: book?.putVariable(key, value)
            ?: ruleData?.putVariable(key, value)
        return value
    }

    fun get(key: String): String {
        when (key) {
            "bookName" -> { val b = book; if (b != null) return b.name }
            "title" -> { val c = chapter; if (c != null) return c.title }
        }
        return chapter?.getVariable(key)?.takeIf { it.isNotEmpty() }
            ?: book?.getVariable(key)?.takeIf { it.isNotEmpty() }
            ?: ruleData?.getVariable(key)?.takeIf { it.isNotEmpty() }
            ?: ""
    }

    fun evalJS(jsStr: String, result: Any? = null): Any? {
        val bindings = mutableMapOf<String, Any?>()
        bindings["java"] = this
        bindings["source"] = source
        bindings["book"] = book
        bindings["result"] = result
        bindings["baseUrl"] = baseUrl
        bindings["chapter"] = chapter
        bindings["title"] = chapter?.title
        bindings["src"] = content
        bindings["nextChapterUrl"] = nextChapterUrl
        return try {
            RhinoAdapter.eval(jsStr, bindings)
        } catch (e: Exception) {
            log("evalJS error: ${e.message}")
            null
        }
    }

    override fun getSource(): Any? = source

    override fun ajax(urlStr: String): String? {
        return try {
            io.legado.validator.help.http.HttpHelper.get(urlStr).body
        } catch (e: Exception) {
            log("ajax($urlStr) error\n${e.message}")
            null
        }
    }

    companion object {
        private val putPattern = Pattern.compile("@put:(\\{[^}]+?\\})", Pattern.CASE_INSENSITIVE)
        private val evalPattern = Pattern.compile("@get:\\{[^}]+?\\}|\\{\\{[\\w\\W]*?\\}\\}", Pattern.CASE_INSENSITIVE)
        private val regexPattern = Pattern.compile("\\$\\d{1,2}")
    }
}

private fun String.splitNotBlank(delim: String): Array<String> =
    split(delim).filter { it.isNotBlank() }.toTypedArray()

private fun getAbsoluteURL(baseUrl: URL?, relativeUrl: String): String {
    if (relativeUrl.isBlank()) return ""
    if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) return relativeUrl
    if (baseUrl == null) return relativeUrl
    return try {
        URL(baseUrl, relativeUrl).toString()
    } catch (e: Exception) {
        relativeUrl
    }
}
