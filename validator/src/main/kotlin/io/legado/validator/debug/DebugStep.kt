package io.legado.validator.debug

data class DebugStep(
    val phase: String,
    val status: String,
    val timestamp: Long = System.currentTimeMillis(),
    val mode: String = "http",              // "http" | "browser" | "android"
    val request: RequestInfo? = null,
    val response: ResponseInfo? = null,
    val ruleHits: List<RuleHit> = emptyList(),
    val extracted: Map<String, Any?> = emptyMap(),
    val error: String? = null,
    val preview: String? = null,
    // 渲染相关字段
    val finalUrl: String? = null,
    val renderedHtmlPreview: String? = null,
    val screenshotBase64: String? = null,
    val renderError: String? = null,
    val needsAppReview: Boolean = false,
    val reviewReason: String? = null,
    val compatibilityWarnings: List<CompatibilityWarning>? = null,
    // Probe 字段 (P9)
    val probeAvailable: Boolean? = null,
    val probeDevice: String? = null,
    val androidWebViewVersion: String? = null,
    val webViewHtmlPreview: String? = null,
    val webViewScreenshotBase64: String? = null,
    // P10 会话模式
    val sessionMode: String = "anonymous",   // "anonymous" | "authenticated"
    // ── 诊断升级 (P11) ──
    val errorCode: String? = null,           // ErrorCode 名 (如 "CONTENT_SELECTOR_EMPTY")
    val subphase: String? = null,            // "fetch" | "render" | "webjs" | "selector" | "quality"
    val failedField: String? = null,         // "ruleContent.content" 等
    val allowedFixes: List<String> = emptyList(),
    val forbiddenFixes: List<String> = emptyList(),
    val evidence: Map<String, Any?> = emptyMap(),
    val debugArtifacts: Map<String, String>? = null  // kind → 相对路径
) {
    data class RequestInfo(val url: String, val method: String, val headers: Map<String, String>, val body: String?)
    data class ResponseInfo(val code: Int, val contentType: String?, val bodyPreview: String, val bodyLength: Int)
    data class RuleHit(val field: String, val rule: String, val value: String?, val success: Boolean)
    data class CompatibilityWarning(val feature: String, val description: String)

    fun compact(): DebugStep {
        var result = this
        if (phase == "toc" && extracted.containsKey("chapters")) {
            val chapters = extracted["chapters"] as? List<*> ?: return result
            val chapterCount = extracted["chapterCount"] as? Int ?: chapters.size
            result = result.copy(extracted = extracted.toMutableMap().apply {
                remove("chapters")
                put("chapterCount", chapterCount)
                put("first5", chapters.take(5))
                put("last5", chapters.takeLast(5))
            })
        }
        if (webViewScreenshotBase64 != null) {
            result = result.copy(webViewScreenshotBase64 = "[${webViewScreenshotBase64.length} chars]")
        }
        return result
    }
}

fun List<DebugStep>.compact(): List<DebugStep> = map { it.compact() }
