# 网站分析工作流

固定按 `搜索 -> 详情 -> 目录 -> 正文` 顺序输出，禁止跳步。

## 双样本要求

- 搜索至少验证两个关键词，或两本样书。
- 正文至少验证两个章节。
- 若两个样本给出的结构冲突，先解释差异，再决定是否继续生成。

## 输出模板

```md
# 网站分析

## 搜索

- 页面入口或触发方式:
- 请求链路或接口来源:
- 稳定抓取依据:
- 风险点:
- Legado 规则建议:

## 详情

- 页面入口或触发方式:
- 请求链路或接口来源:
- 稳定抓取依据:
- 风险点:
- Legado 规则建议:

## 目录

- 页面入口或触发方式:
- 请求链路或接口来源:
- 稳定抓取依据:
- 风险点:
- Legado 规则建议:

## 正文

- 页面入口或触发方式:
- 请求链路或接口来源:
- 稳定抓取依据:
- 风险点:
- Legado 规则建议:
```

## 判断原则

- 先匿名初探：只判断站点结构、接口路径、是否有反爬、是否需要 WebView。
- **SPA/CSR 页面每次交互后等 2-3 秒再取快照**。Vue/React/Nuxt 页面需要 JS 执行后才能看到内容。页面跳转后立即 snapshot 拿到的是加载态/空白页，不是目标内容。
- 如果 snapshot 显示登录页/空白页/骨架屏，等待后重新 snapshot。不要直接判断"站点不可访问"。
- 模型负责解释页面结构、接口字段语义和 Legado 规则映射。
- Browser MCP 负责验证观察到的入口、请求和渲染结果。
- 若模型推断与实测冲突，以实测为事实基线，并在分析文档中写明修正原因。
- 正文链路必须分开记录"直接请求能否拿到正文"和"浏览器最终是否已经渲染出稳定正文"，两者不是一回事。
- **判断 SSR vs CSR 的方法**：Browser MCP 默认执行 JS，看到的 DOM 是渲染后的。必须用 `browser_evaluate` 执行 `document.documentElement.outerHTML` 获取的原始 HTML 来判断正文是否在源码里。**浏览器里能看到正文 ≠ SSR。** Nuxt/Vue/React 等框架即使在 CSR 模式下，渲染后的 DOM 也有正文，但 HTTP fetch 拿到的是空壳 `<div id="__nuxt"></div>`。如果原始 HTML 里没有正文文本，即使浏览器渲染后有，也必须标 CSR/WebView。
- **Browser MCP ≠ Android WebView。** Browser MCP 是桌面浏览器，不等价于 Android Legado WebView。不得写"Legado App WebView 可渲染"，只能写"浏览器渲染后有正文；需 App/WebView 复核"。
- 若正文接口带签名、返回密文，或阅读页只有 CSR 空壳，但 Browser MCP 能稳定看到已渲染正文，先进入 `WebView` 判定，不得直接下 `不建议生成` 结论。
- **WebView 不解密。** 正文 API 返回 AES-GCM / 加密 / 签名数据但浏览器能渲染 → 直接标 `webView: true`，从 DOM 提取正文。不要分析加密算法、密钥派生、签名逻辑。WebView 负责执行页面 JS，页面 JS 负责解密——书源不需要知道怎么解的。
- 只有在 WebView 和更低复杂度方案都被明确排除后，才允许把正文链路定性为最终不可做。

## 目录分页检测

当 TOC API 返回分页数据时，必须生成 `nextTocUrl` 规则，否则只能拿到第一页（通常 1-20 章）。检测方法：

1. **检查 JSON 响应中的分页字段**：`total_pages`、`hasNext`、`next`、`cursor`、`last_page_url` 等
2. **检查 HTML 响应中的分页元素**：`class="pagination"`、`下一页` 链接、`rel="next"`、`<a>»</a>` 等
3. **两种翻页模式**（由 `nextTocUrl` 规则返回决定）：
   - **顺序翻页**（返回 1 个 URL）：validator 顺序抓取下一页直到 URL 重复
   - **并发翻页**（返回 URL 列表）：validator 并发抓取所有页
4. **如果 API 一次性返回全部章节**（如 `total_pages: 1` 或无分页字段），不需要 `nextTocUrl`
5. **如果目录只有 1-3 章但站点有几百章**，几乎肯定是遗漏了分页规则

## 登录态与 Cookie 注入

对于需要 `enabledCookieJar` 的站点，书源的 `header` 字段常用 `<js>` 块动态生成 Authorization：

```json
"header": "<js>\nvar cookie = java.getCookie('https://example.com');\nvar token = '';\nif (cookie) {\n  var match = cookie.match(/token=([^;]+)/);\n  if (match) token = match[1];\n}\nJSON.stringify({\n  'Authorization': token ? 'Bearer ' + token : ''\n});\n</js>"
```

**关键依赖**：`java.getCookie()` 从 CookieStore 读取。validator v0.4.1+ 支持 CookieStore 持久化（JSON 文件）。验证前需要通过以下方式之一注入 cookie：

1. **Browser MCP 提取**：用户在桌面浏览器登录 → AI 通过 `browser_network_requests` 提取 Cookie/Authorization header → 注入 validator（`--cookie=` 参数或 API `/api/cookie/set`）
2. **App 登录后同步**：用户在 Legado App 内通过 `loginUrl` 登录 → Legado 将 cookie 存入 Room DB → （未来）validator 可从 App 导出导入

**注意**：
- Cookie 是 HttpOnly 时，`document.cookie` 在 WebView 中不可读，但 `java.getCookie()` 通过 CookieStore 仍能获取
- JWT token 有有效期，验证前确认 token 未过期

## 交付自检

生成 book-source.json 后，交付前运行：

```bash
# 结构验证
node scripts/audit-source.mjs outputs/<site-slug>/book-source.json

# 全链路验证（需要 validator 运行中）
node scripts/validate-with-validator.mjs outputs/<site-slug>/book-source.json <关键词> auto --output runs/<site-slug>/
```

**自检清单**：
- [ ] `book-source.json` 顶层为 JSON 数组 `[{...}]`（就算只有一个书源）
- [ ] 无空字符串 `""` 的可选字段
- [ ] `ruleToc.chapterUrl` 不为空
- [ ] `ruleContent.webJs` 有内容（CSR 站点）
- [ ] `enabledCookieJar: true`（需要登录态的站点）
- [ ] audit 脚本通过（无占位字段、JS 语法无错）

## 规则优先级

1. 稳定 API 或 JSON 响应
2. 稳定 HTML 结构
3. 已实测可行的 `WebView`
4. 必要时的少量 JS 补偿

如果只能依赖脆弱 DOM、一次性 token、短期签名或不稳定异步链路，必须把结果标记为高风险。

## 正文额外检查

- 若阅读页原始 HTML 没有正文，必须补一条 Browser MCP 侧的渲染证据，确认正文是否在页面完成加载后稳定出现。
- **Browser MCP ≠ Android WebView。** 只能写"桌面浏览器渲染后 article 内有正文"，不得写"Legado App WebView 可渲染"。Android Legado WebView 仍需 App 复核。
- 若浏览器里已经能看到稳定正文，优先评估 WebView 方案，再决定是否需要更重的 JS 或解密方案。参考 `examples/pattern-api-webview-auth/` 的 WebView + webJs 写法。
- 若准备给出 `不建议生成`，分析里必须明确写出：为什么 `WebView` 不适用，为什么更简单的直接提取也不适用。
