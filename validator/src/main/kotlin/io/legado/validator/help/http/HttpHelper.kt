package io.legado.validator.help.http

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.nio.charset.Charset
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

data class StrResponse(
    val url: String,
    val body: String,
    val headers: Headers,
    val code: Int
)

object HttpHelper {
    val client: OkHttpClient by lazy {
        val trustAllCerts = arrayOf<X509TrustManager>(object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        })
        val sslContext = SSLContext.getInstance("SSL").apply {
            init(null, trustAllCerts, SecureRandom())
        }
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .sslSocketFactory(sslContext.socketFactory, trustAllCerts[0])
            .hostnameVerifier { _, _ -> true }
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    fun get(url: String, headers: Map<String, String> = emptyMap(), charset: String? = null): StrResponse {
        val builder = Request.Builder().url(url).get()
        headers.forEach { (k, v) -> builder.addHeader(k, v) }
        builder.addHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        val response = client.newCall(builder.build()).execute()
        val body = response.body?.let {
            val bytes = it.bytes()
            val cs = charset ?: detectCharset(bytes, it.contentType()?.charset()?.name())
            String(bytes, Charset.forName(cs))
        } ?: ""
        return StrResponse(response.request.url.toString(), body, response.headers, response.code)
    }

    fun post(url: String, body: String, contentType: String = "application/x-www-form-urlencoded",
             headers: Map<String, String> = emptyMap(), charset: String? = null): StrResponse {
        val builder = Request.Builder().url(url)
            .post(body.toByteArray().toRequestBody(contentType.toMediaType()))
        headers.forEach { (k, v) -> builder.addHeader(k, v) }
        builder.addHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        val response = client.newCall(builder.build()).execute()
        val respBody = response.body?.let {
            val bytes = it.bytes()
            val cs = charset ?: detectCharset(bytes, it.contentType()?.charset()?.name())
            String(bytes, Charset.forName(cs))
        } ?: ""
        return StrResponse(response.request.url.toString(), respBody, response.headers, response.code)
    }

    fun getBytes(url: String, headers: Map<String, String> = emptyMap()): ByteArray {
        val builder = Request.Builder().url(url).get()
        headers.forEach { (k, v) -> builder.addHeader(k, v) }
        val response = client.newCall(builder.build()).execute()
        return response.body?.bytes() ?: ByteArray(0)
    }

    fun getStream(url: String, headers: Map<String, String> = emptyMap()): InputStream {
        val builder = Request.Builder().url(url).get()
        headers.forEach { (k, v) -> builder.addHeader(k, v) }
        val response = client.newCall(builder.build()).execute()
        return response.body?.byteStream() ?: ByteArrayInputStream(ByteArray(0))
    }

    private fun detectCharset(bytes: ByteArray, hint: String?): String {
        if (hint != null) return hint
        val sample = String(bytes, Charsets.ISO_8859_1)
        val metaMatch = Regex("""charset[=\s]*["']?([a-zA-Z0-9_-]+)""", RegexOption.IGNORE_CASE)
            .find(sample.substring(0, minOf(4096, sample.length)))
        return metaMatch?.groupValues?.get(1) ?: "UTF-8"
    }
}
