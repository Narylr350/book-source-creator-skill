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

### Cloudflare 拦截

**症状**: bodyPreview 含 "Cloudflare" / "Turnstile" / "challenge"

**原因**: 站点有 Cloudflare 反爬

**修复**: 停止自动修，记录 blocker；有 Android 真机或模拟器时优先复核，没有时等待用户确认降级。

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
