package io.legado.validator.web

import io.legado.validator.analyzeRule.AnalyzeUrl
import io.legado.validator.model.BookSource

data class RuleIssue(
    val field: String,
    val rule: String,
    val severity: String,
    val message: String
)

object RuleValidator {

    fun validate(source: BookSource): List<RuleIssue> {
        val issues = mutableListOf<RuleIssue>()

        source.searchUrl?.takeIf { it.isNotBlank() }?.let { searchUrl ->
            try {
                val au = AnalyzeUrl(searchUrl, "test", 1, source.bookSourceUrl, source)
                if (au.hasWebView) {
                    issues.add(RuleIssue(
                        "searchUrl", searchUrl, "error",
                        "searchUrl 不应包含 webView 选项。webView 只用于 chapterUrl 渲染 CSR 正文。"
                    ))
                }
                Unit
            } catch (e: Exception) {
                issues.add(RuleIssue("searchUrl", searchUrl, "error",
                    "searchUrl 解析失败: ${e.message}"))
            }
        }

        source.ruleToc?.chapterUrl?.takeIf { it.isNotBlank() }?.let { chapterUrl ->
            val hasWebViewToken = chapterUrl.contains("webView", ignoreCase = true)
            val isCssRule = chapterUrl.contains("@")
            if (hasWebViewToken && isCssRule && !chapterUrl.contains("##\$##")) {
                issues.add(RuleIssue("ruleToc.chapterUrl", chapterUrl, "error",
                    "chapterUrl 是 CSS 选择器规则且含 webView，但缺少 ##\$## 链操作符。Legado 会把整串当一个 CSS 选择器解析，webView 选项不生效。正确写法: a@href##\$##,{\"webView\":true}"))
            }
            if (hasWebViewToken && !isCssRule) {
                try {
                    val au = AnalyzeUrl(chapterUrl, null, null, source.bookSourceUrl, source)
                    if (!au.hasWebView) {
                        issues.add(RuleIssue("ruleToc.chapterUrl", chapterUrl, "error",
                            "webView 选项未被 AnalyzeUrl 解析。检查 JSON 格式是否正确。"))
                    }
                    Unit
                } catch (e: Exception) {
                    issues.add(RuleIssue("ruleToc.chapterUrl", chapterUrl, "error",
                        "chapterUrl 解析失败: ${e.message}"))
                }
            }
        }

        source.header?.takeIf { it.isNotBlank() }?.let { header ->
            if (header.startsWith("<js>") && header.endsWith("</js>")) {
                try {
                    val au = AnalyzeUrl("https://example.com", null, null, source.bookSourceUrl, source)
                    if (au.headerMap.isEmpty()) {
                        issues.add(RuleIssue("header", header.take(80), "warning",
                            "header 的 <js> 块执行后未返回有效 header map。检查 JS 返回的是否是合法 JSON 对象。"))
                    }
                } catch (_: Exception) {
                    issues.add(RuleIssue("header", header.take(80), "error",
                        "header JS 执行失败"))
                }
            }
        }

        return issues
    }
}
