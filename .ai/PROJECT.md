# Project Baseline

## Goal

本项目当前目标是在已有 Legado/阅读书源生成 skill 仓库中接入 Lightweight AI Project Workflow，建立可长期使用的维护基线。后续维护应能基于本文件、Git 历史和真实验证结果推进，而不是依赖对话记忆。

本仓库维护一个面向 AI 的 Legado/阅读书源生成 skill，用于分析用户有权访问的网站结构。默认生成兼容原版最后版本的 `book-source.json`；用户明确选择社区维护版时可生成 `book-source.js`。两种目标都必须经过各自验证后端和 `deliver` 门禁。

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
- 书源生成任务默认输出：`outputs/<site-slug>/book-source.json`；显式 community JS 目标输出 `outputs/<site-slug>/book-source.js`。
- 书源生成过程记录：`runs/<site-slug>/` 下的评估、分析、验证报告、能力矩阵和交付审计结果。

## Non-goals

- 本轮不改业务代码、不新增脚手架、不重构已有目录。
- 本项目不是书源分享包，不托管、不缓存、不分发小说内容。
- 不提供绕过验证码、Cloudflare、付费墙、会员权限、DRM 或其他访问控制的能力。
- 不把 PC HTTP/browser 验证通过冒充 Android/App 通过。
- 不把 `.ai/PROJECT.md` 变成长期任务看板；后续任务交接以 Git 和 project-finish 的提交信息为准。

## Tech Direction

详见 `.ai/TECH.md`。执行层包括 Node.js CLI、传统 JSON 的 Kotlin/JVM validator 与 Android Probe，以及 community JS 的社区版 App MCP 后端。

## Constraints and Working Rules

详见 `.ai/CONSTRAINTS.md`。核心：`deliver` 是唯一任务完成标志；validator 等价阅读 App；验证码/反爬是 `failed` 不是 `needs_app_review`。

## Validation

详见 `.ai/VALIDATION.md`。脚本测试、validator 构建测试、Probe 构建、书源交付验证流程、dry-run 规则校验。

## Seed Tasks

1. 用 `project-work` 跑一轮仓库状态读取，确认它能正确使用本基线开始后续维护。
2. 跑当前 Node 测试，确认 v2.0.0 工具箱和状态收敛脚本仍通过。
3. 跑 validator 构建或测试，确认 JVM validator 与 README 描述的部署路径一致。
4. 跑 Android Probe 构建，确认 APK 仍可作为 release 包内置探针。
5. 检查 release 包结构，确认 `legado-book-source-generator`、validator、Probe、docs 和样例引用没有断链。
