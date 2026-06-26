# WebView 行为矩阵

## 三列对比

| 行为维度 | 阅读 App (BackstageWebView) | Android Probe | Validator HTTP 模式 |
|----------|---------------------------|------------------------|-------------------|
| WebSettings.javaScriptEnabled | true | true | N/A |
| WebSettings.domStorageEnabled | true | true | N/A |
| WebSettings.mixedContentMode | ALWAYS_ALLOW | ALWAYS_ALLOW | N/A |
| WebSettings.blockNetworkImage | true | true (优化) | N/A |
| User-Agent | headerMap["User-Agent"] 或 AppConfig 默认 | 从 source.headerMap 传入 | 从 source.headerMap 传入 |
| loadUrl headers | headerMap (含 Cookie) | 从请求传入 | curl headers |
| SSL 错误 | handler.proceed() | handler.proceed() | curl 默认 |
| onPageFinished | 保存 cookie → 1000ms 延迟 → executeJS | 保存 cookie → executeJS | N/A |
| JS 执行方式 | evaluateJavascript() | evaluateJavascript() | Rhino |
| JS 结果等待 | 最多 30 次重试 × 1000ms | 最多 30 次 × 1000ms | 同步 |
| 外层超时 | 60s | 60s (可配置) | curl 30s |
| webJs 支持 | evaluateJavascript(webJs) | evaluateJavascript(webJs) | Rhino evalJS |
| sourceRegex | onLoadResource 匹配 | 不实现 | 传参但不使用（死参数） |
| Cookie 管理 | CookieManager → CookieStore (Room DB) | CookieManager → CookieStore (渲染域隔离) | CookieStore + eTLD+1 归一 (JSON 持久化) |
| TLS 指纹 | Android BoringSSL | Android BoringSSL | curl (OpenSSL) |
| 截图 | 无 | Bitmap → Base64 PNG | N/A |
| POST body | 不支持 (WebView 是 GET) | 不支持 | 支持 |

## 关键差异说明

1. **evaluateJavascript vs loadUrl("javascript:")**: 阅读的 SnifferWebClient 用 `loadUrl("javascript:...")`（fire-and-forget），但 BackstageWebView 用 `evaluateJavascript()`（有回调）。Probe 只实现后者。
2. **sourceRegex**: 阅读在 `onLoadResource` 时匹配资源 URL 做嗅探。Probe 和 validator 都不实现（BookContent.kt 传参但函数体未使用，是死参数）。使用 sourceRegex 的书源无法被验证。
3. **POST**: `WebView.loadUrl()` 只支持 GET。阅读对 POST 的处理是先 OkHttp POST，再把响应 HTML 通过 `loadDataWithBaseURL` 加载到 WebView。Probe 已实现此路径（`html` 字段非空时走 `loadDataWithBaseURL`）。
4. **Cookie**: 阅读把 cookie 存入 Room DB 做持久化，按 eTLD+1 归一子域。validator CookieStore 同样用 eTLD+1 归一（okhttp PublicSuffixDatabase）。Probe 的 WebView cookie 落在渲染域名——移动 UA 登录可能被站点重定向到 wap 子域，cookie 落 wap，但 eTLD+1 归一让 validator CookieStore 跨子域共享。书源 header 的 UA 决定 Probe 是否被重定向。
5. **SSL**: 阅读所有 WebViewClient 都 `handler.proceed()` 忽略 SSL 错误。Probe 同样实现。
6. **UA**: 阅读默认 UA 是 `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/{version}`。Probe 从 source.headerMap 传入，保持一致。书源 header UA 必须完整（含引擎名+版本号），截断的 UA 会被反爬识别。
7. **TLS 指纹**: 部分站点（如刺猬猫）通过 TLS 握手特征（JA3）区分真实客户端和自动化工具。PC JVM 的 JSSE TLS 指纹与 Android BoringSSL 不同，会被识别为爬虫。validator 改用 curl（OpenSSL）发 HTTP 请求，TLS 指纹与 curl/浏览器一致，绕过此检测。阅读 App 在 Android 上运行，TLS 指纹天然匹配。

## 源码参考路径

| 文件 | 用途 |
|------|------|
| `external/legado-2024/.../help/http/BackstageWebView.kt` | 后台 WebView（书源内容抓取） |
| `external/legado-2024/.../ui/browser/WebViewActivity.kt` | 用户可见浏览器 |
| `external/legado-2024/.../ui/login/WebViewLoginFragment.kt` | 登录 WebView |
| `external/legado-2024/.../model/analyzeRule/AnalyzeUrl.kt` | WebView 调度入口 |
| `external/legado-2024/.../data/entities/BookSource.kt` | 书源模型 |
| `external/legado-2024/.../data/entities/rule/ContentRule.kt` | webJs 字段 |
