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
            // Match Legado HttpHelper default headers interceptor
            .addInterceptor { chain ->
                val request = chain.request()
                val builder = request.newBuilder()
                if (request.header("User-Agent") == null) {
                    builder.addHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                }
                builder.addHeader("Keep-Alive", "300")
                builder.addHeader("Connection", "Keep-Alive")
                builder.addHeader("Cache-Control", "no-cache")
                chain.proceed(builder.build())
            }
            // Match Legado CookieJar network interceptor (Gap #1)
            .addNetworkInterceptor { chain ->
                var request = chain.request()
                val enableCookieJar = request.header("CookieJar") != null

                if (enableCookieJar) {
                    val requestBuilder = request.newBuilder()
                    requestBuilder.removeHeader("CookieJar")
                    val domain = try { java.net.URI.create(request.url.toString()).toURL().host.lowercase() } catch (_: Exception) { "" }
                    val storedCookie = io.legado.validator.web.CookieStore.getCookie(domain)
                    if (!storedCookie.isNullOrEmpty()) {
                        val existingCookie = request.header("Cookie")
                        val merged = if (!existingCookie.isNullOrEmpty()) {
                            "$existingCookie; $storedCookie"
                        } else {
                            storedCookie
                        }
                        requestBuilder.header("Cookie", merged)
                    }
                    request = requestBuilder.build()
                }

                val response = chain.proceed(request)

                if (enableCookieJar) {
                    val setCookies = response.headers("Set-Cookie")
                    if (setCookies.isNotEmpty()) {
                        val domain = try { java.net.URI.create(request.url.toString()).toURL().host.lowercase() } catch (_: Exception) { "" }
                        if (domain.isNotEmpty()) {
                            val cookieValues = setCookies.map { it.split(";").first().trim() }
                            val newCookie = cookieValues.joinToString("; ")
                            val existing = io.legado.validator.web.CookieStore.getCookie(domain)
                            val merged = if (!existing.isNullOrEmpty()) "$existing; $newCookie" else newCookie
                            io.legado.validator.web.CookieStore.setCookie(domain, merged)
                        }
                    }
                }
                response
            }
            .build()
    }

    fun get(url: String, headers: Map<String, String> = emptyMap(), charset: String? = null): StrResponse {
        return curlRequest(url, "GET", null, null, headers, charset)
    }

    fun post(url: String, body: String, contentType: String = "application/x-www-form-urlencoded",
             headers: Map<String, String> = emptyMap(), charset: String? = null): StrResponse {
        return curlRequest(url, "POST", body, contentType, headers, charset)
    }

    private fun curlRequest(
        url: String,
        method: String,
        body: String?,
        contentType: String?,
        headers: Map<String, String>,
        charset: String?
    ): StrResponse {
        val cmd = mutableListOf("curl", "-s", "-L", "--max-time", "30", "-X", method)
        for ((k, v) in headers) {
            cmd.add("-H"); cmd.add("$k: $v")
        }
        if (body != null) {
            cmd.add("-d"); cmd.add(body)
            if (contentType != null) {
                cmd.add("-H"); cmd.add("Content-Type: $contentType")
            }
        }
        cmd.add("-w")
        cmd.add("\n---CURL_META---\n%{http_code}\n%{url_effective}")
        cmd.add(url)
        val pb = ProcessBuilder(cmd)
        pb.redirectErrorStream(true)
        val proc = pb.start()
        val out = proc.inputStream.readBytes()
        proc.waitFor(30, java.util.concurrent.TimeUnit.SECONDS)
        val raw = String(out, Charsets.UTF_8)
        val metaMarker = "\n---CURL_META---\n"
        val metaIdx = raw.lastIndexOf(metaMarker)
        if (metaIdx < 0) {
            return StrResponse(url, raw, okhttp3.Headers.headersOf(), 200)
        }
        val bodyStr = raw.substring(0, metaIdx)
        val meta = raw.substring(metaIdx + metaMarker.length).trim().split("\n")
        val code = meta.getOrNull(0)?.toIntOrNull() ?: 200
        val effectiveUrl = meta.getOrNull(1) ?: url
        val cs = charset ?: detectCharset(bodyStr.toByteArray(), null)
        val finalBody = if (cs != "UTF-8") String(bodyStr.toByteArray(Charsets.ISO_8859_1), Charset.forName(cs)) else bodyStr
        return StrResponse(effectiveUrl, finalBody, okhttp3.Headers.headersOf(), code)
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
