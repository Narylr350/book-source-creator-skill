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
    private var charset: String? = null

    init {
        headerMap.putAll(source?.getHeaderMap() ?: emptyMap())
        initUrl()
    }

    private fun initUrl() {
        var mUrl = mUrl
        // 替换 key
        key?.let { mUrl = mUrl.replace("{{key}}", it) }
        // 替换 page
        page?.let { mUrl = mUrl.replace("{{page}}", it.toString()) }
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

        // 解析 URL, method, body
        if (mUrl.contains(";post")) {
            method = "POST"
            val parts = mUrl.split(";post", limit = 2)
            url = parts[0].trim()
            body = parts.getOrNull(1)?.trim()?.trimStart('=')
            // 替换 body 中的变量
            key?.let { body = body?.replace("{{key}}", it) }
            page?.let { body = body?.replace("{{page}}", it.toString()) }
        } else {
            method = "GET"
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
}
