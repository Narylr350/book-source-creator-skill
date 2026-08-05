# 教训：API + WebView 正文 + 登录态站点

来源：实测记录（Android Probe + App 真机验证）

## 必须做

- **WebView 必须写在 chapterUrl 上**。Legado 只看 chapterUrl 的 webView 选项。`ruleContent` 设了 webView 但 chapterUrl 没写 = 无效。正确写法：`/book/{{$.id}},{"webView":true}` 或 `href##$##,{"webView":true}`。
- **webJs 必须有轮询等待**。CSR 页面 DOM 在 JS 执行后才出现。不用 `java.sleep()` 或 `while` 循环的 webJs 会拿空内容。
- **正文是 SSR 时就别用 webJs**。如果 HTML 里已经有正文（如 `#J_BookRead .chapter@textNodes`），直接用 CSS 选择器。webJs 在验证码页面空转会超时。
- **登录态标准三件套**：`enabledCookieJar: true` + `loginUrl` + `<js>java.getCookie()</js>` 动态 header。header 不写死 Cookie。
- **isVip 检测**：`@js:result.outerHtml().includes('icon-lock')`。防止用户点到付费章报错。
- **JSON API 不需要 WebView**。搜索/详情/目录走 JSON API 的，不要在这些 URL 上加 webView——只加在 chapterUrl 上。
- **用 Android Probe 原生登录**。桌面 Cookie 注入到手机 WebView 会被反爬识破。用 Probe 的 `/login` 端点在手机上原生登录，CookieManager 自动共享——环境一致不掉验证。

## 不要做

- **WebView 不解密**。正文 API 返回 AES-GCM 密文，页面 JS 自行解密后渲染到 DOM。书源只负责从 DOM 提取，不负责解密。不要分析加密算法。
- **三层反爬是叠加的**：Cloudflare → 百度/360 验证 → Geetest 滑块。前两层 Cookie 能过，滑块必须人手。按 validator / record-validation 证据收敛为 failed、degraded 或需 App 实测，不手工标 `passed`。
- **不要反复观察同一反爬入口**。Browser MCP 连续导航可能累积触发风控。首次取得页面和网络证据后复用已记录事实；登录 Cookie 按既定流程持久化。

## 登录优先级

有 Android 设备 → Probe 原生登录 (`/login`)。无设备 → Browser MCP 登录 + Cookie 提取。前者环境一致不掉验证，后者可能被反爬识破。
