---
name: legado-book-source-generator
description: Use when 用户要求为任意网站生成书源、生成阅读书源、分析小说站点、生成 Legado/阅读规则。强制触发词：书源、生成书源、帮我生成、book source、legado、阅读书源、小说站点分析。如果用户给出了一个 URL 并要求生成或分析，必须加载此 skill。
---

# Legado 书源生成

这是工具箱模式。先初始化，再按当前问题选择工具；不要把流程当成必须机械执行的长状态机。

```bash
node "<skill-dir>/scripts/bsg.mjs" init <url> [--cwd <输出目录>]
node "<skill-dir>/scripts/bsg.mjs" toolbox
node "<skill-dir>/scripts/bsg.mjs" status --run <run-dir>
```

## 先读哪些 reference

- 常规流程：读 `references/workflow.md`。
- 匿名初探 / site-facts：读 `references/probe-guide.md` 和 `references/assessment-template.md`。
- 生成规则：读 `references/legado-json-structure.md`、`references/official-rule-pack.json`、`references/legado-source-behavior.md`。
- 验证失败回修：读 `references/failure-diagnosis.md`、`references/validation-policy.md`、`references/validator-integration.md`。
- Android、模拟器、登录态、WebView/WebJs、入口反爬复核：必须先读 `references/android-probe-guide.md` 和 `references/policies.md`；需要判断 Probe 与阅读 App 差异时再读 `references/webview-behavior-matrix.md`。

## 常用工具

- `status --run <run-dir>`：看当前阶段、`pendingUserAction`、`repairContext` 和下一步建议。
- `check --run <run-dir>`：检查评估、登录、Android 决策是否缺证据。
- `source inspect --run <run-dir>`：审计当前 `book-source.json` 的风险字段。
- `android --run <run-dir>`：Android 单入口；检查真机/模拟器和 Probe，必要时启动 Probe，运行 `mode=android` 验证并收敛报告。
- `android-status`：只读诊断；检查 adb、真机/模拟器和 Android Probe。
- `validate --run <run-dir> [--mode http|browser|android]`：运行 validator，写入 `validator-report.json`。
- `record-validation --run <run-dir> --status <status>`：把真实验证报告收敛成状态、能力矩阵和修复上下文。
- `debug-bundle [--run <run-dir>]`：打包状态、报告、书源和会话导出，方便复盘。
- `run --run <run-dir>`：可选的温和助手；它会启动下一阶段，或在已有 `validator-report.json` 时自动记录验证结果。

## Android / WebView 快速配方

遇到登录态、`webView:true`、`webJs`、CSR 正文、入口验证码/反爬复核，或用户已连接真机/模拟器时：

1. 读 `references/android-probe-guide.md`。
2. 运行 `node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir>`。
3. 按它返回的 `requiredUserAction`、`nextCommand` 或 `afterUserCommand` 继续；常规 Android 场景优先跟随这个入口，不自己临时拼 adb、Probe API 或 validator 子步骤。

PC HTTP / Browser 只用于观察站点和辅助写规则。交付前如果 validator 结果不是 Android mode，`record-validation` 会先要求确认 Android 真机或模拟器可用性；用户明确没有设备后才允许降级记录，不能把 PC passed 写成 full pass。

`android --run` 是默认收敛入口，不是所有 Android 问题的唯一调试手段。只有在它返回明确诊断、脚本失败需要定位环境问题、或用户要求调试 Probe/设备时，才展开底层 adb、Probe API 或 validator 子步骤；调试结束后仍回到 `android --run` / `record-validation` 收敛结果。

## 最终审计

交付前必须运行：

```bash
node "<skill-dir>/scripts/bsg.mjs" deliver --run <run-dir>
```

前提是 `validator-report.json` 已通过 `record-validation` 或 `run` 收敛，并且 `rule-check.json`、`capability-matrix.json` 等产物仍对应当前 `book-source.json`。缺什么让 `deliver` 返回 `nextCommand` / `correctiveAction`，不要自己补结论。

`deliver` 是唯一最终审计。它通过之前，不要宣称书源“可用”、“正常阅读”、“full pass”。

## 硬规则

**1. `run-state.json` 由命令写入，禁止手动编辑。**

**2. `requiredUserAction` 非 null 时停止自动操作。** 等用户确认后再运行 `resolve-user-action`。

**3. 验证报告生成后不要靠猜测改结论。** validator 报告已经存在时，运行 `record-validation` 或 `run` 收敛状态。

**4. 最终交付事实优先来自 Android。** 桌面 HTTP 或浏览器能看到内容，只能辅助写规则；Android 可用时 passed 必须来自 Android mode，没设备时先问用户并降级说明。

## 红旗

出现以下想法时先用工具查证，不要直接交付：

- “某条必需链路失败，所以用未验证的替代入口继续。”
- “为了判断 SSR/CSR，先用浏览器 evaluate / JS 自动探测搜索页或登录页。”
- “JS/浏览器探测后出现验证码，所以直接断言站点天然验证码。”
- “桌面浏览器或 HTTP 能看到内容，所以 Android WebView / 阅读 App 一定可用。”
- “Android 真机或模拟器可用，但先用 HTTP 验证交付。”
- “当前没插手机/没开模拟器，所以直接按 PC passed 交付。”
- “mode=android 跑过，即使 probe_unavailable，也算 Android Probe 证据。”
- “规则错误或验证器缺证据可以标 needs_app_review / validator_limitation 通过。”

## 输出

- `outputs/<site-slug>/book-source.json` — 唯一默认交付物
- `runs/<site-slug>/` — 过程记录

deliver 完成后必须运行 `validator-stop` 关闭 validator。
