package io.legado.validator.help

import io.legado.validator.help.http.HttpHelper
import io.legado.validator.help.http.StrResponse
import java.net.URLEncoder
import java.nio.charset.Charset
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.*

interface JsExtensions {
    fun getSource(): Any?

    fun base64Decode(str: String): String = String(Base64.getDecoder().decode(str))
    fun base64DecodeToByteArray(str: String): ByteArray = Base64.getDecoder().decode(str)
    fun base64Encode(str: String): String = Base64.getEncoder().encodeToString(str.toByteArray())
    fun base64Encode(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
    fun strToBytes(str: String, charset: String = "UTF-8"): ByteArray = str.toByteArray(charset(charset))
    fun bytesToStr(bytes: ByteArray, charset: String = "UTF-8"): String = String(bytes, charset(charset))
    fun encodeURI(str: String): String = URLEncoder.encode(str, "UTF-8")
    fun encodeURI(str: String, enc: String): String = URLEncoder.encode(str, enc)
    fun utf8ToGbk(str: String): String = String(str.toByteArray(Charsets.UTF_8), Charset.forName("GBK"))
    fun randomUUID(): String = UUID.randomUUID().toString()

    fun md5Encode(str: String): String {
        val md = MessageDigest.getInstance("MD5")
        return md.digest(str.toByteArray()).joinToString("") { "%02x".format(it) }
    }
    fun md5Encode16(str: String): String = md5Encode(str).substring(8, 24)
    fun sha1Encode(str: String): String {
        val md = MessageDigest.getInstance("SHA-1")
        return md.digest(str.toByteArray()).joinToString("") { "%02x".format(it) }
    }
    fun sha256Encode(str: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(str.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    fun ajax(urlStr: String): String? {
        return try { HttpHelper.get(urlStr).body } catch (e: Exception) { null }
    }
    fun ajax(urlStr: String, headers: Map<String, String>): String? {
        return try { HttpHelper.get(urlStr, headers).body } catch (e: Exception) { null }
    }
    fun get(urlStr: String, headers: Map<String, String>): StrResponse = HttpHelper.get(urlStr, headers)
    fun head(urlStr: String, headers: Map<String, String>): String = urlStr
    fun post(urlStr: String, body: String, headers: Map<String, String>): StrResponse =
        HttpHelper.post(urlStr, body, headers = headers)
    fun connect(urlStr: String): String? = ajax(urlStr)
    fun connect(urlStr: String, headers: Map<String, String>): String? = ajax(urlStr, headers)

    fun timeFormat(time: Long): String = SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(Date(time))
    fun timeFormat(time: Long, format: String): String = SimpleDateFormat(format).format(Date(time))
    fun timeFormatUTC(time: Long, format: String, sh: Int = 8): String {
        val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        cal.timeInMillis = time
        cal.add(Calendar.HOUR, sh)
        return SimpleDateFormat(format).format(cal.time)
    }

    fun log(msg: String) { println("[JS] $msg") }
    fun logType(any: Any?) { println("[JS-Type] ${any?.let { it::class.simpleName } ?: "null"}") }

    fun webView(html: String, url: String, js: String): String =
        throw UnsupportedOperationException("WebView 需 App 复核")
    fun webViewGetSource(html: String, url: String, js: String, sourceRegex: String): String =
        throw UnsupportedOperationException("WebView 需 App 复核")
    fun getWebViewUA(): String =
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"
    fun androidId(): String = "validator-pc"
    fun toast(msg: String) { println("[Toast] $msg") }

    fun cacheFile(urlStr: String): String? = null
    fun readFile(path: String): String? = null
    fun downloadFile(url: String): String? = null
}
