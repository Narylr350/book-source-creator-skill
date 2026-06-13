package io.legado.validator.debug

data class DebugStep(
    val phase: String,
    val status: String,
    val timestamp: Long = System.currentTimeMillis(),
    val request: RequestInfo? = null,
    val response: ResponseInfo? = null,
    val ruleHits: List<RuleHit> = emptyList(),
    val extracted: Map<String, Any?> = emptyMap(),
    val error: String? = null,
    val preview: String? = null
) {
    data class RequestInfo(val url: String, val method: String, val headers: Map<String, String>, val body: String?)
    data class ResponseInfo(val code: Int, val contentType: String?, val bodyPreview: String, val bodyLength: Int)
    data class RuleHit(val field: String, val rule: String, val value: String?, val success: Boolean)

    fun compact(): DebugStep {
        if (phase != "toc" || !extracted.containsKey("chapters")) return this
        val chapters = extracted["chapters"] as? List<*> ?: return this
        val chapterCount = extracted["chapterCount"] as? Int ?: chapters.size
        return copy(extracted = extracted.toMutableMap().apply {
            remove("chapters")
            put("chapterCount", chapterCount)
            put("first5", chapters.take(5))
            put("last5", chapters.takeLast(5))
        })
    }
}

fun List<DebugStep>.compact(): List<DebugStep> = map { it.compact() }
