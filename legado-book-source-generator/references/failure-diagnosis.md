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

**修复**: 确认是否需要 POST，如果是则标记 `needs_app_review`

### Cloudflare 拦截

**症状**: bodyPreview 含 "Cloudflare" / "Turnstile" / "challenge"

**原因**: 站点有 Cloudflare 反爬

**修复**: 停止自动修，标记 `needs_app_review`

### CSR 正文 — WebView 返回空（4 字符 HTML）

**症状**: Android mode content 返回 `webViewHtmlPreview: "null"`（4 chars），HTTP mode 正常（search/detail/toc success）

**原因**: `JsExtensions.getCookie()` 遗留硬编码返回 `""`，导致 header JS（如 `java.getCookie('https://novalpie.cc')`）无法从 CookieStore 读取 JWT/认证信息。Authorization header 始终为空，WebView 加载 CSR 页面时 Nuxt/Next.js 的 API 调用无认证 → 页面不渲染 → evaluateJavascript 返回 null。

**诊断**: 检查 `validator/src/main/kotlin/io/legado/validator/help/JsExtensions.kt:268-270`，确认 `getCookie()` 是否已改为读取 `CookieStore`（v0.4.1 后已修复）。

**修复**: 无需用户操作（已修）。如果发现类似问题，检查 header JS 是否依赖 `java.getCookie()`，确认 CookieStore 中是否有对应域名的 cookie。

### chapterUrl 中 webView options 导致的 probe URL 污染

**症状**: Android mode 下 content `webViewHtmlPreview` 只有 4 chars（与上条同症状），但 HTTP mode 正常。debug step 显示 `request.url` 末尾带有 `,%7B%22webView%22%3Atrue%7D` 或 `,{"webView":true}`。

**原因**: JsonPath 模板（如 `/book/{{$.novelId}}/{{$.id}},{"webView":true}`）中，`{{ }}` 替换后 `,{"webView":true}` 保留在 URL 中。Legado 的 `AnalyzeUrl` 会解析 URL options 并剥离，但 probe 直接使用 `chapter.url` 作为请求 URL，导致 probe 收到的 URL 包含 JSON 垃圾后缀。

**修复**: `DebugService.runContentAndroid` 现在自动用 regex 清洗 URL（v0.4.1+）。如果用旧版 validator，手动去掉 chapterUrl 中的 `,{"webView":true}` 后缀，改用 JS 模板（`{{ }}` 块）把 options 放在块外。

### TOC chapterCount=1

**症状**: validator HTTP mode 下 search/detail 正常，toc success 但 `chapterCount` 为 1（站点实际有几百章）

**原因**: `ruleBookInfo.tocUrl` 指向错误的 API endpoint。常见于手写或 AI 生成的 tocUrl 使用了不存在的路径（如旧版 novalpie 用了 `/api/chapter/list.php?novel_id={$.id}` 而非 `/api/novels/{{$.id}}/chapters`）。

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
