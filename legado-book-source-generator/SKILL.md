---
name: legado-book-source-generator
description: Use when 用户要求为任意网站生成书源、生成阅读书源、分析小说站点、生成 Legado/阅读规则。强制触发词：书源、生成书源、帮我生成、book source、legado、阅读书源、小说站点分析。如果用户给出了一个 URL 并要求生成或分析，必须加载此 skill。
---

# Legado 书源生成

## 强制第一步

**拿到 URL 后操作顺序：**

1. **最多做一件事：匿名 HTTP fetch 首页**，按下方快速路径规则判断是否加 `--fast`。不确定？不加。
2. **立即运行 `init`。** 禁止在 fetch 之后继续探测其他页面。

```bash
node "<skill-dir>/scripts/bsg.mjs" init <site-url> [--fast] [--cwd <输出目录>]
```

`init` 返回 `nextAction: "probe_site"`。然后按 `nextAction` 执行每个阶段，每阶段完成后运行 `advance`：

```
init → advance → advance → advance → advance → record-validation → advance → deliver → validator-stop
```

每步写文件到 `runs/<slug>/`，不是到 skill 目录。`run-state.json` 由 bsg.mjs 命令写入，不手动编辑。只有 `deliver` 生成 "passed" 认证。**deliver 完成后必须运行 `validator-stop` 关闭 validator，不得保持运行。**

**禁止跳过 init。禁止手动创建 runs/ 目录或 run-state.json。**

## 输出

- `outputs/<site-slug>/book-source.json` — 唯一交付物
- `runs/<site-slug>/` — 过程记录（assessment.md、analysis.md、validator-report.json 等）

## 快速路径（`--fast`）

**init 之前允许做一件事：匿名 HTTP fetch 站点首页。**

出现以下任一特征 → **不加 `--fast`**，走完整 Browser MCP 路径：

- 返回空内容或 CSR 空壳（`__nuxt` / `__next` / `<div id="app">`）
- 包含 Cloudflare / Turnstile / 验证码
- 重定向到 /login 或 /signin
- 页面主体是 JS 加载的（无可见文本）
- 响应中含有 `<input type="password"`（登录表单）
- 页面有 `login` / `signin` / `signup` 链接且描述为"登录""注册"

**全部不满足** → `init --fast`。`--fast` 只意味着 probe 阶段用 HTTP fetch 代替 Browser MCP，不影响 validate。

**不确定 → 不加。** 不要看 trafilatura 提取的纯文本判断——它会把登录表单和拦截元素过滤掉。看原始 HTML 响应体。

## 用户交互

**Probe 阶段遇到登录墙：立即停止所有探测，直接问用户是否可登录。** 触发条件：任一页面重定向到 /login、API 返回 401/403、页面显示"请先登录"。不要检查 localStorage、不要翻源码、不要研究 WebSocket——每多一步都在浪费用户时间。

写完 `assessment.md` 后立即向用户展示评估摘要。摘要必须 3-6 行，包含：评级、风险标签、4 条链路状态、关键阻塞点（如有）。

`requiredUserAction` 非 null 时停下来等用户：

| 触发 | 操作 |
|------|------|
| 评级"不建议生成" | 等用户决定 |
| WebView/CSR 正文但无 Android 设备 | 请用户连接手机（设置指南：`docs/SETUP.md`） |
| 需要登录（enabledCookieJar/Authorization） | **adb 在线 → Probe 原生登录（/login + 手机完成）；无 adb → Browser MCP 登录 + Cookie 提取** |
| **登录态丢失**（页面跳登录页、401/403、Cookie 失效） | **立即停止当前操作，告知用户登录态已失效，询问是否重新登录。不要反复重试。** |
| Probe 和 Browser MCP 互斥提示 | 手机登录可能挤掉电脑会话（反之亦然）。如果一边登录后另一边立即失效，这是正常的——选择一条线坚持用。 |
| Android Probe 需 adb 授权 | 用户在手机上确认 USB 调试 |
| 同一错误连续 5 次（收敛失败） | 等用户决定 |

登录优先级：有 adb → Probe 原生登录（环境一致不掉验证）；无 adb → Browser MCP 登录 + Cookie 提取。详见 `references/policies.md`

## 原则

1. 实测优先于模型推断。冲突以 Browser MCP 为准，写明修正原因。
2. 官方规则优先。服从 `references/legado-official-rule-notes.md`。
3. `candidates/` 是参考素材，不是可用书源。
4. Browser MCP ≠ Android WebView。写"桌面浏览器可渲染"，不写"Legado WebView 可渲染"。
5. WebView 渲染，不解密。正文加密但浏览器能渲染 → `webView: true` + `webJs` 从 DOM 提取。不分析加密算法。
6. 只覆盖 search / detail / toc / content。不启用发现页，除非用户明确要求。
7. 对照样例结构，规则必须针对目标站点实测调整。不直接复制。

## 参考文档

按阶段加载，一级引用：

| 阶段 | 必读 | 按需 |
|------|------|------|
| probe / assess | `references/policies.md`、`references/assessment-template.md` | |
| analyze | `references/analysis-workflow.md` | `references/webview-behavior-matrix.md`（CSR/WebView）、`examples/README.md` |
| generate | `references/legado-official-rule-notes.md`、`references/legado-json-structure.md` | `examples/README.md`、`examples/<site>/book-source.json` |
| validate | `references/validator-integration.md`、`references/validation-policy.md` | `references/failure-diagnosis.md`、`references/validation-checklist.md` |
| 调试/复核 | `references/debugging-collaboration.md` | `references/failure-diagnosis.md` |

## Android WebView Probe

loginFeatures 含 webView 或 webJs 时，用 mode=android 验证正文。

执行序列：
1. `bsg.mjs validator-start`
2. `validator/setup-adb.bat`
3. `validator/setup-android-probe.bat`
4. **如果站点需要登录态且 Cookie 来自桌面浏览器（环境不一致）**：
   - `POST http://localhost:18888/login {"url":"登录页URL"}` → 手机屏幕显示登录页
   - 用户在手机上手动登录，登录完成后点底部绿色"✓ 完成登录"
   - `GET http://localhost:18888/cookie-check?domain=xxx` 确认 Cookie 已注入
   - CookieManager 自动共享给后续 `/render`——环境一致，不掉验证码
5. `validate-with-validator.mjs <source> <keyword> android --output runs/<slug>/`

Android Probe 不可用时标 `validator_limitation`，不标 passed。

手机设置指南见 `docs/SETUP.md`（含各品牌 USB 调试步骤）。
