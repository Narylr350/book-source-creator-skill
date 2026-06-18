package io.legado.probe

data class RenderRequest(
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val cookies: String? = null,
    val javaScript: String? = null,
    val timeout: Long = 60000L,
    val jsRetries: Int = 30,
    val jsDelay: Long = 1000L,
    val screenshot: Boolean = true,
    // Gap #8: support loadDataWithBaseURL — matches Legado BackstageWebView.load()
    val html: String? = null,
    val encoding: String? = null,
    // Session mode: reuse persistent WebView from /login
    val useSession: Boolean = false
)

data class RenderResponse(
    val ok: Boolean,
    val html: String? = null,
    val finalUrl: String? = null,
    val title: String? = null,
    val cookies: String? = null,
    val screenshotBase64: String? = null,
    val error: String? = null,
    val jsError: String? = null,
    val loadTimeMs: Long = 0
)
