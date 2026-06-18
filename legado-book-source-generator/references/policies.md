# 硬阻断规则与风险判断

## 登录处理

1. **匿名分析可以继续，最终验收不能只靠匿名。** 先匿名初探判断站点结构和反爬。
2. 只要站点有 `loginUrl` / `enabledCookieJar` / `Authorization` / `webJs` / `webView` 任一项，最终验证优先登录态。匿名结果只能标 `anonymous_candidate` 或高风险，不能标 full pass。
3. 用户拒绝登录时可以继续生成，但最终状态必须是 `degraded` / `high-risk`，需要 App 复核。
4. 如果登录需要扫码、验证码、短信或其他人工确认，立即请求用户协助，不要猜。

### 登录凭据采集渠道

| 方式 | 适用场景 | 操作 |
|------|---------|------|
| 手机扫码登录 | App loginUi 配置了账号密码/扫码 | 用户在 Legado App 内操作 |
| Token 手动输入 | 用户已知 Cookie/Token 字符串 | 用户粘贴，AI 写入 `--cookie=<file>` 参数 |
| Browser MCP 提取 Cookie | 站点需桌面浏览器登录 | 用户通过 Browser MCP 登录 → AI 调用 `browser_evaluate` 执行 `document.cookie` → 提取并保存为 JSON 文件 → `--cookie=<file>` 喂给 validator |

**Browser MCP 提取流程:**
1. 用户打开目标站点登录页，在 Browser MCP 中完成登录（账号密码/扫码）
2. AI 通过 `browser_network_requests` 找到 API 请求的 Cookie 或 Authorization header（注意：HttpOnly cookie 无法通过 `document.cookie` 获取，必须从网络请求头提取）
3. AI 将凭据保存为 `{"domain": "cookie_string"}` JSON 格式
4. 保存到 `runs/<site-slug>/cookies.json`
5. 调用 `node scripts/validate-with-validator.mjs <source> <keyword> --cookie=runs/<site-slug>/cookies.json`

## 风险升级

- 用户选择不登录分析：后续所有评估和生成提高风险等级。
- 登录无法完成：只允许继续做评估或探索性结果，明确写出高风险原因。

## 生成前阻断

- 先完成网站可生成性评估，再进入规则生成。
- 如果结论是 `需登录后再评估` 或 `不建议生成`，继续产出时必须显式标注 `高风险`、继续原因和预期失效链路。

## 实测优先

- 如果 Browser MCP 与模型推断冲突，以实测为准，并写明修正原因。

## WebView 回退

- 如果正文接口带签名、返回密文，或阅读页只有 CSR 空壳，但 Browser MCP 已能稳定看到渲染后的正文，先按 `可生成但高风险` 处理，优先评估 WebView 方案。
- 不能直接判 `不建议生成`。
- 如果准备给出 `不建议生成`，必须先排除 `references/reference-source-patterns.md` 中更低复杂度的回退路径，尤其是 WebView 和直接提取方案。

## 调试模式触发

- 用户反馈导入失败、链路失败、调试失败、报错截图、异常日志时，先用 validator 诊断。
- validator 失败时，AI 先根据证据自动回修（见 `references/validation-policy.md`）。
- 只有 validator 标记 `needs_app_review`、`validator_limitation` 或 `failed_unresolved` 时，才进入人工调试协作模式。
- 一旦进入调试协作模式，必须先按 `references/debugging-collaboration.md` 选择对应故障模板，先索取该阶段最小证据包。
- 在拿到当前阶段最小证据包之前，禁止把本地文件、历史输出或模型推断优先于用户当前 Legado App 内实际使用的规则与源码。
