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

详见 `.ai/TECH.md`。三层架构（Node.js CLI + Kotlin/JVM validator + Android Probe）。

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
6. 用 ciweimao 或其他反爬站点跑一轮完整黑盒，验证 curl HTTP + CAPTCHA_DETECTED + --book-url 链路。
7. 检查 `legado-source-behavior.md` 和 `webview-behavior-matrix.md` 是否与最新验证器行为一致。

## v2.0.0 黑盒实测关键结论

以下已写入对应文档和代码，在此作为长期参考：

- **TLS 指纹检测**：ciweimao 通过 JA3 指纹检测 PC JVM 的 JSSE → validator HTTP 改用 curl (OpenSSL) 绕过。
- **`needs_app_review` 收紧**：验证码/反爬是 `failed`，不是 `needs_app_review`。`needs_app_review` 仅用于 validator 能力不足（sourceRegex 等）。
- **搜索验证码 → `--book-url`**：搜索被验证码阻塞时，用 `--book-url` 跳过搜索直接验证 detail/toc/content。
- **`CAPTCHA_DETECTED` errorCode**：搜索/详情/目录阶段验证码不再走 `APP_REVIEW_REQUIRED` 兜底。
- **features 推导**：`site-facts.json` 的 `features` 区（hasLogin/hasVip/hasCaptcha/hasCloudflare/isAppRequired）现在被 `deriveAssessmentFromFacts` 读取。
- **deliver 重同步 loginFeatures**：deliver 时从 book-source.json 重新同步 loginFeatures，不再用评估阶段的过时状态。
- **UA 完整性**：截断的 UA 会被反爬识别。文档已记录完整 UA 模板。
- **validator ≈ 阅读 App 实测验证**：通过阅读 App 的 WebSocket debug API 远程触发搜索，对比 validator 结果，确认两者在有效登录态下行为一致。
