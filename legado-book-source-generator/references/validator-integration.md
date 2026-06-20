# Validator 集成

## 概述

Validator 是本地书源预验证工具，运行在 `http://localhost:1111`。Skill 生成书源后，先跑 validator 验证，再决定交付或回修。生命周期管理由 `bsg.mjs validator-start/stop` 统一处理。

## 内置运行包

本 skill 自带 validator 前后端运行包：

```text
validator/
  run.bat
  setup-adb.bat
  setup-android-probe.bat
  app/legado-source-validator.jar
  examples/
```

人工启动：双击 `validator/run.bat`。脚本自动启动：`node scripts/bsg.mjs validator-start`。

启动后打开 `http://localhost:1111` 可使用浏览器调试台。

## API 接口

### POST /api/debug/run

单次验证：传入书源 JSON + 关键词，返回完整步骤详情。

```bash
curl -X POST http://localhost:1111/api/debug/run \
  -H "Content-Type: application/json" \
  -d '{"sourceJson": "<书源JSON>", "sourceUrl": "https://...", "keyword": "关键词", "mode": "http", "debugDir": "runs/<slug>/debug"}'
```

参数：
- `sourceJson`：书源 JSON 字符串（数组或单对象均可）
- `sourceUrl`：书源的 bookSourceUrl
- `keyword`：搜索关键词
- `mode`：`http` | `browser` | `android`
- `debugDir`（可选）：调试产物输出目录。必须已存在，validator 只写入该目录内部。产物文件名固定格式：`<phase>[-<index>]-<kind>`。失败时记入 `evidence.artifactWriteError`。

返回结构见 `validator-report.json`（包含 phases、steps、errorCode、evidence、debugArtifacts）。

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
| `passed` | 全链路 success + 无登录态特征 | 交付书源 |
| `anonymous_candidate` | 匿名全链路 success，但站点有 loginUrl/enabledCookieJar/Authorization | 不能标可用，需登录态复核 |
| `failed` | 某阶段 error，有可修证据（含 errorCode） | AI 根据 allowedFixes 自动回修 |
| `needs_app_review` | needsAppReview=true 或命中 App-only 行为 | 停止自动修，标记需复核 |
| `validator_limitation` | validator 不支持的规则能力 | validator 无法验证该能力 |
| `failed_unresolved` | 同一错误签名连续 5 次未修复 | 收敛失败，需人工检查 |

## BSG 记录门禁

validator 只负责产生事实报告，最终进入交付前必须让 BSG 记录：

```bash
node scripts/bsg.mjs record-validation --run runs/<slug> --status <status> --report runs/<slug>/validator-report.json
```

`record-validation` 会再次读取 `outputs/<slug>/book-source.json`。如果源里有 `webView:true` / `webJs`，或本轮登录态来自 Android Probe，但报告不是 `mode=android`，且 `android-status` 显示设备可用，会返回 `blockedBy=android_probe_not_used`。这种情况必须重跑 android mode，不能交付。

`mode=android` 不是 Android WebView 正文验证的充分证据。生成源含 `webView:true` / `webJs` 时，报告必须在 content 阶段留下 Android WebView 渲染证据：`webViewHtmlPreview`、`webViewScreenshotBase64`、`debugArtifacts["response.rendered.html"]` 或 `debugArtifacts["screenshot.png"]`。否则 `record-validation` 返回 `blockedBy=android_webview_not_used`。

Probe 登录后的报告必须有登录态证据：非 `anonymous` 的 `sessionMode`，或请求头里有 Cookie/Authorization。否则 `record-validation` 返回 `blockedBy=android_probe_cookie_not_used`，说明只是完成了手机登录动作，validator 请求没有使用该登录态。

报告中出现明确规则错误时，不允许把状态写成 `needs_app_review` 或 `validator_limitation`。典型规则错误包括：目录请求变成 `/chapter-list/`、详情阶段提取到的 `tocUrl` 缺少 book id、详情成功但 `coverUrl` / `intro` 为空。先修规则再重跑 validator。

`deliver` 没有 `record-validation` 状态会拒绝交付。不要手工伪造 `validator-report.json` 或 `validator-summary.md`；`validator-summary.md` 只能由 `record-validation` 生成。

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

如果 `validate-with-validator.mjs` 不可用，直接 curl API：

```bash
# 导入书源
curl -X POST http://localhost:1111/api/source/import \
  -H "Content-Type: application/json" \
  -d @outputs/<slug>/book-source.json

# 运行验证（含 debug 产物）
curl -X POST http://localhost:1111/api/debug/run \
  -H "Content-Type: application/json" \
  -d '{"sourceUrl":"https://...","keyword":"关键词","mode":"http","debugDir":"runs/<slug>/debug"}'
```

## 前置检查

```bash
curl -s http://localhost:1111/api/sources >nul 2>&1 && echo Running || echo Not running
```

**禁止用 `/health` 探测（该端点不存在，返回 404）。只用 `/api/sources`。**

## Android Probe / adb

使用 `mode=android` 处理 `webView:true` / `webJs`，或复用 Android Probe 登录态时，需要 adb 和已连接 Android 设备。

- 安装并启动 Probe：运行 `validator/setup-android-probe.bat`
- `setup-android-probe.bat` 是唯一入口：检测 adb、必要时调用 `setup-adb.bat`、安装 APK、启动 Probe、配置端口转发并检查 `http://127.0.0.1:18888/ping`
- 如果脚本失败，停止并向用户报告脚本输出。不要手工 `adb install` 绕过脚本
- 找不到设备：返回 `validator_limitation` / `Android Probe 不可用`
