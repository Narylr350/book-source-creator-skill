# Android Probe 指南

工具箱模式下，遇到 Android、模拟器、登录态、WebView/WebJs、CSR 正文或入口反爬复核场景时先读本文件。

## 何时必须用

- 正文页是 CSR（`__nuxt` / `__next` / `<div id="app">`）
- 正文需要 WebView 渲染
- HTTP fetch 只返回 JS 空壳
- 站点需要登录态，且真机或模拟器在线
- 搜索、详情、目录入口在桌面 HTTP/Browser 下触发验证码或人机验证，需要阅读 App 环境复核

## 操作顺序

```bash
node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir>
```

`bsg.mjs android` 是 Android 场景默认收敛入口：检查 adb/真机/模拟器/Probe，必要时通过封装动作启动 Probe，运行 `mode=android` 验证，并在已有 `validator-report.json` 时收敛验证结果。

只需要只读诊断时才运行 `android-status`。常规 Android 场景优先跟随 `android --run` 返回的命令，不自己临时拼 adb、Probe API 或 validator 子步骤。

`android --run` 不是万能黑盒。以下情况可以展开底层诊断：

- `android --run` 返回的错误已经指向 adb、Probe、端口转发、APK 安装或 validator 环境问题
- 用户明确要求调试 Android/Probe/设备状态
- 需要确认脚本封装本身是否失效

展开底层诊断后必须把结论写回 run 目录或命令输出，并回到 `android --run` / `record-validation` 收敛；不要用底层命令的局部成功直接交付。

## 技术细节速查

`android --run` 背后处理的是这几类能力：

| 能力 | 事实来源 | 通过标准 | 失败后查什么 |
|------|----------|----------|--------------|
| adb 设备 | `adb devices` / `android-status` | 至少一台 `device` 状态的真机或模拟器 | unauthorized、offline、空列表、模拟器未启动 |
| Probe 服务 | `http://127.0.0.1:18888/ping` / `/info` | `/ping` 返回 `pong`，`/info` 返回 JSON | 端口转发、APK 是否安装/启动、Probe 是否崩溃 |
| Probe 登录 | `/login` 打开目标站登录页，`/cookie-check?domain=<host>` 查 Cookie | 有 Cookie 且有登录证据 | 用户是否真的登录、域名是否是 `www`/`wap`/`m` |
| Android 验证 | `validator-report.json` 的 `mode`、`steps[*]` | 最终 passed 来自 `mode=android` | 不能用 PC HTTP passed 代替 |
| WebView 正文 | `webViewHtmlPreview`、`webViewScreenshotBase64`、`debugArtifacts`、`extracted` | 有渲染证据，也有正文提取证据 | 只截图不算正文可用 |

常用只读诊断命令：

```powershell
node "<skill-dir>/scripts/bsg.mjs" android-status
adb devices
curl.exe -s --max-time 3 http://127.0.0.1:18888/ping
curl.exe -s --max-time 3 http://127.0.0.1:18888/info
curl.exe -s "http://127.0.0.1:18888/cookie-check?domain=<目标域名>"
```

只读诊断命令可以帮助定位问题，但不能替代 `android --run` 的最终结果。

### Cookie 可见性和手动导出

默认输出只显示安全摘要，不显示原始 Cookie：

- `checkedDomains`：脚本检查过的域名
- `selectedDomain`：最终选中的 Cookie 域名
- `cookieNames`：Cookie 名，不含值
- `hasLoginEvidence`：是否命中登录证据

自动选择域名不可能覆盖所有站点。登录 Cookie 可能落在移动域名、API 子域，或 Cookie 名不含 `login/token/user` 这类关键词。需要人工核对时，显式导出原始 Cookie：

```powershell
node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir> --dump-cookie "runs/<slug>/cookies.json"
```

导出的文件是 validator 可直接读取的格式：

```json
{
  "example.com": "sessionid=...; auth_token=..."
}
```

使用边界：

- `--dump-cookie` 只用于本地 validator 调试或手动核对域名，不改变 run 状态。
- 文件包含原始 Cookie，不要贴进对话、debug-bundle、日志或 `book-source.json`。
- 书源里不要写死 Cookie；优先用 `enabledCookieJar`、`loginUrl`、`java.getCookie()` 复用阅读 App 登录态。
- 如果 `hasLoginEvidence=false`，说明只导出了可见 Cookie，不代表账号已登录；继续让用户在手机/模拟器完成登录，或按站点实际 Cookie 规则人工判断。

### 底层 Probe API 速查

只在 `android --run` 明确指向 Probe/设备环境问题，或用户要求调试 Probe 时使用。常规验证仍回到 `android --run`。

PowerShell 下用 `curl.exe`，不要用 `curl` 别名。

#### `/render`

最小可用请求必须带 `timeout`。漏传 `timeout` 时旧 Probe/JSON 解析路径可能返回 `Timeout after 0ms`，这不能证明 WebView 坏了。

```powershell
curl.exe -s --max-time 90 -X POST http://127.0.0.1:18888/render -H "Content-Type: application/json" -d '{"url":"https://example.com","timeout":60000,"screenshot":false}'
```

常用字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `url` | 是 | WebView 打开的 URL |
| `timeout` | 是 | 页面整体超时，常用 `60000` |
| `headers` | 否 | 请求头，例如 `User-Agent` |
| `cookies` | 否 | 额外注入 Cookie；优先用 Probe 登录后的 CookieManager |
| `javaScript` | 否 | 页面加载后执行；默认 `document.documentElement.outerHTML` |
| `jsRetries` | 否 | `javaScript` 返回空时重试次数，默认 `30` |
| `jsDelay` | 否 | 页面完成后和每次重试的等待毫秒数，默认 `1000` |
| `screenshot` | 否 | 是否返回 base64 截图；诊断 HTML 时可设 `false` |

判断结果：

- `ok:true` + `html`：WebView 渲染通道可用。
- `ok:false` + `Timeout after 0ms`：先检查请求体是否带 `timeout`，不要直接判 Probe/WebView 故障。
- `ok:false` + `Timeout after 60000ms`：页面确实在给定时间内未完成，继续查网络、页面阻断或 `webJs` 等待逻辑。

#### `/login`

打开手机或模拟器上的 Probe WebView 让用户手动登录：

```powershell
curl.exe -s --max-time 10 -X POST http://127.0.0.1:18888/login -H "Content-Type: application/json" -d '{"url":"https://example.com/login","timeout":180000}'
```

返回 `ok:true` 只说明登录页已显示，不说明用户已登录。用户完成登录后，回到常规命令：

```bash
node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir> --login-completed
```

#### `/cookie-check` 和 `/cookie-clear`

```powershell
curl.exe -s "http://127.0.0.1:18888/cookie-check?domain=www.example.com"
curl.exe -s -X POST http://127.0.0.1:18888/cookie-clear
```

`/cookie-clear` 清理的是 Probe WebView CookieManager，不是 validator 的 `validator-cookies.json`。

### Probe Cookie 判断

Probe 会优先检查目标域名及常见移动域名：

- `www.example.com`
- `wap.example.com`
- `m.example.com`
- `example.com`

`/cookie-check` 只返回 Cookie 不等于已登录。以下任一项才算登录证据：

- `authenticated=true`、`loggedIn=true` 或 `isLoggedIn=true`
- `sessionMode` 存在且不是 `anonymous`
- `user` / `account` 有值
- Cookie 名包含 `login`、`auth`、`token`、`user`、`uid`、`reader`、`member`、`account`

只有匿名 Cookie 时，不要运行 `--login-completed`，应让用户继续在手机/模拟器里完成登录。

若自动判断和页面状态矛盾，先看 `android --login-completed` 返回的 `probeCookieEvidence`。仍不清楚时用 `--dump-cookie` 导出本地文件，人工检查域名和 Cookie 名，再决定是否保存为 `runs/<slug>/cookies.json` 供 validator 调试。

### Android Report 判断

看到 `mode=android` 只说明 validator 走过 Android 模式，不一定证明 WebView 正文可用。

正文含 `webView:true` 或 `webJs` 时，content step 必须同时满足：

1. Android/Probe 证据：`androidProbeUsed=true`，或有 `webViewHtmlPreview` / `webViewScreenshotBase64`，或 `debugArtifacts["response.rendered.html"]` / `debugArtifacts["screenshot.png"]`
2. 正文提取证据：`preview`、`evidence.contentPreview`、`evidence.contentLength` 或 `extracted.contentLength`

只有 rendered HTML 或 screenshot，不能证明阅读 App 能提取正文；必须继续修 `ruleContent.content` / `webJs` 后重跑 Android 验证。

### 底层诊断回收

如果你展开了 adb、curl 或 Probe API 诊断，结束时必须做一件事：

```bash
node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir>
```

如果已有新的 `validator-report.json`，再运行：

```bash
node "<skill-dir>/scripts/bsg.mjs" record-validation --run <run-dir> --status <validator-report.status>
```

不要把“adb 在线”、“/ping 正常”、“浏览器能看正文”、“Cookie 存在”当成交付结论。

## 登录优先级

| 场景 | 登录方式 | 验证方式 |
|------|---------|---------|
| adb 在线（真机或模拟器） | Probe 原生登录 `/login` | `mode=android` |
| adb 不可用 | Browser MCP 登录 + Cookie 提取 | `mode=http` + `cookies.json` |

Probe 登录和 `mode=android` 是两件事：

- Probe 登录：证明登录态来自手机或模拟器环境
- `mode=android`：证明 validator 走过 Android 通道

两者都需要，缺一不行。

## 给用户的登录步骤

1. 手机或模拟器屏幕会弹出目标站点的网页登录页。
2. 请用户在手机或模拟器页面里输入账号密码，完成短信、验证码、滑块或扫码。
3. 看到登录成功页面、用户名、会员中心或站点首页后，让用户回复“已完成登录”。
4. 用户回复后运行：

```bash
node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir> --login-completed
```

脚本会检查 Probe Cookie 和登录证据；不要提前确认登录完成，也不要手工请求 `/cookie-check`。

## 禁止事项

- 不问用户直接跑 `bsg.mjs login`
- 在常规流程里绕过 `bsg.mjs android` 自己拼底层 adb、Probe API 或 validator 子步骤，并用局部成功替代最终收敛
- `bsg.mjs android` 失败后改走未封装的底层步骤
- HTTP mode 通过但源含 `webView:true` / `webJs` 时标 passed
- adb 在线时用 Browser Cookie 代替 Probe 登录
