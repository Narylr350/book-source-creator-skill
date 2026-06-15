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

## 证据收集

每次诊断必须记录：
1. 失败阶段（search/detail/toc/content）
2. HTTP 请求/响应（URL、method、code、body 预览）
3. 规则命中详情（哪些字段失败、用的什么规则）
4. 错误信息（异常类型、消息）
5. 回修动作（改了什么、为什么）
