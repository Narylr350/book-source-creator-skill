---
name: legado-book-source-generator
description: Use when 需要分析小说站点并生成 Legado 书源，尤其是在分析网站结构、登录态页面、接口行为或排查解析规则异常时。触发场景：用户给出小说站点 URL 要求生成书源、用户反馈书源导入失败或链路异常需要调试、用户要求评估某站点是否可生成书源。
---

# Legado 书源生成

把单个小说站点分析成单个 Legado 书源。

目标站点的实测行为（Browser MCP 或 HTTP fetch）和阅读官方规则是事实基线。快速路径以 HTTP fetch 为基线；完整路径以 Browser MCP 为基线。

登录凭据来源: 手机扫码 / Token 输入 / Browser MCP 提取 Cookie → 详见 `references/policies.md`

## 快速路径

**符合以下全部条件时可走快速路径**（跳过 Browser MCP 探索，直接进 validator）：

1. 匿名 HTTP fetch 能拿到搜索/详情/目录/正文的**可见文本**（不是 CSR 空壳）
2. 无 Cloudflare / 验证码拦截
3. 无登录需求（或登录为可选项、匿名可用）
4. 无 `webView` / `webJs` / CSR 依赖

**快速路径流程：**
```
匿名 fetch 四链路 → 评估 → 生成 JSON → validator 验证 → 交付
```

**完整路径**（默认）：CSR、Cloudflare、登录态、加密——任一命中即走完整 Browser MCP 流程。

## 强制顺序

```
匿名初探/登录判定 → 可生成性评估 → 立即展示评估摘要 → 网站分析 → 生成 JSON → validator 验证 → 登录态/App WebView 复核（必要时）→ AI 自动回修 → 交付 / anonymous_candidate / App 复核 / 工具限制
```

**禁止跳步。** 在完成可生成性评估之前，禁止生成 `book-source.json`。

### 评估摘要展示规则

- 写完 `assessment.md` 并落盘后，必须立即给用户 3-6 行摘要（评级 + 关键风险点）。
- 如果结论是"可直接生成"或"可生成但高风险"：继续自动生成，不等用户确认。
- 如果结论是"需登录后再评估"或"不建议生成"：停下来等用户决策。

### 评估可被推翻

- 后续 Browser MCP、validator、网络请求证据推翻 assessment 时，必须先更新 `assessment.md`，再继续最终交付。
- 最终回复必须说明评估结论已修正。

### validator 验证后的分流

```
validator passed + 无登录态特征 / 已完成登录态验证 → 交付 book-source.json + validator-report
validator 匿名 passed + 有登录态特征 (loginUrl/enabledCookieJar/Authorization/webJs/webView) → anonymous_candidate，需登录态/App 复核
validator 失败，有可修证据 → AI 修规则 → 再跑 validator（最多 5 次）
validator 标记 needsAppReview → 停止自动修，标记需 App/浏览器复核
validator 暴露工具能力缺口 → 标记 validator limitation，不误判站点不可用
validator 失败且证据不足 → 用 Browser MCP 补实测
```

## 生产时必须同时对照的文档

生成阶段至少同时对照：

- `references/assessment-template.md`
- `references/analysis-workflow.md`
- `references/reference-source-patterns.md`
- `references/legado-json-structure.md`
- `references/legado-official-rule-notes.md`

验证阶段必须对照：

- `references/validator-integration.md`
- `references/validation-policy.md`
- `references/failure-diagnosis.md`
- `references/validation-checklist.md`

如果正文链路出现签名、密文、CSR 空壳、浏览器渲染等特殊情况，再补看：

- `examples/README.md`
- `references/webview-behavior-matrix.md`（Legado App / Probe / HTTP 三列行为差异）
- 最相关的本地样例 bundle

## 核心规则

1. 先匿名初探：只判断站点结构、接口路径、是否有反爬、是否需要 WebView。
2. **匿名分析可以继续，最终验收不能只靠匿名。** 只要站点有 `loginUrl` / `enabledCookieJar` / `Authorization` header / `webJs` / `webView` 任一项，最终验证优先登录态。匿名生成结果只能标 `anonymous_candidate` 或高风险，不能标 full pass。用户拒绝登录时可以继续生成，但最终状态必须是 `degraded` / `high-risk`，需要 App 复核。
3. 先完成网站可生成性评估，再进入规则生成。
4. 如果 Browser MCP 与模型推断冲突，以实测为准。
5. 优先服从 `references/legado-official-rule-notes.md` 中的官方规则。
6. 默认只覆盖 `search / detail / toc / content`，除非用户明确要求，否则不要启用发现页。
7. 只要用户反馈导入失败、链路失败、调试失败、报错截图、异常日志，先用 validator 诊断；只有 validator 标记硬边界时才进入人工调试协作。
8. **validator 验证是必经步骤** — 生成 JSON 后必须跑 validator，不能跳过。
9. **validator 失败不是结束** — AI 必须根据证据自动回修，最多循环 5 次。
10. **needsAppReview 才是硬边界** — 只有命中 App/人工边界时才停止自动修。
11. **候选池不代表可用** — `candidates/` 只是候选素材，不能当正式样例引用。
12. **评估可被推翻但必须同步修正** — 后续证据推翻 assessment 时，必须先更新 `assessment.md` 再交付。
13. **输出目录 = 用户任务工作目录** — 禁止写入 skill 安装目录（`~/.claude/skills`、`~/.codex/skills` 或 skill 自身目录）。
14. **validator 生命周期管理** — 见下方规则。
15. **validator-report.json 必须落盘** — 每次 validator 验证必须保存完整 `validator-report.json`（含 phases/error/ruleHits/bodyPreview），不能只写 summary。
16. **Browser MCP ≠ Android WebView** — Browser MCP 是桌面浏览器，不等价于 Android Legado WebView。不得写"Legado App WebView 可渲染"，只能写"浏览器渲染后有正文"。
17. **CSR/WebView 边界优先 android mode** — 遇到正文 CSR/WebView 边界时，先用 `mode=android` 跑 Probe 验证；无 Android 设备时跑 `mode=http` 确认空壳后标 `validator_limitation`，不误判为站点不可用。
18. **交付前文件完整性检查** — 最终交付前必须确认 `runs/<site-slug>/` 下 5 个文件齐全：`assessment.md`、`analysis.md`、`validation-checklist.md`、`validator-report.json`、`validator-summary.md`。缺一不可。
19. **禁止空字符串可选字段** — `book-source.json` 中可选字段要么填有效值，要么删除，不得保留空字符串 `""`。
20. **validator passed ≠ 质量 pass** — validator 只验证技术链路，不验证书源质量。若目录章节 URL 为空、所有章节指向同一全文页、章节无法独立定位、或 TOC 是伪章节，不能标 full pass，只能标 degraded（可导入但阅读体验降级）。
21. **ruleToc.chapterUrl 不得为空** — 多章节时必须能生成稳定且可区分的章节 URL。如果只能全书单页阅读，必须在 summary 中标 degraded，不能说全链路可用。
22. **book-source.json 必须是 JSON 数组** — 即使只有一个书源，也必须用 `[{ ... }]` 包裹。Legado 导入要求顶层为数组，单个对象会导致 `Expected BEGIN_ARRAY but was BEGIN_OBJECT` 错误。

## 输出结构

输出目录必须是用户任务工作目录，不写入 skill 安装目录。
`outputs/<site-slug>/book-source.json` 是唯一默认用户交付物；过程记录只写入 `runs/<site-slug>/`。

```
<用户工作目录>/
  outputs/<site-slug>/book-source.json
  runs/<site-slug>/
    assessment.md
    analysis.md
    validation-checklist.md
    validator-report.json
    validator-summary.md
```

**禁止出现：**
- `legado-book-source-generator/outputs/`
- `legado-book-source-generator/runs/`
- `~/.claude/skills/legado-book-source-generator/outputs/`
- `~/.codex/skills/legado-book-source-generator/outputs/`

如果当前目录是 skill 安装目录，必须先切到用户项目目录；无法判断时询问用户输出目录。

## Android WebView Probe

Android Probe 用于复核 `webView:true` / `webJs` / CSR 页面的正文链路。它运行在真实 Android WebView 上，是 validator 最接近 Legado App 的验证方式。

### 什么情况需要

- 正文页为 CSR（Nuxt/Next.js/Vue 等前端框架渲染）
- 书源使用了 `webView:true` 或 `webJs`
- HTTP/Browser 模式的正文返回空内容或 JS 壳

### 设备环境

**必需：**
- 一台 **打开 USB 调试** 的 Android 真机（或已启动的 Android 模拟器）
- 电脑通过 USB 数据线连接手机
- 电脑上有 `adb`（Android SDK Platform-Tools）

**adb 安装：** 双击 `validator/setup-adb.bat`（自动从 Google 官方下载到 `validator/tools/platform-tools/`）

**Probe 安装与启动：** 双击 `validator/setup-android-probe.bat`（自动安装 APK + 启动 + 端口转发）

### 不插手机的情况

**没有 Android 设备也能生成书源。** 流程如下：

1. AI 正常执行全流程，生成 `book-source.json`
2. 遇到 `webView:true` / `webJs` 的正文时，validator 标记 `needs_app_review` 或 `validator_limitation`
3. AI 交付书源时明确说明：**"搜索/详情/目录已验证通过，正文需要 App 端复核"**
4. **用户操作**：将 `book-source.json` 导入 Legado App → 搜索一本书 → 尝试阅读正文
5. 如果正文正常 → 完成
6. 如果正文失败 → 用户在 Legado App 内打开书源调试 → 截图/复制日志 → 反馈给 AI
7. AI 根据日志回修规则，循环直到正文可用

**AI 必须主动告知用户**：书源已生成但正文未在 Android 设备上验证，需要用户在 App 端测试并反馈结果。

### 结果状态对应

| 场景 | 状态 |
|------|------|
| 无 Android 设备 + CSR 正文 | `validator_limitation` — 需 App 复核 |
| 有 Android 设备 + Probe 通过 | `anonymous_candidate`（有登录态特征）或 `passed` |
| 有 Android 设备 + Probe 失败 | 根据错误自动回修（最多 5 次） |

## Validator 生命周期管理

**禁止无提示隐藏启动 validator。**

### 启动规则

- **每次验证前先探测** `http://localhost:1111/api/sources`（禁止用 `/health`，该端点不存在），已有服务则复用，不重复启动。
- **用户手动启动**：双击 `run.bat`，可见窗口，标题显示地址，Ctrl+C 或关窗口停止。
- **Android Probe 需要 adb**：若找不到 adb，先运行 `validator/setup-adb.bat` 下载官方 Platform-Tools 到 `validator/tools/platform-tools/`，再运行 `validator/setup-android-probe.bat`。
- **AI 启动**：前台运行或后台启动但必须：
  - 在回复中说明服务地址、启动方式、停止方式
  - 若后台启动，记录 PID 到 `runs/<site-slug>/validator.pid`
  - 提供停止命令

### 停止规则

- **AI 本次启动的** → 验证结束后负责关闭
- **用户原本开的** → 不要关
- 停止方式：`stop.bat`（按端口停止）或 `taskkill /PID <pid> /F`

最终回复用户时，根据 validator 结果给一句：
- passed: "已生成 book-source.json，validator 验证通过（无登录态特征 / 已完成登录态验证，全链路成功）。"
- anonymous_candidate: "已生成 book-source.json，匿名验证通过但站点存在登录态/WebView/Cookie 依赖（xxx），不能标可用，需登录态/App 复核。报告见 validator-report.json。"
- degraded: "已生成 book-source.json，技术链路通过但阅读体验降级（原因：xxx）。可导入，但建议 App 端确认章节体验。"
- needs_app_review: "已生成 book-source.json，validator 检测到需 App 复核（原因：xxx）。报告见 validator-report.json。"
- failed_unresolved: "已生成 book-source.json，validator 回修 5 次后仍未通过。报告见 validator-report.json，需人工检查。"
- validator_limitation: "已生成 book-source.json，validator 无法验证 xxx 能力；预期需要 App/WebView 复核。当前不是 full pass，不能标可用。"
- 评估被推翻时追加："注：评估结论已修正（原评 xxx，现因 xxx 改为 yyy）。"

## 详细文档

- **硬阻断规则与风险判断**: [references/policies.md](references/policies.md)
- **完整工作流**: [references/workflow.md](references/workflow.md)
- **交付物格式**: [references/outputs.md](references/outputs.md)
- **评估模板**: [references/assessment-template.md](references/assessment-template.md)
- **分析流程**: [references/analysis-workflow.md](references/analysis-workflow.md)
- **官方规则摘录**: [references/legado-official-rule-notes.md](references/legado-official-rule-notes.md)
- **JSON 结构**: [references/legado-json-structure.md](references/legado-json-structure.md)
- **模式矩阵**: [references/reference-source-patterns.md](references/reference-source-patterns.md)
- **调试协作**: [references/debugging-collaboration.md](references/debugging-collaboration.md)
- **验证清单**: [references/validation-checklist.md](references/validation-checklist.md)
- **样例说明**: [examples/README.md](examples/README.md)
- **Validator 集成**: [references/validator-integration.md](references/validator-integration.md)
- **验证策略**: [references/validation-policy.md](references/validation-policy.md)
- **故障诊断**: [references/failure-diagnosis.md](references/failure-diagnosis.md)
- **WebView 行为矩阵**: [references/webview-behavior-matrix.md](references/webview-behavior-matrix.md)
