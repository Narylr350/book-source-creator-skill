package io.legado.probe

import android.content.Context
import com.google.gson.Gson
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.runBlocking

class ProbeHttpServer(
    private val context: Context,
    port: Int = 18888
) : NanoHTTPD(port) {

    private val runner = WebViewRunner(context)
    private val gson = Gson()

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri
        return when {
            uri == "/render" && session.method == Method.POST -> handleRender(session)
            uri == "/login" && session.method == Method.POST -> handleLogin(session)
            uri == "/cookie-check" -> handleCookieCheck(session)
            uri == "/login-done" -> handleLoginDone()
            uri == "/ping" -> newFixedLengthResponse(Response.Status.OK, "text/plain", "pong")
            uri == "/info" -> handleInfo()
            uri == "/test" -> handleTest()
            else -> newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json",
                """{"error":"Not found"}""")
        }
    }

    // Open a WebView for user to manually log in.
    // Android CookieManager is per-app — once user logs in,
    // all subsequent WebViews share the same cookies.
    private fun handleLogin(session: IHTTPSession): Response {
        return try {
            // If Activity was destroyed (user swiped away), relaunch it
            if (WebViewProbeActivity.instance == null) {
                val intent = android.content.Intent(context, WebViewProbeActivity::class.java).apply {
                    addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
                // Wait briefly for Activity to initialize
                repeat(10) {
                    if (WebViewProbeActivity.instance != null) return@repeat
                    Thread.sleep(200)
                }
                if (WebViewProbeActivity.instance == null) {
                    return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json",
                        """{"ok":false,"error":"Probe Activity not running and failed to relaunch"}""")
                }
            }

            val bodyMap = HashMap<String, String>()
            session.parseBody(bodyMap)
            val jsonBody = bodyMap["postData"] ?: return newFixedLengthResponse(
                Response.Status.BAD_REQUEST, "application/json", """{"error":"Empty body"}""")
            val req = gson.fromJson(jsonBody, LoginRequest::class.java)
            val resp = runBlocking { runner.openLoginWebView(req.url) }
            newFixedLengthResponse(Response.Status.OK, "application/json", gson.toJson(resp))
        } catch (e: Exception) {
            newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json",
                """{"ok":false,"error":"${e.message?.replace("\"", "\\\"")}"}""")
        }
    }

    // Switch back to log view after login is done
    private fun handleLoginDone(): Response {
        WebViewProbeActivity.instance?.showLogView()
        return newFixedLengthResponse(Response.Status.OK, "application/json", """{"ok":true,"message":"Switched to log view"}""")
    }

    // Check CookieManager for cookies after user completed login
    private fun handleCookieCheck(session: IHTTPSession): Response {
        val domain = session.parms["domain"] ?: ""
        if (domain.isEmpty()) {
            return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json",
                """{"error":"domain is required"}""")
        }
        val cm = android.webkit.CookieManager.getInstance()
        val url = "https://$domain"
        val cookies = cm.getCookie(url) ?: ""
        val hasCookies = cookies.isNotEmpty()
        return newFixedLengthResponse(Response.Status.OK, "application/json", gson.toJson(mapOf(
            "url" to url,
            "cookies" to cookies,
            "hasCookies" to hasCookies,
            "message" to if (hasCookies) "Cookies found — login likely successful" else "No cookies yet — user may still be on login page"
        )))
    }

    private fun handleRender(session: IHTTPSession): Response {
        return try {
            val bodyMap = HashMap<String, String>()
            session.parseBody(bodyMap)
            val jsonBody = bodyMap["postData"] ?: return newFixedLengthResponse(
                Response.Status.BAD_REQUEST, "application/json", """{"error":"Empty body"}""")
            val request = gson.fromJson(jsonBody, RenderRequest::class.java)
            val response = runBlocking { runner.render(request) }
            newFixedLengthResponse(Response.Status.OK, "application/json", gson.toJson(response))
        } catch (e: Exception) {
            newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json",
                """{"ok":false,"error":"${e.message?.replace("\"", "\\\"")}"}""")
        }
    }

    private fun handleTest(): Response {
        return try {
            val request = RenderRequest(
                url = "data:text/html,<h1>Probe OK</h1><p>WebView works</p>",
                timeout = 10000L, jsRetries = 3, jsDelay = 500L, screenshot = false
            )
            val response = runBlocking { runner.render(request) }
            newFixedLengthResponse(Response.Status.OK, "application/json", gson.toJson(response))
        } catch (e: Exception) {
            newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json",
                """{"ok":false,"error":"${e.message?.replace("\"", "\\\"")}"}""")
        }
    }

    private fun handleInfo(): Response {
        val webViewPackage = try {
            android.webkit.WebView.getCurrentWebViewPackage()
        } catch (_: Exception) { null }
        val info = mapOf(
            "name" to "legado-android-probe",
            "version" to "0.2.0",
            "api" to listOf("/render", "/login", "/cookie-check", "/ping", "/info"),
            "androidSdk" to android.os.Build.VERSION.SDK_INT,
            "androidRelease" to android.os.Build.VERSION.RELEASE,
            "webViewPackage" to webViewPackage?.packageName,
            "webViewVersion" to webViewPackage?.versionName,
            "deviceModel" to "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}"
        )
        return newFixedLengthResponse(Response.Status.OK, "application/json", gson.toJson(info))
    }
}

data class LoginRequest(val url: String = "", val timeout: Long = 180000L)
