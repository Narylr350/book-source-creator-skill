package io.legado.validator.analyzeRule

import io.legado.validator.help.JsExtensions
import io.legado.validator.help.http.HttpHelper
import io.legado.validator.help.http.StrResponse
import io.legado.validator.model.BookChapter
import io.legado.validator.model.BookSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.util.regex.Pattern

class AnalyzeUrl(
    val mUrl: String,
    val key: String? = null,
    val page: Int? = null,
    var baseUrl: String = "",
    private val source: BookSource? = null,
    private val ruleData: RuleDataInterface? = null,
    private val chapter: BookChapter? = null
) : JsExtensions {

    var ruleUrl = ""
        private set
    var url: String = ""
        private set
    var body: String? = null
        private set
    val headerMap = HashMap<String, String>()
    private var method = "GET"
    var charset: String? = null
        private set
    var hasWebView: Boolean = false
        private set

    init {
        if (baseUrl.isEmpty()) {
            baseUrl = source?.bookSourceUrl ?: ""
        }
        headerMap.putAll(source?.getHeaderMap() ?: emptyMap())
        initUrl()
    }

    private fun initUrl() {
        var mUrl = mUrl
        var jsUrlExecuted = false

        // 执行 @js: 或 <js> URL 规则（必须在变量替换和相对 URL 拼接之前）
        if (mUrl.startsWith("@js:")) {
            evalJsUrl(mUrl.substring(4))?.let { mUrl = it; jsUrlExecuted = true }
        } else if (mUrl.startsWith("<js>") && mUrl.endsWith("</js>")) {
            evalJsUrl(mUrl.substring(4, mUrl.length - 5))?.let { mUrl = it; jsUrlExecuted = true }
        }

        // 处理内联 <js>...</js>（如 bilinovel searchUrl）
        val jsTagPattern = Regex("<js>([\\w\\W]*?)</js>")
        mUrl = jsTagPattern.replace(mUrl) { match ->
            val result = evalJsUrl(match.groupValues[1])
            if (result != null) { jsUrlExecuted = true; result } else { match.value }
        }

        // Expand page rule <1,2,3> → use first value (WebBook handles multi-page)
        val pageRulePattern = Regex("<([^>]+)>")
        mUrl = pageRulePattern.replace(mUrl) { match ->
            val values = match.groupValues[1].split(",")
            values.firstOrNull()?.trim() ?: match.value
        }

        // 解析 URL JSON 选项: url,{"method":"POST","body":"...","headers":{...},"charset":"..."}
        val commaIdx = findJsonOptionStart(mUrl)
        if (commaIdx > 0) {
            val urlPart = mUrl.substring(0, commaIdx).trim()
            val jsonPart = mUrl.substring(commaIdx + 1).trim()
            if (jsonPart.startsWith("{")) {
                try {
                    val opts = com.google.gson.Gson().fromJson(jsonPart, com.google.gson.JsonObject::class.java)
                    opts.get("method")?.asString?.let { method = it.uppercase() }
                    opts.get("body")?.asString?.let { body = it }
                    opts.get("charset")?.asString?.let { charset = it }
                    opts.get("headers")?.asJsonObject?.let { h ->
                        h.entrySet().forEach { headerMap[it.key] = it.value.asString }
                    }
                    if (opts.has("webView") && opts.get("webView").asBoolean) {
                        hasWebView = true
                    }
                    mUrl = urlPart
                } catch (_: Exception) { /* not valid JSON, treat as part of URL */ }
            }
        }

        // 替换 key（URL 中编码，POST body 保持原始值）
        key?.let {
            mUrl = mUrl.replace("{{key}}", URLEncoder.encode(it, "UTF-8"))
            body = body?.replace("{{key}}", it)
        }
        // 替换 page
        page?.let {
            mUrl = mUrl.replace("{{page}}", it.toString())
            body = body?.replace("{{page}}", it.toString())
        }
        // 替换规则变量
        val ruleData = ruleData
        if (ruleData != null) {
            val varPattern = Pattern.compile("\\{\\{(.*?)\\}\\}")
            val matcher = varPattern.matcher(mUrl)
            val sb = StringBuffer()
            while (matcher.find()) {
                val varName = matcher.group(1) ?: continue
                val value = ruleData.getVariable(varName)
                matcher.appendReplacement(sb, URLEncoder.encode(value, "UTF-8"))
            }
            matcher.appendTail(sb)
            mUrl = sb.toString()
        }

        // 相对 URL 拼接（JS 执行结果不拼接）
        if (!jsUrlExecuted && !mUrl.startsWith("http://") && !mUrl.startsWith("https://") && baseUrl.isNotEmpty()) {
            mUrl = try {
                java.net.URL(java.net.URL(baseUrl), mUrl).toString()
            } catch (e: Exception) { mUrl }
        }

        // 解析 ;post 语法
        if (mUrl.contains(";post")) {
            method = "POST"
            val parts = mUrl.split(";post", limit = 2)
            url = parts[0].trim()
            body = parts.getOrNull(1)?.trim()?.trimStart('=')
        } else {
            url = mUrl
        }

        ruleUrl = url
        // 处理 header JSON
        source?.header?.let { headerJson ->
            if (headerJson.isNotBlank()) {
                try {
                    val type = object : com.google.gson.reflect.TypeToken<Map<String, String>>() {}.type
                    val map: Map<String, String> = com.google.gson.Gson().fromJson(headerJson, type)
                    headerMap.putAll(map)
                } catch (_: Exception) {}
            }
        }
    }

    suspend fun getStrResponseAwait(): StrResponse = withContext(Dispatchers.IO) {
        val headers = headerMap.toMutableMap()
        if (!headers.containsKey("User-Agent")) {
            headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        if (method == "POST" && body != null) {
            HttpHelper.post(url, body!!, headers = headers, charset = charset)
        } else {
            HttpHelper.get(url, headers, charset)
        }
    }

    fun getStrResponse(): StrResponse {
        val headers = headerMap.toMutableMap()
        if (!headers.containsKey("User-Agent")) {
            headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        return if (method == "POST" && body != null) {
            HttpHelper.post(url, body!!, headers = headers, charset = charset)
        } else {
            HttpHelper.get(url, headers, charset)
        }
    }

    fun isPost(): Boolean = method == "POST"

    override fun getSource(): Any? = source

    private fun evalJsUrl(jsCode: String): String? {
        return try {
            val bindings = mutableMapOf<String, Any?>()
            bindings["key"] = key ?: ""
            bindings["page"] = page ?: 1
            bindings["book"] = ruleData
            bindings["source"] = source
            bindings["java"] = this
            val result = RhinoAdapter.eval(jsCode, bindings)
            result?.toString()
        } catch (_: Exception) {
            null
        }
    }

    private fun findJsonOptionStart(url: String): Int {
        var depth = 0
        for (i in url.indices) {
            when (url[i]) {
                '{' -> depth++
                '}' -> depth--
                ',' -> if (depth == 0) return i
            }
        }
        return -1
    }
}
