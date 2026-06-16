package io.legado.validator.help

import io.legado.validator.help.crypto.SymmetricCrypto
import io.legado.validator.help.http.HttpHelper
import io.legado.validator.help.http.StrResponse
import java.net.URLEncoder
import java.nio.charset.Charset
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.*
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private val cacheDir = java.io.File(System.getProperty("java.io.tmpdir"), "legado_validator_cache").apply { mkdirs() }

interface JsExtensions {
    fun getSource(): Any?

    // ── Encoding ──

    fun base64Decode(str: String): String = String(Base64.getDecoder().decode(str))
    fun base64Decode(str: String, charset: String): String = String(Base64.getDecoder().decode(str), charset(charset))
    fun base64Decode(str: String, flags: Int): String = String(Base64.getDecoder().decode(str))
    fun base64DecodeToByteArray(str: String): ByteArray = Base64.getDecoder().decode(str)
    fun base64DecodeToByteArray(str: String, flags: Int): ByteArray = Base64.getDecoder().decode(str)
    fun base64Encode(str: String): String = Base64.getEncoder().encodeToString(str.toByteArray())
    fun base64Encode(str: String, flags: Int): String = Base64.getEncoder().encodeToString(str.toByteArray())
    fun base64Encode(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
    fun hexDecodeToByteArray(hex: String): ByteArray {
        val h = hex.removePrefix("0x")
        return ByteArray(h.length / 2) { i -> h.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }
    fun hexDecodeToString(hex: String): String = String(hexDecodeToByteArray(hex), Charsets.UTF_8)
    fun hexEncodeToString(utf8: String): String = utf8.toByteArray(Charsets.UTF_8).joinToString("") { "%02x".format(it) }
    fun strToBytes(str: String): ByteArray = str.toByteArray()
    fun strToBytes(str: String, charset: String): ByteArray = str.toByteArray(charset(charset))
    fun bytesToStr(bytes: ByteArray): String = String(bytes)
    fun bytesToStr(bytes: ByteArray, charset: String): String = String(bytes, charset(charset))
    fun encodeURI(str: String): String = URLEncoder.encode(str, "UTF-8")
    fun encodeURI(str: String, enc: String): String = URLEncoder.encode(str, enc)
    fun utf8ToGbk(str: String): String = String(str.toByteArray(Charsets.UTF_8), Charset.forName("GBK"))
    fun randomUUID(): String = UUID.randomUUID().toString()

    // ── Hash ──

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

    fun digestHex(data: String, algorithm: String): String =
        MessageDigest.getInstance(algorithm).digest(data.toByteArray())
            .joinToString("") { "%02x".format(it) }

    fun digestBase64Str(data: String, algorithm: String): String =
        Base64.getEncoder().encodeToString(MessageDigest.getInstance(algorithm).digest(data.toByteArray()))

    @Suppress("FunctionName")
    fun HMacHex(data: String, algorithm: String, key: String): String {
        val mac = Mac.getInstance(algorithm)
        mac.init(SecretKeySpec(key.toByteArray(), algorithm))
        return mac.doFinal(data.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    @Suppress("FunctionName")
    fun HMacBase64(data: String, algorithm: String, key: String): String {
        val mac = Mac.getInstance(algorithm)
        mac.init(SecretKeySpec(key.toByteArray(), algorithm))
        return Base64.getEncoder().encodeToString(mac.doFinal(data.toByteArray()))
    }

    // ── Symmetric Crypto ──

    fun createSymmetricCrypto(transformation: String, key: ByteArray?, iv: ByteArray?): SymmetricCrypto {
        val sc = SymmetricCrypto(transformation, key ?: ByteArray(0))
        if (iv != null && iv.isNotEmpty()) sc.setIv(iv)
        return sc
    }

    fun createSymmetricCrypto(transformation: String, key: ByteArray): SymmetricCrypto =
        createSymmetricCrypto(transformation, key, null)

    fun createSymmetricCrypto(transformation: String, key: String): SymmetricCrypto =
        createSymmetricCrypto(transformation, key, null)

    fun createSymmetricCrypto(transformation: String, key: String, iv: String?): SymmetricCrypto =
        createSymmetricCrypto(transformation, key.encodeToByteArray(), iv?.encodeToByteArray())

    // ── DOM / Text ──

    fun htmlFormat(str: String): String {
        return str.replace(Regex("(&nbsp;)+"), " ")
            .replace(Regex("(&ensp;|&emsp;)"), " ")
            .replace(Regex("(&thinsp;|&zwnj;|&zwj;|\u2009|\u200C|\u200D)"), "")
            .replace(Regex("</?(?:div|p|br|hr|h\\d|article|dd|dl)[^>]*>"), "\n")
            .replace(Regex("<!--[^>]*-->"), "")
            .replace(Regex("</?(?!img)[a-zA-Z]+(?=[ >])[^<>]*>"), "")
            .replace(Regex("\\s*\\n+\\s*"), "\n　　")
            .replace(Regex("^[\\n\\s]+"), "　　")
            .replace(Regex("[\\n\\s]+$"), "")
    }

    fun toNumChapter(s: String?): String? {
        s ?: return null
        val matcher = Regex("(第?)(\\d+)(章?)").find(s)
        if (matcher != null) {
            val (prefix, num, suffix) = matcher.destructured
            return "$prefix${num.toInt()}$suffix"
        }
        return s
    }

    fun toURL(urlStr: String): Map<String, Any?> {
        val url = java.net.URL(urlStr)
        return mapOf(
            "host" to url.host,
            "origin" to "${url.protocol}://${url.host}${if (url.port > 0) ":${url.port}" else ""}",
            "pathname" to url.path,
            "searchParams" to url.query?.split("&")?.associate {
                val parts = it.split("=", limit = 2)
                parts[0] to if (parts.size > 1) java.net.URLDecoder.decode(parts[1], "UTF-8") else ""
            }
        )
    }

    fun toURL(url: String, baseUrl: String?): Map<String, Any?> {
        val resolved = if (!baseUrl.isNullOrEmpty()) {
            java.net.URL(java.net.URL(baseUrl), url).toString()
        } else {
            url
        }
        return toURL(resolved)
    }

    // ── HTTP ──

    fun ajax(urlStr: String): String? {
        return try { HttpHelper.get(urlStr).body } catch (e: Exception) { null }
    }
    fun ajax(urlStr: String, headers: Map<String, String>): String? {
        return try { HttpHelper.get(urlStr, headers).body } catch (e: Exception) { null }
    }
    fun ajaxAll(urls: Array<String>): Array<String?> {
        return urls.map { ajax(it) }.toTypedArray()
    }
    fun get(urlStr: String, headers: Map<String, String>): StrResponse = HttpHelper.get(urlStr, headers)
    fun head(urlStr: String, headers: Map<String, String>): String {
        return try {
            val request = okhttp3.Request.Builder().url(urlStr).head().apply {
                headers.forEach { (k, v) -> addHeader(k, v) }
            }.build()
            HttpHelper.client.newCall(request).execute().use { it.code.toString() }
        } catch (e: Exception) { "0" }
    }
    fun post(urlStr: String, body: String, headers: Map<String, String>): StrResponse =
        HttpHelper.post(urlStr, body, headers = headers)
    fun connect(urlStr: String): String? = ajax(urlStr)
    fun connect(urlStr: String, headers: Map<String, String>): String? = ajax(urlStr, headers)

    // ── Cache (PC temp dir) ──

    fun cacheFile(urlStr: String, saveTime: Long = 0): String? {
        return try {
            val cached = java.io.File(cacheDir, md5Encode(urlStr))
            if (cached.exists()) {
                val age = (System.currentTimeMillis() - cached.lastModified()) / 1000
                if (saveTime <= 0 || age < saveTime) {
                    return cached.absolutePath
                }
            }
            cached.writeBytes(HttpHelper.get(urlStr).body.toByteArray())
            cached.absolutePath
        } catch (_: Exception) { null }
    }

    fun readFile(path: String): String? {
        return try { java.io.File(path).readText() } catch (_: Exception) { null }
    }

    fun readTxtFile(path: String): String? {
        return try { java.io.File(path).readText() } catch (_: Exception) { null }
    }

    fun downloadFile(url: String): String? = downloadFile(url, null)

    fun downloadFile(url: String, path: String?): String? {
        return try {
            val fileName = url.substringAfterLast("/").substringBefore("?").ifEmpty { "download.tmp" }
            val file = if (path != null) {
                java.io.File(path).apply { parentFile?.mkdirs() }
            } else {
                java.io.File.createTempFile("legado_dl_", "_$fileName")
            }
            file.writeBytes(HttpHelper.get(url).body.toByteArray())
            file.absolutePath
        } catch (_: Exception) { null }
    }

    fun importScript(path: String): Any? {
        return try {
            val jsCode = java.io.File(path).readText()
            val bindings = mapOf("java" to this)
            io.legado.validator.analyzeRule.RhinoAdapter.eval(jsCode, bindings)
        } catch (_: Exception) { null }
    }

    // ── Font / QueryTTF ──

    fun queryTTF(data: Any?, useCache: Boolean = true): io.legado.validator.analyzeRule.QueryTTF? {
        return try {
            val bytes: ByteArray? = when (data) {
                is ByteArray -> data
                is String -> when {
                    data.startsWith("http") -> HttpHelper.get(data).body.toByteArray()
                    data.startsWith("/") || data.startsWith("\\") -> java.io.File(data).readBytes()
                    else -> base64DecodeToByteArray(data)
                }
                else -> null
            }
            bytes?.let { io.legado.validator.analyzeRule.QueryTTF(it) }
        } catch (_: Exception) { null }
    }

    fun replaceFont(
        text: String,
        errorQueryTTF: io.legado.validator.analyzeRule.QueryTTF?,
        correctQueryTTF: io.legado.validator.analyzeRule.QueryTTF?,
        filter: Boolean = false
    ): String {
        if (errorQueryTTF == null || correctQueryTTF == null) return text
        val sb = StringBuilder()
        var i = 0
        while (i < text.length) {
            val codePoint = text.codePointAt(i)
            val charCount = Character.charCount(codePoint)
            if (errorQueryTTF.isBlankUnicode(codePoint)) {
                sb.append(text, i, i + charCount)
            } else {
                val glyf = errorQueryTTF.getGlyfByUnicode(codePoint)
                val glyfId = errorQueryTTF.getGlyfIdByUnicode(codePoint)
                if (filter && (glyf == null || glyfId == 0)) {
                    // skip
                } else {
                    val correctCode = correctQueryTTF.getUnicodeByGlyf(glyf)
                    if (correctCode != 0) {
                        sb.appendCodePoint(correctCode)
                    } else {
                        sb.append(text, i, i + charCount)
                    }
                }
            }
            i += charCount
        }
        return sb.toString()
    }

    // ── Cookie ──

    fun getCookie(tag: String): String {
        log("getCookie($tag): validator 无 CookieJar，返回空串")
        return ""
    }
    fun getCookie(tag: String, key: String?): String {
        log("getCookie($tag, $key): validator 无 CookieJar，返回空串")
        return ""
    }

    // ── Time ──

    fun timeFormat(time: Long): String = SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(Date(time))
    fun timeFormat(time: Long, format: String): String = SimpleDateFormat(format).format(Date(time))
    fun timeFormatUTC(time: Long, format: String, sh: Int = 8): String {
        val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        cal.timeInMillis = time
        cal.add(Calendar.HOUR, sh)
        return SimpleDateFormat(format).format(cal.time)
    }

    // ── Log ──

    fun log(msg: String) { println("[JS] $msg") }
    fun logType(any: Any?) { println("[JS-Type] ${any?.let { it::class.simpleName } ?: "null"}") }

    // ── Stubs ──

    fun webView(html: String, url: String, js: String): String {
        throw WebViewNotSupportedException("webView($url): 需 App 复核，validator 不支持 WebView 执行")
    }
    fun webViewGetSource(html: String, url: String, js: String, sourceRegex: String): String {
        throw WebViewNotSupportedException("webViewGetSource($url): 需 App 复核，validator 不支持 WebView 执行")
    }
    fun getWebViewUA(): String =
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"
    fun androidId(): String = "validator-pc"
    fun toast(msg: String) { println("[Toast] $msg") }
}
