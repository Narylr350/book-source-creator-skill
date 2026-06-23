# 完整工作流

`outputs/<site-slug>/book-source.json` 是唯一默认用户交付物。过程文档写入 `runs/<site-slug>/`。最终交付由 `bsg.mjs deliver` 审计。

## 工具箱模式

1. 先运行 `init` 创建 run 目录。
2. 运行 `toolbox` 查看场景路由和可用工具。
3. 运行 `status --run <run-dir>` 查看当前状态、`pendingUserAction`、`repairContext`。
4. 按当前问题选择工具；`run --run <run-dir>` 只是可选助手，不是唯一主流程。
5. 交付前必须运行 `deliver --run <run-dir>`。

常见场景路由：

| 场景 | 先读 | 工具 |
|------|------|------|
| 匿名初探 / site-facts | `references/probe-guide.md`, `references/assessment-template.md` | `status`, `check`, `record-assessment` |
| 生成规则 | `references/legado-json-structure.md`, `references/official-rule-pack.json`, `references/legado-source-behavior.md` | `source inspect`, `advance` |
| 验证失败回修 | `references/failure-diagnosis.md`, `references/validation-policy.md`, `references/validator-integration.md` | `record-validation`, `status`, `source inspect` |
| Android / WebView / 登录态 | `references/android-probe-guide.md`, `references/policies.md`, `references/validator-integration.md`, `references/webview-behavior-matrix.md` | `android --run <run-dir>` |

Android、模拟器、登录态、WebView/WebJs、入口反爬复核不要靠命令名自己拼；先读 `references/android-probe-guide.md` 和 `references/policies.md`，再运行 `android --run <run-dir>`。

## 1. 匿名初探 / 登录判定

- 先匿名访问 search/detail/toc/content 四条链路，只判断站点结构、接口路径、是否有反爬、是否需要 WebView。
- 检查登录入口、会员限制、匿名降级、登录后能力变化。
- 如果站点需要登录态且 Android 真机或模拟器在线，先读 `references/android-probe-guide.md`，再使用 Probe 原生登录；Android 不可用时才使用 Browser MCP Cookie 路径。
- 如果搜索/详情/目录入口链路出现验证码、Cloudflare、极验或人机验证，必须写入 `site-facts.json` blocker。脚本会要求用户确认 Android/App 复核或接受入口不完整；不要自行用排行榜/书库替代搜索继续。

## 2. 可生成性评估

- 先把 search/detail/toc/content 四链路写入 `site-facts.json`，再补 `assessment.md` 的证据说明。
- `record-assessment` 从 `site-facts.json` 生成 AUTO 结论区；AI 不写评级、风险标签、full pass、阻塞原因。
- `record-assessment` 通过前不要展示评估摘要，不要询问用户选择，不要继续 `advance`。
- 评级为"可生成"：若 `record-assessment` / `advance` 没有返回 `requiredUserAction`，继续自动生成。
- 评级为"不建议生成"：停下来等用户决策。
- 评估至少覆盖：登录依赖、搜索链路、详情链路、目录链路、正文链路、反爬/验证码/会员/签名/加密/付费限制。
- VIP、付费、订阅、会员、登录态、Cookie、Authorization、401/403 写入 facts 的 blocker，由脚本推导登录/风险结论。
- 若准备写 `不建议生成`，必须同时写出：为什么 WebView 不适用、为什么更简单的直接提取不适用、哪条链路已经被实测证伪。

使用 `references/assessment-template.md` 作为输出模板。

## 3. 网站分析

固定按以下顺序分析：

1. 搜索
2. 详情
3. 目录
4. 正文

每条链路都要记录：页面入口或触发方式、请求链路或接口来源、稳定抓取依据、风险点、Legado 规则建议。

双样本要求：搜索至少验证两个关键词或两本样书；正文至少验证两个章节。

若正文链路出现签名、密文、CSR 空壳、浏览器渲染正文等情况，必须同时对照：
- `references/analysis-workflow.md`
- `examples/README.md`
- `examples/pattern-api-webview-auth/`（CSR + WebView 完整参考）

使用 `references/analysis-workflow.md` 作为固定结构。

## 4. 生成 Legado JSON

- 优先稳定 API / JSON。其次稳定 HTML。
- 若 Browser MCP 已证明章节页本身可稳定渲染正文，而不稳定点只在直连接口，优先考虑 `WebView`。
- 只有更简单的规则无法表达站点行为时，才加 JS。
- 生成时保持以下文档同步打开：
  - `references/official-rule-pack.json`
  - `references/legado-source-behavior.md`
  - `references/legado-json-structure.md`
  - `references/example-lessons.json`（只用于检查问题，不作为事实）
  - `examples/pattern-api-webview-auth/book-source.json`（复杂站点参考）

至少包含：`bookSourceUrl`、`bookSourceName`、`searchUrl`、`ruleSearch`、`ruleBookInfo`、`ruleToc`、`ruleContent`。

`searchUrl` 和 `ruleSearch.bookList/name/bookUrl` 不能为空。`enabledExplore`、排行榜、书库不能自动替代搜索入口。

使用 `references/legado-json-structure.md` 检查最终 JSON。

生成完成后 `advance` 会运行 official-rule-pack 校验并写 `rule-check.json`。失败时先修书源，不进入 validator。

## 5. Validator 验证

生成 `book-source.json` 后，必须用 `bsg.mjs validate --run runs/<slug>` 跑真实链路验证，自动写入 `validator-report.json`。重试次数和状态判定由 `bsg.mjs record-validation` 强制管理；`record-validation` 不接受手写 report 或外部 report 路径。

PC HTTP / Browser 验证是开发辅助，不是最终交付事实。`record-validation` 看到非 Android `passed` 时，会先要求确认 Android 真机或模拟器：有设备就运行 `android --run <run-dir>`，没有设备必须让用户明确确认后才降级记录，不能宣称 full pass。

`record-validation` 会生成 `capability-matrix.json`。最终交付状态只从 matrix、`rule-check.json` 和 run-state 推导；不要把局部链路成功写成 full pass。

**CSR/WebView 边界**：遇到正文可能是 CSR/WebView 时，先读 `references/android-probe-guide.md`，再运行 `android --run <run-dir>`。没有 Android 真机或模拟器时不强制阻塞，但 HTTP/browser 通过只能由 `record-validation` 降级为 `validator_limitation`，交付说明必须标明正文 App/WebView 可靠性未知。

回修依据：
- URL 没拼对 → 修 searchUrl/bookUrl/chapterUrl
- 字段没命中 → 修对应规则字段（CSS/JSONPath/Regex）
- 编码问题 → 补 charset
- POST/body 错 → 修请求格式
- JSONPath/CSS 错 → 局部改规则

使用 `references/validator-integration.md`、`references/validation-policy.md`、`references/failure-diagnosis.md`。

## 6. 人工/App 复核（仅硬边界）

只有以下情况才进入人工/App 复核：
- `record-validation` 收敛为 `needs_app_review`
- validator 标记 `validator_limitation`
- validator 标记 `failed_unresolved`（收敛失败）

使用 `references/debugging-collaboration.md`。
