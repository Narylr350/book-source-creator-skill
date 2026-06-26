# 故障诊断

## 诊断流程

validator 返回失败后，按以下顺序检查：

### 1. 检查 HTTP 层

看 `steps[].request` 和 `steps[].response`：
- URL 是否正确（有没有 scheme、有没有拼接）
- method 是否正确（GET/POST）
- response.code 是否 200
- bodyPreview 是否正常（不是 Cloudflare/验证码页面）

### 2. 检查规则命中

看 `steps[].ruleHits`：
- 哪些字段 success=false
- 对应的 rule 是什么
- 实际 value 是什么（可能是空、可能是错误值）

### 3. 检查错误信息

看 `steps[].error`：
- 异常类型（SelectorParseException、PathNotFoundException 等）
- 错误消息（URL 相关、编码相关、规则相关）

## 常见故障模式

### URL 相关

**症状**: `Expected URL scheme 'http' or 'https' but no scheme was found`

**原因**: searchUrl 或 bookUrl 是相对路径，未拼接 baseUrl

**修复**: 在 searchUrl 前补全 `https://域名`，或检查 bookSourceUrl 是否正确

### CSS 选择器错误

**症状**: `SelectorParseException: Could not parse query 'xxx'`

**原因**: CSS 选择器语法错误，或混入了非 CSS 语法（如 `@href`）

**修复**: 检查选择器语法，`@attr` 要用 `selector@attr` 格式

### JSONPath 错误

**症状**: `PathNotFoundException` / `InvalidPathException`

**原因**: JSONPath 表达式错误，或返回的不是 JSON

**修复**: 检查返回的 bodyPreview 是否是 JSON，修正 JSONPath 表达式

### 编码问题

**症状**: bodyPreview 乱码 / error 含 "charset"

**原因**: 站点用 GBK 或其他编码，未正确处理

**修复**: 在 header 中指定 `Accept-Charset` 或在规则中处理编码

### POST 请求问题

**症状**: 搜索失败但站点正常

**原因**: searchUrl 含 `;post=` 但 validator 不支持 POST 浏览器模式

**修复**: 确认是否需要 POST；如果是 validator/Android 能力边界，记录到 `validator-report.json` 并交给 `record-validation` 收敛，不手工改写状态。

### 反爬触发与 IP 风控

`[blackbox]` 站点把搜索/登录类端点放在反爬墙后是普遍现象（实测过的站：搜索 API 单次直接访问即 303 跳到人机验证页；同类还有 Cloudflare turnstile、各站自研 captcha）。

`[source]` validator 把这类响应识别为 `CAPTCHA_DETECTED`（见 `containsAppReviewChallenge`，匹配 `cloudflare turnstile` / `Just a moment` / 验证页 finalUrl）。`record-validation` 命中此 errorCode 会收敛为 `blocked:captcha` + `warningBy: "captcha"`，并在响应里返回 `forbiddenActions`。

`[source]` server-side 检测对客户端无差别——curl / validator (curl) / Probe Android WebView / 浏览器 MCP **都会被弹同一个 verify 页**（已实测）。换 mode、换关键词、换 UA 都不绕过。

`[blackbox]` 反复访问反爬端点累积到阈值会触发**站点 IP 级风控**——之后连"已经在用的浏览器"也开始弹验证。一旦到这一步，本次会话基本无解，要等冷却或换 IP。

`[action]` 命中 captcha 时：

1. **禁止** 自动重跑 validator、换 mode 重试、换 keyword 重试、跑 `android --run` 期望"绕过"。
2. 让用户在浏览器或 Probe 里手动访问主页并过一次人机验证，让 session cookie 持续。
3. 让用户从主页正常导航到目标链路（例如点击搜索框输入关键词，而非直接访问搜索 API 端点），让 cookie 落到 CookieStore。
4. session 桥接好后再用 validator 一次性走完链路；搜索仍被阻塞时用 `validate --book-url <url>` 跳过搜索验证后续链路；如果仍未过验证，按 `failed` 交付。

`[heuristic]` 一些站点把人机验证放在 session cookie 缺失时，过一次后 session 持续；另一些站点（如 Cloudflare 完整模式）每次新 IP 都要过。前者用 1 一步 session 桥接即可，后者只能告诉用户"此站点不适合本机自动化验证"。

### 之前文档误判：浏览器 MCP `evaluate` 触发反爬

实测推翻：浏览器 MCP 用 Playwright，已做 `navigator.webdriver=false` 反检测；`evaluate` 提取 DOM、跑大量选择器都不会触发 verify。**真正的触发源是 `navigate` 反爬端点本身**——浏览器和 curl/Probe 表现完全一致（已实测）。

`[action]` probe 阶段拿站点信息时，先 `navigate` 主页、不要把搜索/登录类反爬端点作为首个 navigate 目标。需要看搜索响应时用 `mcp__fetch__fetch` 取原始 HTML 离线解析，或在浏览器内**用户手动**操作搜索流程（用户过验证）。

### 登录态怎么解除反爬：跨子域 cookie 与 eTLD+1 归一

`[source]` 阅读 App 的登录是 **WebView 登录**（`WebViewLoginFragment`）：用户在 App 内 WebView 里登录书源 → `CookieStore.setCookie(source.getKey(), cookie)`，而 `getKey()=bookSourceUrl`，`CookieStore` 内部按 `NetworkUtils.getSubDomain`（eTLD+1）归一存储。请求时 `AnalyzeUrl` 也按归一域取 cookie。**结果：一次登录的 cookie 按 `eTLD+1`（如 `example.com`）存，全站 www/wap/m 子域请求共享同一份。** 没有"原生 App 导出 cookie 注入"这种机制——就是 WebView 登录 + 归一。

`[source]` validator 复刻了这个：`CookieStore` 按 eTLD+1 归一（`PublicSuffixDatabase.getEffectiveTldPlusOne`）。所以 Probe 登录拿到的 cookie（即使落在 wap 子域）注入 validator 后，www 链路也能取到。

`[blackbox 案例]` 实测确认过的登录链路差异（同一站不同工具/UA 结论相反，别只凭一种工具下结论）：

- **桌面 UA 登录**（浏览器 / 真机阅读 App WebView）→ 登录态 cookie 落顶级域 apex，所有子域可见 → 带 cookie 的 validator search 直接通过。
- **移动 UA 登录**（Probe Android WebView 裸 `/render`）→ 可能被站点重定向到 `wap` 子域，登录态落 wap；裸 `/render` 的 WebView cookie 按完整域隔离、不走归一 → 主站 search 仍验证码。
- **关键**：能用的社区书源常见配置是 `bookSourceUrl=www`、`loginUrl=www/...login`、`enabledCookieJar=false`、正文用直 CSS（无 webView/webJs）。登录靠阅读 App 全局 CookieManager + 归一，不靠书源显式 cookieJar。
- **可能更深一层**：有的站 web 登录页本身就 503（Geo/IP 封锁），真正登录通道是原生 App 私有 API（设备指纹 + 验证码）。这种 Probe WebView 登录不一定可达；最可靠是用户在能开登录页的环境（带代理的桌面浏览器、或真机阅读 App）登录后，cookie 经归一注入 validator。

`[action]` 反爬被登录墙挡住时：① 让用户登录（登录可能解除，值得一试，但不保证）；② 登录后 cookie 经 Probe 桥接（`resolveValidateCookieFile`）或 `cookies.json` 注入 validator，validator 归一后跨子域生效；③ 登录仍不解除 → 真站点限制，按 `failed` 收敛。用 `validate --book-url <url>` 跳过搜索验证后续链路。**不要断言"登录一定有效/无效"——取决于登录通道、落点域、网络环境，必须实测。**

### TOC chapterCount=1

**症状**: validator HTTP mode 下 search/detail 正常，toc success 但 `chapterCount` 为 1（站点实际有几百章）

**原因**: `ruleBookInfo.tocUrl` 指向错误的 API endpoint。常见于手写或 AI 生成的 tocUrl 使用了不存在的路径（如某 API 站点用了 `/api/chapter/list.php?novel_id={$.id}` 而非实际路径 `/api/novels/{{$.id}}/chapters`）。

**诊断**: 在 Browser MCP 中直接访问 TOC API，确认返回数据结构。检查 `tocUrl` 中的 `{{ }}` 变量替换是否正确。

**修复**: 修正 `ruleBookInfo.tocUrl` 为正确的 API 路径。用 `{{$.id}}` 引用 detail 响应中的 `id` 字段。

### chapterName 显示 "undefined"

**症状**: TOC success 但章节名显示 "第undefined章 undefined"

**原因**: chapterName 使用 JS 模板（如 `<js>'第' + String(result.chapterNumber) + '章 ' + result.title</js>`），但 validator Rhino 引擎中 `result` 为字符串（未解析的 JSON 文本），`result.chapterNumber` 无法通过点号访问字段。

**修复**: 改用 JSONPath（如 `$.title`）替代 JS 模板。JSONPath 在 chapterName 上下文中能正确提取当前元素字段。

### 导入报错 — Expected BEGIN_ARRAY but was BEGIN_OBJECT

**症状**: Legado App 导入书源时报 `Expected BEGIN_ARRAY but was BEGIN_OBJECT`

**原因**: `book-source.json` 顶层是单个对象 `{...}` 而非数组 `[{...}]`。Legado 要求顶层为 JSON 数组。

**修复**: 用 `[{...}]` 包裹书源对象。交付前运行 `node scripts/audit-source.mjs <file>` 验证 JSON 结构。

## 证据收集

每次诊断必须记录：
1. 失败阶段（search/detail/toc/content）
2. HTTP 请求/响应（URL、method、code、body 预览）
3. 规则命中详情（哪些字段失败、用的什么规则）
4. 错误信息（异常类型、消息）
5. 回修动作（改了什么、为什么）
