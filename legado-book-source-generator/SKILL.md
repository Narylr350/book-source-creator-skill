---
name: legado-book-source-generator
description: Use when 用户要求为任意网站生成书源、生成阅读书源、分析小说站点、生成 Legado/阅读规则。强制触发词：书源、生成书源、帮我生成、book source、legado、阅读书源、小说站点分析。如果用户给出了一个 URL 并要求生成或分析，必须加载此 skill。
---

# Legado 书源生成

**不要手动生成书源。第一步永远是运行 `bsg.mjs init`。跳过脚本直接写 JSON 是违规行为。**

把单个小说站点分析成单个 Legado 书源。工作流由 `bsg.mjs` 强制执行阶段顺序、重试次数、输出目录和交付物完整性。AI 负责分析网站和编写规则，脚本负责门禁——分析可以自由发挥，但流程和输出格式没有自由度。

## 快速开始

**工作流由 `bsg.mjs` 强制执行。每次阶段切换必须通过脚本，禁止手动创建或编辑 run-state.json。run-state.json 只能由 bsg.mjs 命令（init/advance/set-login-features/record-validation/deliver）写入。**

先定位本 SKILL.md 所在目录（即 `<skill-dir>`），然后：

```bash
node "<skill-dir>/scripts/bsg.mjs" init <site-url> [--fast] [--cwd <输出目录>]
```

- 脚本在当前工作目录生成输出。若 skill 在 C: 盘、项目在 D: 盘，用 `--cwd` 指定：`node "<skill-dir>/scripts/bsg.mjs" init <url> --cwd "D:/my-project"`
- 也可用 `bsg.bat`：`"<skill-dir>/bsg.bat" init <url> --cwd "D:/my-project"`
- Windows 跨驱动器完全支持，`--cwd` 解决路径混淆

脚本返回 `nextAction`，AI 严格按指示执行。阶段顺序由 `advance` 命令强制，不可跳步。

**工作流阶段**：`probe → assess → analyze → generate → validate → deliver`

## 输出

- `outputs/<site-slug>/book-source.json` — 唯一默认交付物
- `runs/<site-slug>/` — 过程记录（assessment.md、analysis.md、validator-report.json 等），供 AI 接力与故障回溯

## 快速路径

符合以下**全部**条件时可加 `--fast`（跳过 Browser MCP，直接 HTTP fetch + validator）：

1. 匿名 HTTP fetch 能拿到搜索/详情/目录/正文的**可见文本**（不是 CSR 空壳）
2. 无 Cloudflare / 验证码拦截
3. 无登录需求（或登录为可选项、匿名可用）
4. 无 `webView` / `webJs` / CSR 依赖

快速路径的判断是 AI 的职责。选错路径 validator 会暴露问题，脚本会要求重走完整路径。

## 用户交互

脚本在以下情况返回 `requiredUserAction`，AI 必须停下来等用户：

| 触发条件 | 需要用户做什么 |
|---------|--------------|
| 评级为"不建议生成" | 用户决定是否继续 |
| **评估发现需要 WebView/CSR 但无 Android 设备** | **advance 会在 assess 完成时自动检测。无设备时阻塞并询问用户是否可连接 Android 手机/模拟器。** |
| 需要登录凭据（扫码/Token/Cookie） | 用户完成登录后继续 |
| Android Probe 需要 adb 授权 | 用户在手机上确认 USB 调试 |
| 同一错误连续 5 次未修复（收敛失败） | 用户决定是否人工介入 |

登录凭据采集渠道: 手机扫码 / Token 输入 / Browser MCP 提取 Cookie → 详见 `references/policies.md`

## 核心原则

1. **实测优先** — 如果 Browser MCP 与模型推断冲突，以实测为准，写明修正原因。
2. **官方规则优先** — 生成时优先服从 `references/legado-official-rule-notes.md` 中的官方规则。
3. **候选池不代表可用** — `candidates/` 只是参考素材，不能当正式样例引用。
4. **Browser MCP ≠ Android WebView** — 桌面浏览器不等价于手机 Legado WebView。不得写"Legado App WebView 可渲染"，只能写"浏览器渲染后有正文"。
5. **WebView 不解密** — 正文 API 返回密文但浏览器/WebView 能渲染出正文时，不要分析加密算法或逆向解密。用 `webView: true` + `webJs` 从渲染后的 DOM 提取即可。把"浏览器里能读到正文"直接当成"WebView 可用"的证据，不需要知道怎么解的。
6. **默认只覆盖 search / detail / toc / content** — 除非用户明确要求，否则不启用发现页。
7. **参考样例而非照搬** — `examples/` 下的真实闭环样例展示了完整的站点分析到规则映射过程，生成时对照最接近的样例结构，但规则必须针对目标站点实测调整。

## 参考文档

按工作流阶段需要时加载，一级引用：

| 阶段 | 必读 | 按需 |
|------|------|------|
| probe / assess | `references/policies.md`、`references/assessment-template.md` | |
| analyze | `references/analysis-workflow.md` | `references/webview-behavior-matrix.md`（CSR/WebView 正文）、`examples/README.md` |
| generate | `references/legado-official-rule-notes.md`、`references/legado-json-structure.md` | `examples/README.md`、`examples/<site>/book-source.json` 参考最接近的样例 |
| validate | `references/validator-integration.md`、`references/validation-policy.md` | `references/failure-diagnosis.md`、`references/validation-checklist.md` |
| 调试/复核 | `references/debugging-collaboration.md` | `references/failure-diagnosis.md` |

## Android WebView Probe

**当 loginFeatures 中有 webView 或 webJs 时，验证阶段必须先用 Android Probe，不得直接用 mode=http 标 passed。**

所需环境：adb + Android 设备（USB 调试已开）或模拟器。

执行序列：
1. `bsg.mjs validator-start`（窗口必须可见）
2. `validator/setup-adb.bat`（3 个镜像自动重试，无需手动下载）
3. `validator/setup-android-probe.bat`（安装 APK + 端口转发）
4. `validate-with-validator.mjs <source> <keyword> android --output runs/<slug>/`
6. Android Probe 不可用时：用 mode=http 验证，正文失败标 `validator_limitation`，不得标 passed

设备配置详见 `docs/SETUP.md`。
