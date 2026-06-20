---
name: legado-book-source-generator
description: Use when 用户要求为任意网站生成书源、生成阅读书源、分析小说站点、生成 Legado/阅读规则。强制触发词：书源、生成书源、帮我生成、book source、legado、阅读书源、小说站点分析。如果用户给出了一个 URL 并要求生成或分析，必须加载此 skill。
---

# Legado 书源生成

## 第一步

**拿到 URL 之后，直接运行 `init`。不探测、不分析、不翻源码。**

```bash
node "<skill-dir>/scripts/bsg.mjs" init <site-url> [--cwd <输出目录>]
```

`init` 返回 `nextAction: "probe_site"`。然后按 `nextAction` 推进，每阶段完成后运行 `advance`：

```
init → advance → advance → record-assessment → advance → advance → advance → record-validation → advance → deliver → validator-stop
```

每步写文件到 `runs/<slug>/`，不是到 skill 目录。`run-state.json` 由 bsg.mjs 命令写入，不手动编辑。只有 `deliver` 生成 "passed" 认证。**deliver 完成后必须运行 `validator-stop` 关闭 validator，不得保持运行。**

**禁止跳过 init。禁止手动创建 runs/ 目录或 run-state.json。**

**状态机是硬门禁，不是建议。** 只按 `bsg.mjs` 返回的 `nextAction` 执行。`requiredUserAction` 非 null 时停止自动操作，先让用户确认，再运行 `resolve-user-action`。不要靠编辑 `assessment.md`、`run-state.json`、`validator-report.json` 或删风险词绕过门禁。

## 输出

- `outputs/<site-slug>/book-source.json` — 唯一交付物
- `runs/<site-slug>/` — 过程记录（assessment.md、analysis.md、validator-report.json 等）

## Probe 阶段

`init` → `nextAction: "probe_site"`。**必须用 Browser MCP。** HTTP fetch 只用于辅助——拿 API 响应、拿 JSON 数据。页面结构和 DOM 永远用 Browser MCP snapshot。

四条链路（搜索 → 详情 → 目录 → 正文）每条至少 snapshot 一次。正文至少取两个章节。

HTTP fetch 单独永远不够——它看不到 DOM、不执行 JS、不渲染 CSR 页面。

## 用户交互

**Probe 阶段遇到登录墙：立即停止所有探测，直接问用户是否可登录。** 触发条件：任一页面重定向到 /login、API 返回 401/403、页面显示"请先登录"。不要检查 localStorage、不要翻源码、不要研究 WebSocket——每多一步都在浪费用户时间。

Probe 阶段必须把四链路事实写入 `runs/<slug>/site-facts.json`。四链路 `status` 只写 `success` / `blocked` / `failed`（`ok/pass/error` 会归一化，其他自由词会拒绝）；`render` 写 `ssr_or_http` / `csr` / `webview` / `csr_encrypted` 等事实；验证码、登录、VIP、加密等必须写入 `blocker` 或 `render`，不能只写在自然语言备注里。`assessment.md` 的 AUTO 结论由 `record-assessment` 从 `site-facts.json` 生成，AI 只能写 AUTO 区块外的证据说明/分析备注，并且证据说明必须引用有效 `evidence:<id>`。

写完 `assessment.md` 后必须先运行 `record-assessment`。只有 `record-assessment` 返回 `ok:true` 后，才能向用户展示 3-6 行评估摘要。摘要只能取 AUTO 区块里的评级、风险标签、4 条链路状态、关键阻塞点（如有），不要自由改写成“正常阅读/无验证码/可用”等结论。

`requiredUserAction` 非 null 时停下来等用户。用户答复后只用命令记录决定：

```bash
node "<skill-dir>/scripts/bsg.mjs" resolve-user-action --run <run-dir> --action <action>
```

| 触发 | 操作 |
|------|------|
| 评级"不建议生成" | 等用户决定 |
| WebView/CSR 正文但 Android 状态未知 | 运行 `android-status`；设备可用则用 android mode，设备不可用则问用户并记录 `android_device_unavailable` |
| 需要登录（enabledCookieJar/Authorization/VIP/订阅/付费） | **adb 在线 → Probe 原生登录（/login + 手机完成）并用 `mode=android` 验证；无 adb → Browser MCP 登录 + Cookie 提取** |
| **登录态丢失**（页面跳登录页、401/403、Cookie 失效） | **立即停止当前操作，告知用户登录态已失效，询问是否重新登录。不要反复重试。** |
| Probe 和 Browser MCP 互斥提示 | 手机登录可能挤掉电脑会话（反之亦然）。如果一边登录后另一边立即失效，这是正常的——选择一条线坚持用。 |
| Android Probe 需 adb 授权 | 用户在手机上确认 USB 调试 |
| 同一错误连续 5 次（收敛失败） | 等用户决定 |

登录优先级：有 adb → Probe 原生登录并用 Android mode 验证；无 adb → Browser MCP 登录 + Cookie 提取。详见 `references/policies.md`

注意区分两件事：
- Probe 原生登录只证明登录态来自手机环境。
- `mode=android` 只证明 validator 走过 Android 通道。
- Probe 登录后的验证报告必须能看到登录态证据（非 anonymous sessionMode，或 Cookie/Authorization 请求头）。如果报告仍是匿名会话，说明登录动作没有进入验证请求。
- 生成源含 `webView:true` / `webJs` 时，必须在正文 content 阶段看到 Android WebView 渲染证据（`response.rendered.html`、`screenshot.png`、`webViewHtmlPreview` 或 `webViewScreenshotBase64`）。只有 `mode=android` 但没有正文渲染证据，按“未使用 Android WebView 验证”处理，不能交付。

常用动作：`android_device_ready`、`android_device_unavailable`、`login_completed`、`no_account`、`continue_after_rating_block`。

Probe 手机登录时必须给用户明确步骤，不要只说"完成登录"：

1. 手机屏幕会弹出目标站点的网页登录页，不是让用户点一个完成按钮。
2. 请用户在手机页面里按站点提示输入账号/密码，完成短信、验证码、滑块或扫码。
3. 看到登录成功页面、用户名、会员中心或站点首页后，再让用户回复"已完成登录"。
4. 如果手机没弹出页面、页面打不开、验证码过不去或账号不可用，让用户直接说明，不要继续猜。
5. 用户回复后再检查 `/cookie-check`，确认 Cookie 后运行 `resolve-user-action --action login_completed`。adb 在线时该命令会强制检查 Probe Cookie；不要用 Browser Cookie 绕过。

## 原则

1. 实测优先于模型推断。冲突以 Browser MCP 为准，写明修正原因。
2. 规则来源分层：`official-rule-pack.json` 管官方教程可确认的硬规则；`legado-source-behavior.md` 只记录源码/实现确认行为；validator 文档管验证策略；`example-lessons.json` 只提供检查提醒。
3. examples 是经验样例，不是当前站点事实。不得把历史 selector、URL、站点行为当证据。
4. Browser MCP ≠ Android WebView。写"桌面浏览器可渲染"，不写"Legado WebView 可渲染"。
5. WebView 渲染，不解密。正文加密但浏览器能渲染 → `webView: true` + `webJs` 从 DOM 提取。不分析加密算法。
6. 只覆盖 search / detail / toc / content。不启用发现页，除非用户明确要求。
7. 对照样例结构，规则必须针对目标站点实测调整。不直接复制。

## 参考文档

按阶段加载，一级引用：

| 阶段 | 必读 | 按需 |
|------|------|------|
| probe / assess | `references/policies.md`、`references/assessment-template.md` | `references/example-lessons.json` |
| analyze | `references/analysis-workflow.md` | `references/webview-behavior-matrix.md`（CSR/WebView）、`examples/README.md` |
| generate | `references/official-rule-pack.json`、`references/legado-source-behavior.md`、`references/legado-json-structure.md` | `examples/README.md`、`examples/<site>/book-source.json` |
| validate | `references/validator-integration.md`、`references/validation-policy.md` | `references/failure-diagnosis.md`、`references/validation-checklist.md` |
| 调试/复核 | `references/debugging-collaboration.md` | `references/failure-diagnosis.md` |

## Android WebView Probe

**什么时候必须用：** 正文页是 CSR（`__nuxt` / `__next` / `<div id="app">`）、需要 WebView 渲染、或者 HTTP fetch 拿到的是 JS 空壳。

先运行：

```bash
node "<skill-dir>/scripts/bsg.mjs" android-status
```

**Probe 阶段发现 CSR 正文且设备状态未知时，立即停下来问用户：**

> "这个站的正文需要 WebView 渲染（CSR 页面），Android 设备或模拟器能大幅提高验证精度。你有 Android 设备（或模拟器）可以用吗？"

**用户说"有"：**
1. `adb devices` — 确认设备已连接。没连上？等用户插 USB + 确认授权。
2. `bsg.mjs validator-start`
3. `validator/setup-android-probe.bat` — 单入口：检测 adb、必要时安装 adb、安装 APK、启动 Probe、配置端口并检查 `/ping`
4. validate 阶段用 `mode=android`

**用户说"没有"：**
- 继续生成，但 validate 阶段用 `mode=http`
- 正文失败标 `validator_limitation`，**不标 passed**
- 交付时明确告知用户：此书源需在 Legado App 内实测正文

**不要做的事：**
- 不问用户直接跑 setup 脚本
- `setup-android-probe.bat` 失败后手工 `adb install` 绕过脚本；应把脚本输出报给用户并等待处理
- setup 失败后悄悄跳过，标 passed
- 假设用户没有设备就不问
- HTTP mode 验证通过但生成源含 `webView:true` / `webJs` 时标 passed。必须用 android mode；无设备只能 `needs_app_review` / `validator_limitation`

手机设置指南见 `docs/SETUP.md`（含各品牌 USB 调试步骤）。

## 验证记录

validator 跑完后必须调用：

```bash
node "<skill-dir>/scripts/bsg.mjs" record-validation --run <run-dir> --status <passed|failed|needs_app_review|validator_limitation|degraded> [--report <validator-report.json>]
```

`record-validation` 返回 `blocked` 时按 `blockedBy` 处理，不要继续 `advance` 或 `deliver`。

`record-assessment` 返回错误时，不展示评估摘要，不询问后续选择，先修正 `site-facts.json` 或 `assessment.md` 的证据说明。VIP、付费、订阅、会员、登录态、Cookie、Authorization、401/403 由 facts/blocker 推导，不能靠 AI 文本改成无风险。

`record-assessment` 通过后，如果后续发现探测结论错了，必须先改 `site-facts.json` 并重新跑 `record-assessment`；不要只改 `analysis.md` 或 `book-source.json`。`record-validation` / `deliver` 会检查 facts hash，发现 `site-facts.json` 变更会回退到 assess。

generate 阶段通过后，不要再直接改 `outputs/<slug>/book-source.json` 然后继续验证。若 validator 暴露规则错误，改完书源后必须重新通过 generate/official-rule-pack 校验；`record-validation` / `deliver` 会检查 source hash，发现书源变更会回退到 generate。

禁止手工写 `validator-report.json` / `validator-summary.md` 后交付。`deliver` 只接受 `record-validation` 写入的真实状态。

`record-validation` 会生成 `capability-matrix.json` 和 `validator-summary.md`；`generate` 阶段会生成 `rule-check.json`。`deliver` 只从 `capability-matrix.json` / `rule-check.json` / run-state 决定最终状态。缺失或不是脚本生成时，重新运行对应命令，不要手写补齐。
