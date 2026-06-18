package io.legado.probe

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.*
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume

class WebViewRunner(private val context: Context) {

    private val handler = Handler(Looper.getMainLooper())

    private fun status(msg: String) {
        WebViewProbeActivity.instance?.updateStatus(msg)
    }

    @SuppressLint("SetJavaScriptEnabled")
    suspend fun render(request: RenderRequest): RenderResponse = withContext(Dispatchers.Main) {
        val startTime = System.currentTimeMillis()
        val shortUrl = request.url.take(80)
        status("加载: $shortUrl")
        try {
            withTimeout(request.timeout) {
                suspendCancellableCoroutine { cont ->
                    val webView = WebView(context).apply {
                        settings.apply {
                            javaScriptEnabled = true
                            domStorageEnabled = true
                            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                            blockNetworkImage = false
                            // Default mobile Chrome UA to avoid WebView detection
                            if (request.headers?.get("User-Agent") == null) {
                                userAgentString = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
                            }
                            request.headers?.get("User-Agent")?.let { userAgentString = it }
                            // Anti-bot: disable webdriver detection
                            setGeolocationEnabled(false)
                            databaseEnabled = true
                        }
                    }

                    webView.webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView, url: String?) {
                            status("页面加载完成，执行 JS...")
                            val cookies = CookieManager.getInstance().getCookie(url)
                            handler.postDelayed({
                                executeJsAndFinish(
                                    view, url, cookies, request, cont,
                                    System.currentTimeMillis() - startTime
                                )
                            }, request.jsDelay)
                        }

                        override fun onReceivedSslError(
                            view: WebView, sslHandler: SslErrorHandler, error: SslError
                        ) {
                            // Match legado behavior: ALL WebViewClients call handler.proceed()
                            // See BackstageWebView.HtmlWebViewClient, WebViewActivity, etc.
                            sslHandler.proceed()
                        }

                        override fun onReceivedError(
                            view: WebView, req: WebResourceRequest, error: WebResourceError
                        ) {
                            if (req.isForMainFrame && !cont.isCompleted) {
                                cont.resume(
                                    RenderResponse(
                                        ok = false,
                                        error = "Page load error: ${error.description}",
                                        loadTimeMs = System.currentTimeMillis() - startTime
                                    )
                                )
                            }
                        }
                    }

                    cont.invokeOnCancellation { webView.destroy() }
                    // Inject cookies if provided
                    if (request.cookies != null) {
                        val cookieManager = CookieManager.getInstance()
                        cookieManager.setCookie(request.url, request.cookies)
                        cookieManager.flush()
                    }
                    // Gap #8: match Legado BackstageWebView.load() — loadDataWithBaseURL when html provided
                    if (!request.html.isNullOrEmpty()) {
                        val encoding = request.encoding ?: "utf-8"
                        webView.loadDataWithBaseURL(request.url, request.html, "text/html", encoding, request.url)
                    } else {
                        webView.loadUrl(request.url, request.headers ?: emptyMap())
                    }
                }
            }
        } catch (e: TimeoutCancellationException) {
            status("超时: ${request.timeout}ms")
            RenderResponse(ok = false, error = "Timeout after ${request.timeout}ms", loadTimeMs = request.timeout)
        } catch (e: Exception) {
            status("错误: ${e.message}")
            RenderResponse(ok = false, error = "${e::class.simpleName}: ${e.message}")
        }
    }

    private fun executeJsAndFinish(
        webView: WebView, url: String?, cookies: String?,
        request: RenderRequest, cont: CancellableContinuation<RenderResponse>,
        elapsed: Long
    ) {
        val js = request.javaScript ?: "document.documentElement.outerHTML"
        var retryCount = 0

        fun tryExecute() {
            webView.evaluateJavascript(js) { result ->
                val html = result?.removeSurrounding("\"")?.unescapeJson()
                if (!html.isNullOrEmpty() && html != "null") {
                    status("提取完成: ${html.length} 字符")
                    val screenshot = if (request.screenshot) captureScreenshot(webView) else null
                    if (!cont.isCompleted) {
                        cont.resume(
                            RenderResponse(
                                ok = true,
                                html = html,
                                finalUrl = webView.url,
                                title = webView.title,
                                cookies = cookies,
                                screenshotBase64 = screenshot,
                                loadTimeMs = elapsed
                            )
                        )
                    }
                    webView.destroy()
                } else if (retryCount < request.jsRetries) {
                    retryCount++
                    handler.postDelayed({ tryExecute() }, request.jsDelay)
                } else {
                    if (!cont.isCompleted) {
                        cont.resume(
                            RenderResponse(
                                ok = false,
                                error = "JS execution timeout after ${request.jsRetries} retries",
                                html = html,
                                finalUrl = webView.url,
                                cookies = cookies,
                                loadTimeMs = elapsed
                            )
                        )
                    }
                    webView.destroy()
                }
            }
        }
        tryExecute()
    }

    private fun captureScreenshot(webView: WebView): String? {
        return try {
            val bitmap = Bitmap.createBitmap(webView.width, webView.height, Bitmap.Config.ARGB_8888)
            val canvas = android.graphics.Canvas(bitmap)
            webView.draw(canvas)
            val stream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 80, stream)
            Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
        } catch (_: Exception) { null }
    }

    private fun String.unescapeJson(): String {
        return replace("\\n", "\n").replace("\\t", "\t")
            .replace("\\\"", "\"").replace("\\\\", "\\")
            .replace("\\u003C", "<").replace("\\u003E", ">")
            .replace("\\u0026", "&")
    }

    // ── Login support — mirrors Legado's login flow ──────────────────

    // Android CookieManager is per-app (like Legado).
    // After user logs in via this WebView, CookieManager stores the cookies.
    // Subsequent /render calls automatically get those cookies via CookieManager.getInstance().
    @SuppressLint("SetJavaScriptEnabled")
    suspend fun openLoginWebView(loginUrl: String): LoginSessionResponse = withContext(Dispatchers.Main) {
        status("登录页: ${loginUrl.take(50)}")
        val webView = android.webkit.WebView(context).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                blockNetworkImage = false
                userAgentString = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
                databaseEnabled = true
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: android.webkit.WebView, url: String?) {
                status("登录中: ${url?.take(60) ?: ""}")
            }
        }
        webView.loadUrl(loginUrl)
        // Show WebView on screen so user can interact
        WebViewProbeActivity.instance?.showLoginWebView(webView)
        LoginSessionResponse(ok = true, message = "登录 WebView 已显示在手机上")
    }

    data class LoginSessionResponse(val ok: Boolean, val message: String)
}
