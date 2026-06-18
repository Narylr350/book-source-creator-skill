# 黑盒实测经验总结

以下教训来自 5 个不同类型站点的真实生成和验证，每个问题都曾导致书源失败。

## 静态 HTML 站点

**类型**：biquca.com、xbiquge.com

**教训**：

- `--fast` 必须先探站再决定。AI 上来就加 `--fast` 是常见错误——站点可能有重定向、Cloudflare 或 JS 渲染，没探就加等于盲飞。
- 站点域名重定向（如 xbiquge.com → xbiquge.com.cn）要在 assessment 里告知用户，不能静默切换。
- 目录分页（`nextTocUrl`）和正文分页（`nextContentUrl`）经常同时出现，不要漏掉任何一个。
- `:has()` 和 `:contains()` 是 jQuery 选择器，Legado 的 Jsoup 不支持——会被结构检查拦截。替代方案：`:has()` 换 parent 选择器，`:contains()` 换 `@text` action + `<js>` 过滤。

## POST 搜索站点

**类型**：69shuba.com

**教训**：

- POST 搜索的正确语法是 `url,{"body":"key={{key}}","method":"POST"}`，不是 `url;post=key={{key}}`。
- **Cloudflare Turnstile 是硬边界**。WebView 不能绕过验证码——AI 经常误以为加 `webView:true` 就能过 Cloudflare，实际是两回事。
- 浏览器 MCP 里能看到的页面不代表 validator HTTP 能拿到——Browser MCP 用真实 Chrome，validator 用 Java HTTP 客户端，反爬规则不同。
- 参考样例 `pattern-post-detail-toc/` 提供了正确的 POST 搜索语法和选择器模式。

## CSR WebView + API 站点

**类型**：novalpie.cc

**教训**：

- **WebView 不解密**。正文 API 返回 AES-GCM 密文，但页面 JS 自行解密后渲染到 DOM。书源只需要 `webView: true` + `webJs` 从 DOM 提取。不要分析加密算法。
- **WebView 必须写在 chapterUrl 上**。只在 `ruleContent` 设 `webView: true` 不够——Legado 只看 chapterUrl 上的 webView 选项。正确写法：`/book/{{$.id}},{"webView":true}` 或 `href##$##,{"webView":true}`。
- **webJs 必须有轮询等待**。CSR 页面的 DOM 在 JS 执行后才出现。不用 `java.sleep()` 或 `while` 循环的 webJs 会拿空内容。参考样例 `pattern-api-webview-auth/`。
- **桌面 Cookie ≠ 手机 Cookie**。从桌面 Browser MCP 提取的 Cookie 注入到 Android Probe，反爬能看出环境不一致。用 Android Probe 的 `/login` 端点在手机上原生登录，CookieManager 自动共享——保持环境一致。
- **JSON API 不需要 WebView**。搜索/详情/目录走 JSON API 的，不要在 searchUrl/tocUrl 上加 webView——WebView 只用于章节正文。

## 登录 + 验证码站点

**类型**：ciweimao.com

**教训**：

- **正文是 SSR 就别用 webJs 轮询**。webJs 在验证码页面空转导致超时。如果页面 HTML 里已经有正文（如 `#J_BookRead .chapter@textNodes`），直接用 CSS 选择器提取。
- **三层反爬**：Cloudflare → 百度/360 验证 meta → Geetest 滑块。前两层 Cookie 能过，Geetest 必须人手操作。
- **enabledCookieJar + loginUrl + java.getCookie()** 是登录态标准三件套。header 用 `<js>java.getCookie()</js>` 动态注入，不写死。
- **isVip 检测**：`@js:result.outerHtml().includes('icon-lock')` 区分免费章和付费章，防止用户点到 VIP 章报错。
- **验证码是硬边界**。书源能生成、规则正确，但用户必须在 App 里手动过一次验证码。状态标 `needs_app_review`，不标 `passed`。
- Android Probe 原生登录模式（`/login` 端点）是验证登录态书源的唯一可靠方式——手机上直接开 WebView 登录，CookieManager 共享给后续渲染。

## 通用教训

1. **评估摘要必须展示给用户**。写完 assessment.md 后 3-6 行摘要告知用户：评级、风险标签、4 条链路状态、关键阻塞点。
2. **run-state.json 不可手动编辑**。签名验证会拒绝所有手动修改。所有状态变更必须走 bsg.mjs 命令。
3. **不要用 `auto` 模式**。已从源码移除。验证时直接指定 `http` 或 `android`。
4. **Ai 会尝试绕过脚本**。签名、拦截、硬阻断三重防护——签名防篡改，结构检查防错误配置，record-validation 防跳过验证。
5. **同一个站点不要反复跑**。多次 probe + Browser MCP 访问会触发风控封 IP。Cookie 持久化，首次探站后后续迭代直接注入 Cookie。
