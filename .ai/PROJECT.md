# Project Baseline

## Goal

本项目当前目标是在已有 Legado/阅读书源生成 skill 仓库中接入 Lightweight AI Project Workflow，建立可长期使用的维护基线。后续维护应能基于本文件、Git 历史和真实验证结果推进，而不是依赖对话记忆。

本仓库本身维护一个面向 AI 的 Legado/阅读书源生成 skill，用于辅助分析用户有权访问的网站结构、生成 `book-source.json`，并通过 validator、Android Probe 和 `deliver` 门禁验证规则可用性。

## Users and Scenarios

主要使用者是维护本仓库的 AI 代理和项目维护者。典型场景包括：接手仓库后判断当前方向、选择下一步维护任务、修复 validator 或脚本问题、验证 release 包结构、以及在改动后确认不会破坏书源生成工作流。

下游使用场景是用户给出小说站点 URL 后，AI 通过本 skill 初始化 run、分析 search/detail/toc/content 链路、生成书源、运行验证并交付默认产物。

## MVP

在本仓库接入 Lightweight AI Project Workflow：建立 `.ai/PROJECT.md` 作为长期基线，让后续维护能通过 `project-work` / `project-finish` 按项目事实、验证规则和 seed tasks 接力推进。

本轮初始化不改业务代码、不扩展书源生成能力、不调整发布包结构。

## Inputs and Outputs

主要输入：

- 仓库源码、README、skill 文档、references、docs、样例、测试和 Git 历史。
- 目标站点 URL、站点观察证据、可选登录态、可选 Android 设备环境。
- validator、Android Probe、`bsg.mjs` 等工具产生的真实验证结果。

主要输出：

- 本轮 workflow 接入输出：`.ai/PROJECT.md`。
- 书源生成任务默认输出：`outputs/<site-slug>/book-source.json`。
- 书源生成过程记录：`runs/<site-slug>/` 下的评估、分析、验证报告、能力矩阵和交付审计结果。

## Non-goals

- 本轮不改业务代码、不新增脚手架、不重构已有目录。
- 本项目不是书源分享包，不托管、不缓存、不分发小说内容。
- 不提供绕过验证码、Cloudflare、付费墙、会员权限、DRM 或其他访问控制的能力。
- 不把 PC HTTP/browser 验证通过冒充 Android/App 通过。
- 不把 `.ai/PROJECT.md` 变成长期任务看板；后续任务交接以 Git 和 project-finish 的提交信息为准。

## Tech Direction

保持现有三层技术方向：

- Node.js 负责 skill 工具箱、`bsg.mjs` 命令入口、状态收敛、静态审计和脚本测试。
- Kotlin/JVM validator 负责贴近阅读书源规则语义的链路验证，包括 JS/Rhino、CSS、JSONPath、XPath、Regex 提取，以及 search/detail/toc/content 主要验证链路。
- Android Probe 负责 WebView、WebJs、登录态、CookieJar、CSR 正文等更接近阅读 App 环境的自动化验证。

不把 validator 改成纯 Node 实现；这会降低与阅读规则语义和 Android WebView 行为的贴近度。不把项目退化成纯文档/模板 skill；`record-validation` 和 `deliver` 是降低返工的核心门禁。

## Constraints and Working Rules

- 每次改动只动必要范围，匹配既有风格；不顺手重构无关代码。
- 结论强度必须匹配证据强度；源码和真实工具输出优先于推理。
- `bsg.mjs deliver --run <run-dir>` 返回 ok 是书源生成任务完成的唯一最终标志。
- 修改 `book-source.json` 后必须重新通过 rule-check 和 validator，不能复用旧报告、旧 matrix 或旧 deliver 结论。
- 涉及 WebView、WebJs、登录态、CookieJar 或 App-only 行为时，Android/真机证据优先；没有 Android 环境时只能按工具收敛为降级或限制说明。
- 验证环境需要 Node.js 18+、Java 17+/validator 运行环境；开发 validator 需要 Gradle/Kotlin；开发 Android Probe 需要 Android Gradle/SDK/adb。
- 环境不可用时，AI 先尝试可逆修复；涉及凭据、管理员权限或全局安装时再提示用户。
- 未接入外部执行层 skill。后续如需接入 TDD、diagnosing-bugs、webapp-testing 或 codebase-design，应先由用户明确确认，再更新本节。

## Validation

- 脚本层：在 `legado-book-source-generator` 下运行 `npm test`。
- validator：在 `validator` 下运行 Gradle 测试或构建，并确认 jar 部署到 skill 内置目录的流程仍成立。
- Android Probe：在 `android-probe` 下构建 APK；有设备时用 `bsg.mjs android --run <run-dir>` 验证 WebView 链路。
- 书源交付：必须经过 `record-validation` 收敛，再运行 `bsg.mjs deliver --run <run-dir>`。
- 文档或 workflow-only 改动至少检查 Git diff，确认只影响预期文件。

## Seed Tasks

1. 用 `project-work` 跑一轮仓库状态读取，确认它能正确使用本基线开始后续维护。
2. 跑当前 Node 测试，确认 v2.0.0 工具箱和状态收敛脚本仍通过。
3. 跑 validator 构建或测试，确认 JVM validator 与 README 描述的部署路径一致。
4. 跑 Android Probe 构建，确认 APK 仍可作为 release 包内置探针。
5. 检查 release 包结构，确认 `legado-book-source-generator`、validator、Probe、docs 和样例引用没有断链。
