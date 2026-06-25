---
name: legado-book-source-generator
description: Use when 用户要求为任意网站生成书源、生成阅读书源、分析小说站点、生成 Legado/阅读规则。强制触发词：书源、生成书源、帮我生成、book source、legado、阅读书源、小说站点分析。如果用户给出了一个 URL 并要求生成或分析，必须加载此 skill。
---

# Legado 书源生成

这是工具箱模式。先初始化，再按当前问题选择工具；不要把流程当成必须机械执行的长状态机。

```powershell
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
- `android --run <run-dir> --dump-cookie <file>`：显式导出 Probe 原始 Cookie 到本地文件，供人工核对或 validator 调试；默认输出不显示 Cookie 值。
- `android-status`：只读诊断；检查 adb、真机/模拟器和 Android Probe。
- `validate --run <run-dir> [--mode http|browser|android]`：运行 validator，写入 `validator-report.json`。
- `record-validation --run <run-dir> --status <status>`：把真实验证报告收敛成状态、能力矩阵和修复上下文。
- `debug-bundle [--run <run-dir>]`：打包状态、报告、书源和会话导出，方便复盘。
- `run --run <run-dir>`：可选的温和助手；它会启动下一阶段，或在已有 `validator-report.json` 时自动记录验证结果。

## Windows / PowerShell 命令风险

当前默认 shell 是 PowerShell。复制或手写命令时先确认语法属于 PowerShell，不要混用 bash、cmd 和 PowerShell。

常见坑：

- 用 `curl.exe` 调 HTTP，不要用 `curl`；PowerShell 里的 `curl` 可能是 `Invoke-WebRequest` 别名。
- 优先写一行命令。不要混用 bash 的 `\`、cmd 的 `^`、PowerShell 的反引号续行。
- JSON 请求体优先用单引号包住：`-d '{"url":"https://example.com","timeout":60000}'`。复杂 JSON 用 `$body = @{ ... } | ConvertTo-Json -Depth 8`。
- 路径必须加双引号，尤其是中文路径、空格路径和 `<skill-dir>`：`node "D:/.../scripts/bsg.mjs" ...`。
- `Select-String` 没有 `-First`；先匹配再 `| Select-Object -First 3`。
- `Select-Object -Index 40..80` 是错的；要先读数组再用 `$lines[40..80]`。
- `ConvertFrom-Json` 只能吃纯 JSON；命令输出混有日志、提示词或乱码时，先保存/截取纯 JSON 再解析。
- 不确定 shell 写法时，不要临时拼长命令；优先运行 `toolbox`、`android-status`、`android --run`、`validate --run` 这些封装命令。

## Android / WebView 快速配方

遇到登录态、`webView:true`、`webJs`、CSR 正文、入口验证码/反爬复核，或用户已连接真机/模拟器时：

1. 读 `references/android-probe-guide.md`。
2. 运行 `node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir>`。
3. 按它返回的 `requiredUserAction`、`nextCommand` 或 `afterUserCommand` 继续；常规 Android 场景优先跟随这个入口，不自己临时拼 adb、Probe API 或 validator 子步骤。

PC HTTP / Browser 只用于观察站点和辅助写规则。交付前如果 validator 结果不是 Android mode，`record-validation` 会先要求确认 Android 真机或模拟器可用性；用户明确没有设备后才允许降级记录，不能把 PC passed 写成 full pass。

`android --run` 是默认收敛入口，不是所有 Android 问题的唯一调试手段。只有在它返回明确诊断、脚本失败需要定位环境问题、或用户要求调试 Probe/设备时，才展开底层 adb、Probe API 或 validator 子步骤；调试结束后仍回到 `android --run` / `record-validation` 收敛结果。

如果 Probe 登录后自动 Cookie 判断和手机页面状态矛盾，先看 `android --login-completed` 的 `probeCookieEvidence`。仍不清楚时运行 `android --run <run-dir> --dump-cookie "runs/<slug>/cookies.json"`，人工核对域名和 Cookie 名；原始 Cookie 只用于本地调试，不要写进书源。

## 最终审计

交付前必须运行：

```powershell
node "<skill-dir>/scripts/bsg.mjs" deliver --run <run-dir>
```

前提是 `validator-report.json` 已通过 `record-validation` 或 `run` 收敛，并且 `rule-check.json`、`capability-matrix.json` 等产物仍对应当前 `book-source.json`。缺什么让 `deliver` 返回 `nextCommand` / `correctiveAction`，不要自己补结论。

`deliver` 是唯一最终审计。它通过之前，不要宣称书源“可用”、“正常阅读”、“full pass”。

## 硬规则

**0. `bsg.mjs deliver` 返回 ok 是任务完成的唯一标志。没有第三种状态。**

本 skill 的 validator 后端是阅读 App 书源引擎（webBook/analyzeRule/rhino）的 JVM 移植，不是另写一套半成品。**书源能通过 validator + deliver，几乎等价于在阅读 App 里可用。** 这是本 skill 的价值锚点：用户拿到 deliver 通过的书源，导入即用，不会返工。

反过来：**绕过 deliver 交一个 `book-source.json` 文件，无论你已经验证了多少链路、写了多完整的总结表格，都视为未完成。** 用户拿到此书源大概率用不了，必然回来要求返工——你只是把返工成本转嫁给了用户，不是完成了任务。validator 已经等价于阅读 App，所以不存在"validator 过不了但阅读能用"的中间地带可以让你提前交差；过不了就是过不了，去修到过，或诚实地停在 `needs_app_review` / `validator_limitation` 让用户知道限制。

判断你是否在偷懒的自检：如果你正准备"写个总结交付"而不是"运行 deliver"，停下来——你正在制造返工。

**1. `run-state.json` 由命令写入，禁止手动编辑。**

**2. `requiredUserAction` 非 null 时停止自动操作。** 等用户确认后再运行 `resolve-user-action`。

**3. 验证报告生成后不要靠猜测改结论。** validator 报告已经存在时，运行 `record-validation` 或 `run` 收敛状态。

**4. 最终交付事实优先来自 Android。** 桌面 HTTP 或浏览器能看到内容，只能辅助写规则；Android 可用时 passed 必须来自 Android mode，没设备时先问用户并降级说明。

## 红旗

红旗不是穷举禁止动作，是三条判断原则——核心都是"**结论不能强过证据**"。冒出下列任一念头时，先用工具查证再继续：

**A. 证据强度要匹配结论强度。** 未验证的不当已验证，弱证据不下强结论；用"需复核 / 工具限制"归类不能掩盖本可定位的规则错误或证据缺失。
> 常见违反（举例，不限于）：必需链路失败就改用未验证的替代入口继续；`mode=android` 跑过但 `probe_unavailable`，仍当成 Android Probe 证据；规则错误或验证器缺证据，标成 `needs_app_review` / `validator_limitation` 蒙混。

**B. 书源最终在阅读 App 跑，最高权威证据来自 Android / 真机。** 有该环境必须用它取证；没有就如实降级标注，不用低权威环境的"通过"冒充交付结论。
> 常见违反（举例，不限于）：桌面浏览器或 HTTP 能看到内容，就断言 Android WebView / 阅读 App 一定可用；Android 在线却先用 HTTP 验证就交付；没插手机 / 没开模拟器，就直接按 PC passed 交付。

**C. 判定站点性质要用对证据类型，且探测动作本身可能改变站点状态。** 判 SSR/CSR 看 HTTP 原始响应（浏览器看到的是渲染后 DOM，会把 CSR 误判成 SSR）；反复探测同一反爬端点会累积触发风控，探测后才出现的验证码可能是探测副作用、不是站点固有行为。
> 常见违反（举例，不限于）：为判断 SSR/CSR，默认用浏览器 evaluate / JS 自动探测搜索页或登录页；JS / 反复探测后出现验证码，就断言该站天然有验证码。

## 输出

- `outputs/<site-slug>/book-source.json` — 唯一默认交付物
- `runs/<site-slug>/` — 过程记录

deliver 完成后必须运行 `validator-stop` 关闭 validator。
