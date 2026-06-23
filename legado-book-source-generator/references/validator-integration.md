# Validator 集成

## 概述

Validator 是本地书源预验证工具，运行在 `http://localhost:1111`。Skill 生成书源后，先跑 validator 验证，再决定交付或回修。生命周期管理由 `bsg.mjs validator-start/stop` 统一处理。

## 内置运行包

本 skill 自带 validator 前后端运行包：

```text
validator/
  app/legado-source-validator.jar
  examples/
```

启动: `node "<skill-dir>/scripts/bsg.mjs" validator-start`。停止: `node "<skill-dir>/scripts/bsg.mjs" validator-stop`。

启动后打开 `http://localhost:1111` 可使用浏览器调试台。

## API 接口

### POST /api/debug/run

单次验证：传入书源 JSON + 关键词，返回完整步骤详情。

```json
{
  "sourceJson": "[{\"bookSourceUrl\":\"https://example.com\",\"bookSourceName\":\"example\"}]",
  "sourceUrl": "https://example.com",
  "keyword": "关键词",
  "mode": "http",
  "debugDir": "runs/<slug>/debug"
}
```

参数：
- `sourceJson`：书源 JSON 字符串（数组或单对象均可）
- `sourceUrl`：书源的 bookSourceUrl
- `keyword`：搜索关键词
- `mode`：`http` | `browser` | `android`
- `debugDir`（可选）：调试产物输出目录。必须已存在，validator 只写入该目录内部。产物文件名固定格式：`<phase>[-<index>]-<kind>`。失败时记入 `evidence.artifactWriteError`。

返回结构见 `validator-report.json`（包含 phases、steps、errorCode、evidence、debugArtifacts）。

如果手工调用 API，不要把 `sourceJson` 写成 `"<书源JSON>"` 占位字符串。PowerShell 下用下面的方式从真实文件构造请求体：

```powershell
$sourceJson = Get-Content -Raw "outputs/<slug>/book-source.json"
$body = @{
  sourceJson = $sourceJson
  sourceUrl = "https://example.com"
  keyword = "关键词"
  mode = "http"
  debugDir = "runs/<slug>/debug"
} | ConvertTo-Json -Depth 8
curl.exe -s -X POST http://localhost:1111/api/debug/run -H "Content-Type: application/json" --data-binary $body
```

`debugDir` 必须预先存在；不存在时 validator 会忽略该目录，不会写调试产物。

## validator-report.json 结构速查

`bsg.mjs validate` 会把 validator 返回结果写到 `runs/<slug>/validator-report.json`。关键字段：

| 字段 | 说明 | 用法 |
|------|------|------|
| `_generatedBy` | 必须是 `validate-with-validator.mjs` | `record-validation` 用它拒绝手写 report |
| `_schemaVersion` | 当前为 `1.0` | 版本不匹配时重跑 validator |
| `_runDir` | report 所属 run 目录 | 防止复用其它 run 的报告 |
| `_sourceHash` | 生成报告时的 `book-source.json` hash | 修改书源会让旧报告失效 |
| `status` | validator 基础状态 | `record-validation --status` 必须与它一致 |
| `mode` | `http` / `browser` / `android` | Android 是交付事实来源，PC 只是辅助 |
| `reason` | 总体失败原因 | 给人读，不替代 errorCode |
| `summary` | 搜索数量、章节数、正文预览等摘要 | 用于质量门槛 |
| `phases` | 四链路阶段结果 | 快速看 search/detail/toc/content |
| `steps` | 每一步请求、响应、命中和抽取细节 | 修规则必须看这里 |

`steps[*]` 常用字段：

| 字段 | 说明 |
|------|------|
| `phase` | `search` / `detail` / `toc` / `content` |
| `status` | `success` / `error` / `blocked` |
| `mode` | 该 step 实际使用的验证模式 |
| `request.url` / `request.headers` | 实际请求 URL 和头 |
| `response.bodyPreview` | HTTP 原始响应预览 |
| `response.rendered` | 浏览器/WebView 渲染结果摘要 |
| `ruleHits` | 规则命中详情 |
| `extracted` | validator 实际抽取出的字段 |
| `preview` / `evidence.contentPreview` | 正文预览 |
| `errorCode` / `failedField` | 结构化错误和对应规则字段 |
| `androidProbeUsed` / `androidBackend` | Android/Probe 是否真的参与 |
| `webViewHtmlPreview` / `webViewScreenshotBase64` | Android WebView 渲染证据 |
| `debugArtifacts` | `request.json`、HTML、截图、抽取结果等文件路径 |

不要只看 `status`。修规则时至少看：失败 step 的 `phase`、`errorCode`、`failedField`、`request.url`、`response.bodyPreview`、`ruleHits`、`extracted`。

## 调试产物

当 `debugDir` 提供时，每个验证阶段保存以下文件：

| Kind | 说明 |
|------|------|
| `request.json` | 请求信息（URL、headers、body） |
| `response.raw.html` | HTTP 原始响应源码 |
| `response.rendered.html` | WebView/浏览器渲染后的 DOM |
| `rule-hits.json` | 规则命中详情 |
| `extracted.json` / `extracted.txt` | 提取结果 |
| `screenshot.png` | WebView 截图（仅 WebView 阶段） |

report 中 `debugArtifacts` 使用相对路径引用这些文件。

### 如何读 debug 产物

- `request.json`：确认 URL、method、body、headers 是否符合站点实际请求。
- `response.raw.html`：确认 HTTP 返回的是正文、登录页、验证码、VIP 锁，还是 CSR 空壳。
- `response.rendered.html`：确认 Browser/WebView 渲染后 DOM 是否有正文节点。
- `rule-hits.json`：确认每个 CSS/JSONPath/Regex 是否命中。
- `extracted.json` / `extracted.txt`：确认阅读规则最终拿到的字段，不要只看 DOM。
- `screenshot.png`：只证明页面渲染过，不证明正文规则提取成功。

判断优先级：`extracted` / content preview > `rule-hits` > rendered DOM > raw HTML > screenshot。

## errorCode 参考

Validator 返回结构化错误码（`DebugStep.errorCode`），每个 code 绑定 fix 边界。

### 通用 (1)

| Code | 说明 | phase |
|------|------|-------|
| `HTTP_BLOCKED` | HTTP 层面被拦截（403/Cloudflare/Turnstile） | 任意 |

### 搜索 (4)

| Code | 说明 | failedField |
|------|------|-------------|
| `SEARCH_EMPTY` | 搜索返回空结果 | searchUrl |
| `SEARCH_SELECTOR_EMPTY` | ruleSearch.bookList 匹配 0 节点 | ruleSearch.bookList |
| `BOOK_URL_EMPTY` | 搜索结果存在但 bookUrl 为空 | ruleSearch.bookUrl |
| `BOOK_URL_MALFORMED` | bookUrl 不是有效详情页 URL | ruleSearch.bookUrl |

### 详情 (2)

| Code | 说明 | failedField |
|------|------|-------------|
| `DETAIL_SELECTOR_EMPTY` | 详情规则未匹配 | ruleBookInfo |
| `DETAIL_TOC_URL_EMPTY` | 未提取目录 URL | ruleBookInfo.tocUrl |

### 目录 (2)

| Code | 说明 | failedField |
|------|------|-------------|
| `TOC_EMPTY` | 容器匹配但章节数为 0 | ruleToc.chapterList |
| `TOC_SELECTOR_EMPTY` | chapterList 完全没匹配 | ruleToc.chapterList |

### 章节 URL (3)

| Code | 说明 | failedField |
|------|------|-------------|
| `CHAPTER_URL_EMPTY` | chapterUrl 为空 | ruleToc.chapterUrl |
| `CHAPTER_URL_MALFORMED` | chapterUrl 格式错误 | ruleToc.chapterUrl |
| `CHAPTER_URL_MISSING_WEBVIEW` | CSR 站点缺 webView:true | ruleToc.chapterUrl |

### Android Probe (1)

| Code | 说明 |
|------|------|
| `ANDROID_PROBE_UNAVAILABLE` | 设备未连接或 Probe 未启动 |

### 正文获取/选择器 (4)

| Code | 说明 | failedField |
|------|------|-------------|
| `CONTENT_SELECTOR_EMPTY` | HTML 正常但 content 空 | ruleContent.content |
| `CONTENT_TOO_SHORT` | 内容 < 100 字符 | ruleContent.content |
| `CONTENT_DUPLICATE_BETWEEN_CHAPTERS` | 两章完全相同 | ruleContent.content |
| `CONTENT_CHAPTER_MISMATCH` | 内容不包含章节标题（quality warning） | — |

### 正文页面分类 (4)

| Code | 说明 | 处置 |
|------|------|------|
| `CONTENT_IS_LOGIN_PAGE` | 正文页是登录页 | BLOCKED，需登录 |
| `CONTENT_IS_CAPTCHA_PAGE` | 正文页是验证码页 | BLOCKED，不可自动绕过 |
| `CONTENT_IS_VIP_LOCK_PAGE` | 正文页提示 VIP/付费 | BLOCKED，需付费账号 |
| `CONTENT_IS_CSR_SHELL` | 正文页是前端空壳 | FIXABLE，需 WebView |

### WebView/WebJs (3)

| Code | 说明 | failedField |
|------|------|-------------|
| `WEBVIEW_RENDER_TIMEOUT` | WebView 渲染超时 | respondTime |
| `WEBJS_EXEC_ERROR` | webJs 执行异常 | ruleContent.webJs |
| `WEBJS_RETURN_EMPTY` | webJs 返回空 | ruleContent.webJs |

### 登录态 (2)

| Code | 说明 | 协作 |
|------|------|------|
| `COOKIE_REQUIRED` | 需 Cookie 但未注入 | validator 基础判断 + bsg 上下文 |
| `COOKIE_PRESENT_BUT_UNAUTHORIZED` | Cookie 存在但 401/403 | validator 判断 |

### 兜底 (1)

| Code | 说明 |
|------|------|
| `APP_REVIEW_REQUIRED` | validator 无法分类，需 App 实测 |

## 状态判定

| 状态 | 含义 | Skill 动作 |
|------|------|-----------|
| `passed` | Android mode 全链路 success + 无登录态特征 | 交付书源 |
| `anonymous_candidate` | 匿名全链路 success，但站点有 loginUrl/enabledCookieJar/Authorization | 不能标可用，需登录态复核 |
| `failed` | 某阶段 error，有可修证据（含 errorCode） | AI 根据 allowedFixes 自动回修 |
| `needs_app_review` | needsAppReview=true 或命中 App-only 行为 | 停止自动修，标记需复核 |
| `validator_limitation` | validator 不支持的规则能力 | validator 无法验证该能力 |
| `failed_unresolved` | 同一错误签名连续 5 次未修复 | 收敛失败，需人工检查 |

## BSG 记录门禁

validator 只负责产生事实报告，最终进入交付前必须让 BSG 记录：

```bash
node "<skill-dir>/scripts/bsg.mjs" validate --run runs/<slug> [--mode android]
node "<skill-dir>/scripts/bsg.mjs" record-validation --run runs/<slug> --status <status>
```

`bsg.mjs validate` 自动读取 book-source.json、分析关键词、检测 adb 设备决定 mode，并把结果写入 run 目录的 `validator-report.json`。

PC HTTP / Browser 报告即使是 `passed`，也只算开发辅助。`record-validation` 会返回 `blockedBy=android_final_authority_not_used` 并要求运行 `android --run <run-dir>`；只有用户明确确认没有 Android 真机或模拟器后，才允许降级记录，且不能标 full pass。

`record-validation` 会再次读取 `outputs/<slug>/book-source.json`。如果源里有 `webView:true` / `webJs`，或本轮登录态来自 Android Probe，但报告不是 `mode=android`，且 `android-status` 显示设备可用，会返回 `blockedBy=android_probe_not_used`。这种情况必须重跑 android mode，不能交付。

`record-validation` 会把 validator report 归一化为 `runs/<slug>/capability-matrix.json`：

```json
{
  "links": {
    "search": { "status": "success|blocked|unknown", "blocker": null, "render": null, "evidenceIds": [] },
    "detail": { "status": "success|blocked|unknown", "blocker": null, "render": null, "evidenceIds": [] },
    "toc": { "status": "success|blocked|unknown", "blocker": null, "render": null, "evidenceIds": [] },
    "content": { "status": "success|blocked|unknown", "blocker": null, "render": "ssr_or_http|webview", "evidenceIds": [] }
  },
  "overall": { "status": "full_pass|partial_candidate|blocked", "fullPass": false, "blockers": [] }
}
```

最终链路结论以 `capability-matrix.json` 为准，不从 `assessment.md`、`validator-summary.md` 或 AI 摘要里反推。

`mode=android` 不是 Android WebView 正文验证的充分证据。生成源含 `webView:true` / `webJs` 时，报告必须在 content 阶段同时留下两类证据：

1. Android WebView 渲染证据：`webViewHtmlPreview`、`webViewScreenshotBase64`、`debugArtifacts["response.rendered.html"]` 或 `debugArtifacts["screenshot.png"]`。缺失时 `record-validation` 返回 `blockedBy=android_webview_not_used`。
2. WebView 后正文提取证据：Android content step 必须有 `preview`、`evidence.contentPreview`、`evidence.contentLength` 或 `extracted.contentLength`。如果 content 失败 step 没有这些提取证据，`record-validation` 返回 `blockedBy=android_webview_content_not_verified`；如果失败 step 同时带有有效正文证据，则按具体错误码（例如登录/VIP/验证码）处理，不误报为 WebView 未提取正文。

截图或 rendered HTML 只能证明页面打开过，不能证明阅读 App 能按 `ruleContent.content` / `webJs` 提取正文。正文可用性必须以后者为准。

`content` step 非空也不等于干净正文。`record-validation` 会拦截明显污染的 preview，例如重复异常短 token、脚本片段、导航/弹窗 chrome。此类情况必须修 `ruleContent.content` / `webJs` 后重跑 validator。

Probe 登录后的报告必须有登录态证据：非 `anonymous` 的 `sessionMode`，或请求头里有 Cookie/Authorization。否则 `record-validation` 返回 `blockedBy=android_probe_cookie_not_used`，说明只是完成了手机/模拟器登录动作，validator 请求没有使用该登录态。

报告中出现明确规则错误时，不允许把状态写成 `needs_app_review` 或 `validator_limitation`。典型规则错误包括：目录请求变成 `/chapter-list/`、详情阶段提取到的 `tocUrl` 缺少 book id、详情成功但 `coverUrl` / `intro` 为空。先修规则再重跑 validator。

正文页 `CONTENT_IS_LOGIN_PAGE` / `CONTENT_IS_VIP_LOCK_PAGE` / `CONTENT_IS_CAPTCHA_PAGE` 不是普通 selector 修复项：

- 登录页：需要登录态，优先走 Android Probe 登录。
- VIP/付费页：需要已订阅/付费权限的账号；没有账号或权限时只能降级/放弃。
- 验证码页：不能自动绕过，记录 blocker 或走用户/App 复核。

这些边界不能回到 generate 乱改 `book-source.json`，也不能改写成 `validator_limitation`。

`deliver` 没有 `record-validation` 状态会拒绝交付。不要手工伪造 `validator-report.json`、`validator-summary.md` 或 `capability-matrix.json`；`validator-report.json` 只能由 `validate-with-validator.mjs`（被 `bsg.mjs validate` 包装）生成，`validator-summary.md` 和 `capability-matrix.json` 只能由 `record-validation` 生成。`deliver` 同时要求 `rule-check.json` 已通过。

## 判定逻辑（Validator 端）

登录态特征仅包含 loginUrl、enabledCookieJar、Authorization（不包含 webJs——webJs 只说明 render 策略，不说明 auth）。

```
if 全 phases == "success" AND 无登录态特征:
    status = "passed"
elif 全 phases == "success" AND 有登录态特征:
    status = "anonymous_candidate"
elif step.needsAppReview == true:
    status = "needs_app_review"
elif step.errorCode == CONTENT_IS_CAPTCHA_PAGE:
    status = "needs_app_review"
elif step.errorCode == CONTENT_IS_LOGIN_PAGE (且 Cookie 未注入):
    status = "failed"  // bsg 追加 COOKIE_REQUIRED
elif step.errorCode in (CONTENT_SELECTOR_EMPTY, WEBJS_*, CONTENT_TOO_SHORT, ...):
    status = "failed"  // AI 可修
elif step.errorCode == ANDROID_PROBE_UNAVAILABLE:
    status = "validator_limitation"
else:
    status = "failed" 或 "needs_app_review"（保守判定）
```

## bs-validator 协作

- **validator** 输出基础 errorCode + evidence + allowedFixes/forbiddenFixes + debugArtifacts
- **bsg.mjs** 消费 errorCode 做收敛检测（签名: `phase|errorCode|failedField|requestUrlHash`），根据上下文追加限制（如 COOKIE_REQUIRED）
- **AI** 根据 allowedFixes 小范围修书源

收敛签名在正文阶段追加 chapter URL hash，避免不同章节的同一 code 被过度合并。

## evidence 字段参考

每个 errorCode 要求特定的 evidence keys，但第一版不强校验。常见 evidence 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `htmlLength` | int | 响应 HTML 长度 |
| `contentLength` | int | 提取的正文长度 |
| `htmlKind` | string | HTML 分类: normal_reader_html / csr_shell / login_page / captcha_page / vip_lock_page / empty |
| `httpStatus` | int | HTTP 状态码 |
| `blockType` | string | 阻断类型: cloudflare / turnstile / captcha / auth |
| `contentPreview` | string | 正文前 100 字符 |
| `chapterTitle` | string | 章节标题 |
| `isLikelyNoticeOrLock` | bool | 短内容是否为公告/锁章 |
| `titleFoundInContent` | bool | 章节标题是否在正文中出现 |
| `artifactWriteError` | string | debug 产物写入失败原因（如有） |

## 手动验证（脚本故障时）

如果 `bsg.mjs validate` 不可用，直接 curl API：

```powershell
# 导入书源
curl.exe -X POST http://localhost:1111/api/source/import -H "Content-Type: application/json" --data-binary "@outputs/<slug>/book-source.json"

# 运行验证（含 debug 产物）
curl.exe -X POST http://localhost:1111/api/debug/run -H "Content-Type: application/json" -d '{"sourceUrl":"https://example.com","keyword":"关键词","mode":"http","debugDir":"runs/<slug>/debug"}'
```

直接调用 `/api/debug/run` 有两种合法方式：

- 先 `/api/source/import`，再传 `sourceUrl`。
- 不 import，直接在请求体传真实 `sourceJson` 字符串。不要传占位文本。

Cookie API 只在脚本故障时手工使用；正常流程优先写 `runs/<slug>/cookies.json`，由 `bsg.mjs validate` 自动注入。

```powershell
curl.exe -s -X POST http://localhost:1111/api/cookie/set -H "Content-Type: application/json" -d '{"domain":"www.example.com","cookie":"a=b; c=d"}'
curl.exe -s "http://localhost:1111/api/cookie/get?domain=www.example.com"
curl.exe -s -X POST http://localhost:1111/api/cookie/clear -H "Content-Type: application/json" -d '{"domain":"www.example.com"}'
curl.exe -s -X POST http://localhost:1111/api/cookie/clear -H "Content-Type: application/json" -d '{"all":true}'
```

这里的 `/api/cookie/clear` 清理 validator CookieStore；Probe WebView Cookie 要用 `http://127.0.0.1:18888/cookie-clear`。

## 前置检查

```powershell
if ((curl.exe -s --max-time 3 http://localhost:1111/api/sources 2>$null) -match "^\[") { "Running" } else { "Not running" }
```

**禁止用 `/health` 探测（该端点不存在，返回 404）。只用 `/api/sources`。**

## Android Probe / adb

使用 `mode=android` 处理 `webView:true` / `webJs`，或复用 Android Probe 登录态时，需要 adb 和已在线的 Android 真机或模拟器。

- 安装、启动 Probe、登录和 Android 验证：运行 `node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir>`
- `bsg.mjs android` 是 Android 场景默认收敛入口：检测 adb/设备/Probe，必要时启动 Probe，按返回的 `requiredUserAction` 或 `nextCommand` 继续
- 如果脚本失败，停止并向用户报告脚本输出。常规流程继续使用 `android --run` 的返回命令；只有脚本错误指向环境/Probe/设备问题，或用户要求调试时，才展开底层 adb、Probe API 或 validator 子步骤
- 底层诊断只能用于定位问题，不能用局部成功替代 `android --run` / `record-validation` 的最终收敛
- 找不到真机或模拟器：返回 `validator_limitation` / `Android Probe 不可用`

## record-validation 前置条件

`record-validation` 用来把真实 `validator-report.json` 收敛成状态、能力矩阵和修复上下文。`bsg.mjs run --run <run-dir>` 发现已有有效报告时也会自动执行这一步。

工具箱顺序：

```text
status --run runs/<slug>
→ validate --run runs/<slug> [--mode android]
→ record-validation --run runs/<slug> --status <validator-report.status>
→ deliver --run runs/<slug>
```

常见错误：`validator-report.json` 已生成后直接交付，跳过 `record-validation`。此时最终审计会失败；运行 `record-validation` 收敛报告，或让 `run --run <run-dir>` 自动收敛已有报告。
