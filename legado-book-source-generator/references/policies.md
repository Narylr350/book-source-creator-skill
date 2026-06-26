# 硬阻断规则与风险判断

## 登录处理

1. 先匿名初探判断站点结构和反爬。
2. 只要站点有 `loginUrl` / `enabledCookieJar` / `Authorization` / `webJs` / `webView` 任一项，最终验证优先登录态。
3. 如果登录需要扫码、验证码、短信或其他人工确认，立即请求用户协助，不要猜。

### 登录凭据采集渠道

| 方式 | 适用场景 | 操作 |
|------|---------|------|
| Probe Android WebView 登录 | 有 Android 真机或模拟器，需站点 Cookie/Token | AI 运行 `android --run <run-dir>` 打开登录页，用户在手机/模拟器网页里手动登录 |
| 手机扫码登录 | App loginUi 配置了账号密码/扫码 | 用户在 Legado App 内操作 |
| Token 手动输入 | 用户已知 Cookie/Token 字符串 | 用户粘贴，AI 写入 `--cookie=<file>` 参数 |
| Browser MCP 提取 Cookie | Android/Probe 不可用时的备选 | 用户通过 Browser MCP 登录 → AI 调用 `browser_network_requests` 提取 → 保存为 JSON 文件 → `--cookie=<file>` 喂给 validator |

**Probe Android WebView 登录用户提示模板：**

```md
我已经把登录页发到你的 Android Probe WebView（真机或模拟器）。

请在手机或模拟器里操作：
1. 解锁手机或打开模拟器窗口，查看刚打开的网页登录页
2. 按站点页面提示输入账号和密码
3. 如果出现短信、验证码、滑块、扫码或安全确认，请你手动完成
4. 看到用户名、会员中心、书架、首页或其他已登录状态后，回到这里回复"已完成登录"

如果手机/模拟器没有弹出页面、页面打不开、验证码过不去、没有账号，直接告诉我具体情况。
```

用户回复完成后，运行 `node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir> --login-completed`。脚本会检查 Probe Cookie 和登录证据；adb 在线时 Browser Cookie 不能替代。

**Browser MCP 提取流程:**
1. 仅在 Android/Probe 不可用时使用。用户打开目标站点登录页，在 Browser MCP 中完成登录（账号密码/扫码）
2. AI 通过 `browser_network_requests` 找到 API 请求的 Cookie 或 Authorization header（注意：HttpOnly cookie 无法通过 `document.cookie` 获取，必须从网络请求头提取）
3. AI 将凭据保存为 `{"www.example.com": "cookie_string"}` JSON 格式；或保存为 `{"domain":"www.example.com","cookie":"cookie_string"}`
4. 保存到 `runs/<site-slug>/cookies.json`
5. 调用 `node "<skill-dir>/scripts/bsg.mjs" validate --run runs/<site-slug>`（自动检测 cookies.json）

## 风险升级

- 用户通过 `resolve-user-action --action no_account` 表示无法登录：后续所有评估和生成提高风险等级。
- 登录无法完成：只允许继续做评估或探索性结果，明确写出高风险原因。

## 实测优先

- 如果 Browser MCP 与模型推断冲突，以实测为准，并写明修正原因。

## WebView 回退

- 如果正文接口带签名、返回密文，或阅读页只有 CSR 空壳，但 Browser MCP 已能稳定看到渲染后的正文，先按 `可生成但高风险` 处理，优先评估 WebView 方案。
- 不能直接判 `不建议生成`。
- 如果准备给出 `不建议生成`，必须先排除更低复杂度的回退路径，尤其是 WebView 和直接提取方案。参考 `examples/pattern-api-webview-auth/` 的 CSR + WebView 混合模式。

## 调试模式触发

- 用户反馈导入失败、链路失败、调试失败、报错截图、异常日志时，先用 validator 诊断。
- 只有 validator 标记硬边界时，才进入人工调试协作模式。
- 一旦进入调试协作模式，必须先按 `references/debugging-collaboration.md` 选择对应故障模板，先索取该阶段最小证据包。
- 在拿到当前阶段最小证据包之前，禁止把本地文件、历史输出或模型推断优先于用户当前 Legado App 内实际使用的规则与源码。

## 验证码与登录态

搜索/入口链路触发验证码（CAPTCHA）时，如果站点有登录功能，**登录态可能解除反爬限制**。很多站点对匿名搜索弹验证码，但登录后搜索正常。这不是绕过反爬——登录是站点提供的正常交互，登录后的 session 被站点视为可信用户。

正确顺序：
1. 检查 site-facts 的 `features.hasLogin`——如果有登录功能，先尝试登录路径
2. 走 `android --run <dir> --setup` → 用户在 Probe 登录 → `--login-completed` → 重跑 validate
3. 登录后仍弹验证码 → 确认是站点固有限制，按 `failed` 收敛
4. 搜索仍被阻塞但 detail/toc/content 需要验证 → 用 `validate --book-url <url>` 跳过搜索直接测试后续链路

## 登录态丢失处理

触发条件：当前操作中出现页面跳转到登录页、API 返回 401/403、或 Cookie 失效。

立即停止当前操作，告知用户登录态已失效，询问是否重新登录。不要反复重试相同操作。

## Probe 登录 vs mode=android 的区别

这是两个独立的事情：

| 操作 | 证明的事 |
|------|---------|
| Probe 原生登录（`/login`） | 登录态来自手机/模拟器环境 |
| `mode=android` 验证 | validator 走过 Android/WebView 通道 |

Probe 登录后的验证报告必须看到登录态证据（非 anonymous sessionMode，或 Cookie/Authorization 请求头）。
如果报告仍是匿名会话，说明登录动作没有进入验证请求，需要重新排查。
