package io.legado.validator.debug

/**
 * ErrorCode — 结构化错误码，每个 code 匹配一组 fix 边界、证据要求、重试策略。
 *
 * Phase 2 端到端切片：仅 CONTENT_SELECTOR_EMPTY 提供完整 ErrorCodeMeta；
 * 其余 code 在后续 phase 逐步注册。
 */

enum class ErrorCode {
    // 通用 (1)
    HTTP_BLOCKED,

    // 搜索 (4)
    SEARCH_EMPTY,
    SEARCH_SELECTOR_EMPTY,
    BOOK_URL_EMPTY,
    BOOK_URL_MALFORMED,

    // 详情 (2)
    DETAIL_SELECTOR_EMPTY,
    DETAIL_TOC_URL_EMPTY,

    // 目录 (2)
    TOC_EMPTY,
    TOC_SELECTOR_EMPTY,

    // 章节 URL (3)
    CHAPTER_URL_EMPTY,
    CHAPTER_URL_MALFORMED,
    CHAPTER_URL_MISSING_WEBVIEW,

    // Android Probe (1)
    ANDROID_PROBE_UNAVAILABLE,

    // 正文获取/选择器 (4)
    CONTENT_SELECTOR_EMPTY,
    CONTENT_TOO_SHORT,
    CONTENT_DUPLICATE_BETWEEN_CHAPTERS,
    CONTENT_CHAPTER_MISMATCH,

    // 正文页面分类 (4)
    CONTENT_IS_LOGIN_PAGE,
    CONTENT_IS_CAPTCHA_PAGE,
    CONTENT_IS_VIP_LOCK_PAGE,
    CONTENT_IS_CSR_SHELL,

    // WebView / WebJs (3)
    WEBVIEW_RENDER_TIMEOUT,
    WEBJS_EXEC_ERROR,
    WEBJS_RETURN_EMPTY,

    // 登录态 (2)
    COOKIE_REQUIRED,
    COOKIE_PRESENT_BUT_UNAUTHORIZED,

    // 兜底 (1)
    APP_REVIEW_REQUIRED
}

enum class Phase {
    SEARCH, DETAIL, TOC, CONTENT, CHAPTER_URL
}

enum class Subphase {
    FETCH, RENDER, WEBJS, SELECTOR, QUALITY, IDENTITY
}

enum class Severity {
    /** 可自动回修 */
    FIXABLE,
    /** 技术上阻断，AI 不该乱改 */
    BLOCKED,
    /** validator 无法可靠确认，需 App 实测 */
    NEEDS_APP_REVIEW,
    /** validator 能力不足 */
    VALIDATOR_LIMITATION,
    /** 规则/环境严重错误，停止 */
    FATAL
}

enum class Category {
    NETWORK, AUTH, ANTI_BOT, RENDER, WEBJS, SELECTOR, QUALITY, STRUCTURE, VALIDATOR_ENV, APP_ONLY
}

enum class Capability {
    ANDROID_PROBE,
    AUTHENTICATED_COOKIE,
    BROWSER_RENDER,
    LEGADO_APP_MANUAL_TEST
}

enum class HumanAction {
    NONE,
    CONNECT_ANDROID_DEVICE,
    LOGIN_IN_BROWSER,
    LOGIN_IN_ANDROID_PROBE,
    SOLVE_CAPTCHA,
    TEST_IN_LEGADO_APP,
    PROVIDE_COOKIE_OR_TOKEN
}

enum class RetryPolicy {
    /** 只允许在 allowedFixes 内重试 */
    AUTO_RETRY_SAME_FIELDS,
    /** 人类操作后再验证 */
    RETRY_AFTER_HUMAN_ACTION,
    /** 换 android/browser/http 模式 */
    RETRY_WITH_DIFFERENT_MODE,
    /** 不要自动修 */
    NO_AUTO_RETRY
}

data class ErrorCodeMeta(
    val code: ErrorCode,
    val phase: Phase,
    val subphase: Subphase,
    val severity: Severity,
    val category: Category,
    val failedField: String? = null,
    val allowedFixes: List<String> = emptyList(),
    val forbiddenFixes: List<String> = emptyList(),
    val requiredCapabilities: List<Capability> = emptyList(),
    val humanAction: HumanAction = HumanAction.NONE,
    val retryPolicy: RetryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
    val messageTemplate: String,
    val evidenceKeys: List<String> = emptyList(),
    val docHint: String? = null
)

object ErrorCodeRegistry {
    private val registry = mutableMapOf<ErrorCode, ErrorCodeMeta>()

    val CONTENT_SELECTOR_EMPTY_META = ErrorCodeMeta(
        code = ErrorCode.CONTENT_SELECTOR_EMPTY,
        phase = Phase.CONTENT,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.SELECTOR,
        failedField = "ruleContent.content",
        allowedFixes = listOf("ruleContent.content"),
        forbiddenFixes = listOf(
            "searchUrl", "ruleSearch", "ruleBookInfo",
            "ruleToc.chapterUrl", "header", "loginUrl", "enabledCookieJar"
        ),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "正文源码存在，但 ruleContent.content 未匹配到正文。",
        evidenceKeys = listOf(
            "htmlLength", "contentLength", "htmlKind",
            "debugArtifacts.responseHtml", "debugArtifacts.ruleHits"
        ),
        docHint = "检查渲染后 DOM 中正文区域，优先只修改 ruleContent.content。"
    )

    // ── 页面分类 ──

    val CONTENT_IS_LOGIN_PAGE_META = ErrorCodeMeta(
        code = ErrorCode.CONTENT_IS_LOGIN_PAGE,
        phase = Phase.CONTENT,
        subphase = Subphase.FETCH,
        severity = Severity.BLOCKED,
        category = Category.AUTH,
        failedField = null,
        allowedFixes = listOf("enabledCookieJar", "loginUrl", "header"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleToc", "ruleContent.content"),
        requiredCapabilities = listOf(Capability.AUTHENTICATED_COOKIE),
        humanAction = HumanAction.LOGIN_IN_ANDROID_PROBE,
        retryPolicy = RetryPolicy.RETRY_AFTER_HUMAN_ACTION,
        messageTemplate = "正文页返回登录页，当前会话未获得正文访问权限。",
        evidenceKeys = listOf("responseCode", "htmlKind", "loginFormDetected", "debugArtifacts.renderedHtml"),
        docHint = "不要修改正文选择器。先完成登录并注入 Cookie。"
    )

    val CONTENT_IS_CAPTCHA_PAGE_META = ErrorCodeMeta(
        code = ErrorCode.CONTENT_IS_CAPTCHA_PAGE,
        phase = Phase.CONTENT,
        subphase = Subphase.FETCH,
        severity = Severity.BLOCKED,
        category = Category.ANTI_BOT,
        failedField = null,
        allowedFixes = emptyList(),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleToc", "ruleContent"),
        requiredCapabilities = listOf(Capability.LEGADO_APP_MANUAL_TEST),
        humanAction = HumanAction.SOLVE_CAPTCHA,
        retryPolicy = RetryPolicy.NO_AUTO_RETRY,
        messageTemplate = "正文页返回验证码页面，HTTP/WebView 模式下无法自动绕过。",
        evidenceKeys = listOf("responseCode", "htmlKind", "captchaType", "debugArtifacts.responseHtml"),
        docHint = "验证码无法自动绕过，需 App 手动实测。不要修改书源规则。"
    )

    val CONTENT_IS_VIP_LOCK_PAGE_META = ErrorCodeMeta(
        code = ErrorCode.CONTENT_IS_VIP_LOCK_PAGE,
        phase = Phase.CONTENT,
        subphase = Subphase.FETCH,
        severity = Severity.BLOCKED,
        category = Category.AUTH,
        failedField = null,
        allowedFixes = emptyList(),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleToc", "ruleContent"),
        requiredCapabilities = listOf(Capability.AUTHENTICATED_COOKIE, Capability.LEGADO_APP_MANUAL_TEST),
        humanAction = HumanAction.LOGIN_IN_ANDROID_PROBE,
        retryPolicy = RetryPolicy.RETRY_AFTER_HUMAN_ACTION,
        messageTemplate = "正文页提示 VIP/付费，需要登录且有付费权限的账号。",
        evidenceKeys = listOf("responseCode", "htmlKind", "vipText", "debugArtifacts.responseHtml"),
        docHint = "确认已登录并有付费权限。规则本身可能正确。"
    )

    val CONTENT_IS_CSR_SHELL_META = ErrorCodeMeta(
        code = ErrorCode.CONTENT_IS_CSR_SHELL,
        phase = Phase.CONTENT,
        subphase = Subphase.RENDER,
        severity = Severity.FIXABLE,
        category = Category.RENDER,
        failedField = "ruleToc.chapterUrl",
        allowedFixes = listOf("ruleToc.chapterUrl", "ruleContent.webJs"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo"),
        requiredCapabilities = listOf(Capability.ANDROID_PROBE),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.RETRY_WITH_DIFFERENT_MODE,
        messageTemplate = "正文响应是前端 CSR 空壳，HTTP 模式无法直接提取正文。",
        evidenceKeys = listOf("htmlKind", "csrFramework", "mode", "debugArtifacts.responseHtml"),
        docHint = "确认 chapterUrl 带 webView:true，并使用 Android Probe 验证。"
    )

    // ── WebView / WebJs ──

    val WEBVIEW_RENDER_TIMEOUT_META = ErrorCodeMeta(
        code = ErrorCode.WEBVIEW_RENDER_TIMEOUT,
        phase = Phase.CONTENT,
        subphase = Subphase.RENDER,
        severity = Severity.FIXABLE,
        category = Category.RENDER,
        failedField = null,
        allowedFixes = listOf("respondTime", "ruleContent.webJs"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleToc", "header"),
        requiredCapabilities = listOf(Capability.ANDROID_PROBE),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "WebView 渲染超时，页面未在预期时间内加载完成。",
        evidenceKeys = listOf("timeoutMs", "url", "debugArtifacts.screenshot"),
        docHint = "增加 respondTime 或优化 webJs 等待逻辑。"
    )

    val WEBJS_EXEC_ERROR_META = ErrorCodeMeta(
        code = ErrorCode.WEBJS_EXEC_ERROR,
        phase = Phase.CONTENT,
        subphase = Subphase.WEBJS,
        severity = Severity.FIXABLE,
        category = Category.WEBJS,
        failedField = "ruleContent.webJs",
        allowedFixes = listOf("ruleContent.webJs"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleToc.chapterUrl", "header", "loginUrl"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "webJs 执行异常，脚本在 WebView 中运行时出错。",
        evidenceKeys = listOf("jsError", "debugArtifacts.extractedTxt"),
        docHint = "检查 webJs 中的 DOM 选择器是否正确、是否调用了不存在的 API。"
    )

    val WEBJS_RETURN_EMPTY_META = ErrorCodeMeta(
        code = ErrorCode.WEBJS_RETURN_EMPTY,
        phase = Phase.CONTENT,
        subphase = Subphase.WEBJS,
        severity = Severity.FIXABLE,
        category = Category.WEBJS,
        failedField = "ruleContent.webJs",
        allowedFixes = listOf("ruleContent.webJs"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleToc.chapterUrl", "header", "loginUrl"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "webJs 执行成功但返回空内容，DOM 可能未渲染或选择器未命中。",
        evidenceKeys = listOf("debugArtifacts.renderedHtml", "debugArtifacts.ruleHits"),
        docHint = "检查 webJs 中的 DOM 选择器，确认目标元素在页面中实际存在。"
    )

    // ── 正文质量 ──

    val CONTENT_TOO_SHORT_META = ErrorCodeMeta(
        code = ErrorCode.CONTENT_TOO_SHORT,
        phase = Phase.CONTENT,
        subphase = Subphase.QUALITY,
        severity = Severity.FIXABLE,
        category = Category.QUALITY,
        failedField = "ruleContent.content",
        allowedFixes = listOf("ruleContent.content"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleToc.chapterUrl", "header"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "正文提取成功但内容太短（< 100 字符），可能是公告、序章或选择器提取不完整。",
        evidenceKeys = listOf("contentLength", "chapterTitle", "preview", "isLikelyNoticeOrLock"),
        docHint = "检查 content 是否完整；可能是短章、VIP 提示、或选择器没覆盖全部正文。"
    )

    val CONTENT_CHAPTER_MISMATCH_META = ErrorCodeMeta(
        code = ErrorCode.CONTENT_CHAPTER_MISMATCH,
        phase = Phase.CONTENT,
        subphase = Subphase.IDENTITY,
        severity = Severity.FIXABLE,
        category = Category.QUALITY,
        failedField = null,
        allowedFixes = emptyList(),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "提取的章节内容与章节标题可能不匹配。",
        evidenceKeys = listOf("chapterTitle", "contentPreview", "titleFoundInContent"),
        docHint = "第一版仅作 quality warning，不强转 error。章节标题可能在正文中不出现。"
    )

    val CONTENT_DUPLICATE_BETWEEN_CHAPTERS_META = ErrorCodeMeta(
        code = ErrorCode.CONTENT_DUPLICATE_BETWEEN_CHAPTERS,
        phase = Phase.CONTENT,
        subphase = Subphase.QUALITY,
        severity = Severity.FIXABLE,
        category = Category.QUALITY,
        failedField = "ruleContent.content",
        allowedFixes = listOf("ruleContent.content", "ruleToc.chapterUrl"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "header"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "两章正文内容完全相同，可能是 WebView 预加载总是命中同一章节。",
        evidenceKeys = listOf("chapter1Title", "chapter2Title", "contentHash", "debugArtifacts.chapter1ExtractedTxt", "debugArtifacts.chapter2ExtractedTxt"),
        docHint = "检查 chapterUrl 是否对每章生成不同的 URL，避免 WebView 总是渲染同一页。"
    )

    // ── 通用 ──

    val HTTP_BLOCKED_META = ErrorCodeMeta(
        code = ErrorCode.HTTP_BLOCKED,
        phase = Phase.CONTENT,  // phase 由运行时覆盖
        subphase = Subphase.FETCH,
        severity = Severity.BLOCKED,
        category = Category.NETWORK,
        failedField = null,
        allowedFixes = emptyList(),
        forbiddenFixes = emptyList(),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.RETRY_AFTER_HUMAN_ACTION,
        messageTemplate = "HTTP 请求被阻断，可能是反爬、IP限制或认证问题。",
        evidenceKeys = listOf("httpStatus", "blockType", "phase", "debugArtifacts.responseHtml"),
        docHint = "检查 evidence.httpStatus 和 evidence.blockType 判断具体阻断类型。"
    )

    // ── 搜索 ──

    val SEARCH_EMPTY_META = ErrorCodeMeta(
        code = ErrorCode.SEARCH_EMPTY,
        phase = Phase.SEARCH,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.SELECTOR,
        failedField = "searchUrl",
        allowedFixes = listOf("searchUrl", "ruleSearch"),
        forbiddenFixes = listOf("ruleBookInfo", "ruleToc", "ruleContent", "header"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "搜索请求成功但未返回任何结果。",
        evidenceKeys = listOf("resultCount", "keyword", "responseCode", "debugArtifacts.responseHtml"),
        docHint = "验证搜索 URL 和关键词；可能是搜索 API 路径或参数问题。"
    )

    val SEARCH_SELECTOR_EMPTY_META = ErrorCodeMeta(
        code = ErrorCode.SEARCH_SELECTOR_EMPTY,
        phase = Phase.SEARCH,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.SELECTOR,
        failedField = "ruleSearch.bookList",
        allowedFixes = listOf("ruleSearch.bookList"),
        forbiddenFixes = listOf("searchUrl", "ruleBookInfo", "ruleToc", "ruleContent", "header", "loginUrl"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "搜索响应源码存在，但 ruleSearch.bookList 未匹配到书籍节点。",
        evidenceKeys = listOf("htmlLength", "matchedNodeCount", "debugArtifacts.responseHtml"),
        docHint = "检查 bookList 选择器是否正确匹配搜索结果列表容器。"
    )

    val BOOK_URL_EMPTY_META = ErrorCodeMeta(
        code = ErrorCode.BOOK_URL_EMPTY,
        phase = Phase.SEARCH,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.SELECTOR,
        failedField = "ruleSearch.bookUrl",
        allowedFixes = listOf("ruleSearch.bookUrl"),
        forbiddenFixes = listOf("ruleBookInfo", "ruleToc", "ruleContent", "header", "loginUrl"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "搜索结果存在但 ruleSearch.bookUrl 提取为空。",
        evidenceKeys = listOf("bookName", "debugArtifacts.ruleHits"),
        docHint = "检查 detailUrl 规则是否正确构建详情页 URL。"
    )

    val BOOK_URL_MALFORMED_META = ErrorCodeMeta(
        code = ErrorCode.BOOK_URL_MALFORMED,
        phase = Phase.SEARCH,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.SELECTOR,
        failedField = "ruleSearch.bookUrl",
        allowedFixes = listOf("ruleSearch.bookUrl"),
        forbiddenFixes = listOf("ruleBookInfo", "ruleToc", "ruleContent", "header", "loginUrl"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "搜索结果存在但 bookUrl 不是有效详情页 URL。",
        evidenceKeys = listOf("bookUrl", "bookName"),
        docHint = "检查 bookUrl 规则是否生成完整的 URL（可能需要拼接 baseUrl）。"
    )

    // ── 详情 ──

    val DETAIL_SELECTOR_EMPTY_META = ErrorCodeMeta(
        code = ErrorCode.DETAIL_SELECTOR_EMPTY,
        phase = Phase.DETAIL,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.SELECTOR,
        failedField = "ruleBookInfo",
        allowedFixes = listOf("ruleBookInfo"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleToc", "ruleContent"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "详情页源码存在但规则未匹配到详情字段。",
        evidenceKeys = listOf("htmlLength", "debugArtifacts.responseHtml", "debugArtifacts.ruleHits"),
        docHint = "检查 ruleBookInfo 各字段的选择器是否正确。"
    )

    val DETAIL_TOC_URL_EMPTY_META = ErrorCodeMeta(
        code = ErrorCode.DETAIL_TOC_URL_EMPTY,
        phase = Phase.DETAIL,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.SELECTOR,
        failedField = "ruleBookInfo.tocUrl",
        allowedFixes = listOf("ruleBookInfo.tocUrl"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleToc", "ruleContent"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "详情页解析成功但未能提取目录 URL。",
        evidenceKeys = listOf("debugArtifacts.ruleHits"),
        docHint = "检查 tocUrl 规则，可能目录页在另一个路径。"
    )

    // ── 目录 ──

    val TOC_EMPTY_META = ErrorCodeMeta(
        code = ErrorCode.TOC_EMPTY,
        phase = Phase.TOC,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.SELECTOR,
        failedField = "ruleToc.chapterList",
        allowedFixes = listOf("ruleToc.chapterList"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleContent", "header"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "目录页源码存在但章节列表为空。",
        evidenceKeys = listOf("chapterCount", "debugArtifacts.responseHtml"),
        docHint = "检查 chapterList 选择器；可能是分页、懒加载或需登录。"
    )

    val TOC_SELECTOR_EMPTY_META = ErrorCodeMeta(
        code = ErrorCode.TOC_SELECTOR_EMPTY,
        phase = Phase.TOC,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.SELECTOR,
        failedField = "ruleToc.chapterList",
        allowedFixes = listOf("ruleToc.chapterList"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleContent", "header"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "目录页源码存在但 ruleToc.chapterList 未匹配到任何节点。",
        evidenceKeys = listOf("htmlLength", "debugArtifacts.responseHtml"),
        docHint = "检查 chapterList 选择器是否正确匹配章节 DOM 结构。"
    )

    // ── 章节 URL ──

    val CHAPTER_URL_EMPTY_META = ErrorCodeMeta(
        code = ErrorCode.CHAPTER_URL_EMPTY,
        phase = Phase.CHAPTER_URL,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.STRUCTURE,
        failedField = "ruleToc.chapterUrl",
        allowedFixes = listOf("ruleToc.chapterUrl"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleContent", "header", "loginUrl"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "目录章节存在但 chapterUrl 生成结果为空。",
        evidenceKeys = listOf("chapterName", "debugArtifacts.ruleHits"),
        docHint = "检查 chapterUrl 规则，确保使用正确的 JSON path 或 CSS 选择器。"
    )

    val CHAPTER_URL_MALFORMED_META = ErrorCodeMeta(
        code = ErrorCode.CHAPTER_URL_MALFORMED,
        phase = Phase.CHAPTER_URL,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.STRUCTURE,
        failedField = "ruleToc.chapterUrl",
        allowedFixes = listOf("ruleToc.chapterUrl"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleContent", "header", "loginUrl"),
        requiredCapabilities = emptyList(),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.AUTO_RETRY_SAME_FIELDS,
        messageTemplate = "chapterUrl 生成结果格式不正确。",
        evidenceKeys = listOf("chapterUrl", "chapterName"),
        docHint = "检查 chapterUrl 是否生成了完整 URL 或合法相对路径。"
    )

    val CHAPTER_URL_MISSING_WEBVIEW_META = ErrorCodeMeta(
        code = ErrorCode.CHAPTER_URL_MISSING_WEBVIEW,
        phase = Phase.CHAPTER_URL,
        subphase = Subphase.SELECTOR,
        severity = Severity.FIXABLE,
        category = Category.RENDER,
        failedField = "ruleToc.chapterUrl",
        allowedFixes = listOf("ruleToc.chapterUrl"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleContent"),
        requiredCapabilities = listOf(Capability.ANDROID_PROBE),
        humanAction = HumanAction.NONE,
        retryPolicy = RetryPolicy.RETRY_WITH_DIFFERENT_MODE,
        messageTemplate = "CSR 站点但 chapterUrl 未配置 webView:true。",
        evidenceKeys = listOf("chapterUrl"),
        docHint = "在 chapterUrl 后追加 ,{\"webView\":true} 让 Legado 用 WebView 渲染。"
    )

    // ── Android Probe ──

    val ANDROID_PROBE_UNAVAILABLE_META = ErrorCodeMeta(
        code = ErrorCode.ANDROID_PROBE_UNAVAILABLE,
        phase = Phase.CONTENT,
        subphase = Subphase.FETCH,
        severity = Severity.VALIDATOR_LIMITATION,
        category = Category.VALIDATOR_ENV,
        failedField = null,
        allowedFixes = emptyList(),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleToc", "ruleContent", "header"),
        requiredCapabilities = listOf(Capability.ANDROID_PROBE),
        humanAction = HumanAction.CONNECT_ANDROID_DEVICE,
        retryPolicy = RetryPolicy.RETRY_WITH_DIFFERENT_MODE,
        messageTemplate = "Android Probe 不可用，WebView/CSR 内容无法在本机验证。",
        evidenceKeys = listOf("probeError"),
        docHint = "连接 Android 设备并运行 setup-android-probe.bat，或切换 mode=android。"
    )

    // ── 登录态 ──

    val COOKIE_REQUIRED_META = ErrorCodeMeta(
        code = ErrorCode.COOKIE_REQUIRED,
        phase = Phase.CONTENT,
        subphase = Subphase.FETCH,
        severity = Severity.BLOCKED,
        category = Category.AUTH,
        failedField = "enabledCookieJar",
        allowedFixes = listOf("enabledCookieJar", "loginUrl", "header"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleToc", "ruleContent.content"),
        requiredCapabilities = listOf(Capability.AUTHENTICATED_COOKIE),
        humanAction = HumanAction.PROVIDE_COOKIE_OR_TOKEN,
        retryPolicy = RetryPolicy.RETRY_AFTER_HUMAN_ACTION,
        messageTemplate = "需要 Cookie/Token 但未注入。validator 无法独立获取认证凭据。",
        evidenceKeys = listOf("responseCode", "htmlKind"),
        docHint = "用户需提供 Cookie；bsg.mjs 根据 enabledCookieJar + cookies.json 协作判断。"
    )

    val COOKIE_PRESENT_BUT_UNAUTHORIZED_META = ErrorCodeMeta(
        code = ErrorCode.COOKIE_PRESENT_BUT_UNAUTHORIZED,
        phase = Phase.CONTENT,
        subphase = Subphase.FETCH,
        severity = Severity.BLOCKED,
        category = Category.AUTH,
        failedField = "header",
        allowedFixes = listOf("header"),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleToc", "ruleContent"),
        requiredCapabilities = listOf(Capability.AUTHENTICATED_COOKIE),
        humanAction = HumanAction.LOGIN_IN_ANDROID_PROBE,
        retryPolicy = RetryPolicy.RETRY_AFTER_HUMAN_ACTION,
        messageTemplate = "Cookie 已注入但仍然 401/403，凭据可能已过期。",
        evidenceKeys = listOf("responseCode", "httpStatus", "debugArtifacts.responseHtml"),
        docHint = "重新登录获取新 Cookie/Token。"
    )

    // ── 兜底 ──

    val APP_REVIEW_REQUIRED_META = ErrorCodeMeta(
        code = ErrorCode.APP_REVIEW_REQUIRED,
        phase = Phase.CONTENT,
        subphase = Subphase.IDENTITY,
        severity = Severity.NEEDS_APP_REVIEW,
        category = Category.APP_ONLY,
        failedField = null,
        allowedFixes = emptyList(),
        forbiddenFixes = listOf("searchUrl", "ruleSearch", "ruleBookInfo", "ruleToc", "ruleContent", "header", "loginUrl"),
        requiredCapabilities = listOf(Capability.LEGADO_APP_MANUAL_TEST),
        humanAction = HumanAction.TEST_IN_LEGADO_APP,
        retryPolicy = RetryPolicy.NO_AUTO_RETRY,
        messageTemplate = "validator 无法确认此结果，需在 Legado App 内实测。",
        evidenceKeys = emptyList(),
        docHint = "不要修改书源规则。在阅读 App 中手动导入测试。"
    )

    init {
        register(CONTENT_SELECTOR_EMPTY_META)
        register(CONTENT_IS_LOGIN_PAGE_META)
        register(CONTENT_IS_CAPTCHA_PAGE_META)
        register(CONTENT_IS_VIP_LOCK_PAGE_META)
        register(CONTENT_IS_CSR_SHELL_META)
        register(WEBVIEW_RENDER_TIMEOUT_META)
        register(WEBJS_EXEC_ERROR_META)
        register(WEBJS_RETURN_EMPTY_META)
        register(CONTENT_TOO_SHORT_META)
        register(CONTENT_CHAPTER_MISMATCH_META)
        register(CONTENT_DUPLICATE_BETWEEN_CHAPTERS_META)
        register(HTTP_BLOCKED_META)
        register(SEARCH_EMPTY_META)
        register(SEARCH_SELECTOR_EMPTY_META)
        register(BOOK_URL_EMPTY_META)
        register(BOOK_URL_MALFORMED_META)
        register(DETAIL_SELECTOR_EMPTY_META)
        register(DETAIL_TOC_URL_EMPTY_META)
        register(TOC_EMPTY_META)
        register(TOC_SELECTOR_EMPTY_META)
        register(CHAPTER_URL_EMPTY_META)
        register(CHAPTER_URL_MALFORMED_META)
        register(CHAPTER_URL_MISSING_WEBVIEW_META)
        register(ANDROID_PROBE_UNAVAILABLE_META)
        register(COOKIE_REQUIRED_META)
        register(COOKIE_PRESENT_BUT_UNAUTHORIZED_META)
        register(APP_REVIEW_REQUIRED_META)
    }

    private fun register(meta: ErrorCodeMeta) {
        registry[meta.code] = meta
    }

    fun get(code: ErrorCode): ErrorCodeMeta? = registry[code]

    fun getOrNull(code: ErrorCode): ErrorCodeMeta? = registry[code]
}
