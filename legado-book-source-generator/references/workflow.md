# 完整工作流

`outputs/<site-slug>/book-source.json` 是唯一默认用户交付物。过程文档写入 `runs/<site-slug>/`。

## 1. 匿名初探 / 登录判定

- 先匿名访问 search/detail/toc/content 四条链路，记录哪些能通、哪些不能。
- 检查登录入口、会员限制、匿名降级、登录后能力变化。
- **支持登录 ≠ 必须暂停。** 先匿名分析；只有某条必要链路实测需要登录、验证码、付费或用户明确要求登录态内容时，才请求用户协助登录。
- 如果用户选择登录分析，引导其在 Browser MCP 中完成登录，再继续。
- 如果用户选择不登录分析，后续所有评估和生成都要提高风险等级。
- 如果登录无法完成，只允许继续做评估或探索性结果，并明确写出高风险原因。

## 2. 可生成性评估

- 先输出 `assessment.md` 到 `runs/<site-slug>/`。
- **写完后必须立即给用户 3-6 行摘要**（评级 + 关键风险点）。
- 评级只能是以下四种之一：
  - `可直接生成`
  - `可生成但高风险`
  - `需登录后再评估`
  - `不建议生成`
- **摘要展示后自动继续：**
  - 如果结论是"可直接生成"或"可生成但高风险"：继续自动生成，不等用户确认。
  - 如果结论是"需登录后再评估"或"不建议生成"：停下来等用户决策。
- 评估至少覆盖：
  - 登录依赖
  - 搜索链路
  - 详情链路
  - 目录链路
  - 正文链路
  - 反爬、验证码、会员、签名、加密、付费限制
- 若准备写 `不建议生成`，必须同时写出：
  - 为什么 `P15` (`WebView`) 不适用
  - 为什么更简单的直接提取不适用
  - 哪条链路已经被实测证伪
- 如果正文直连失败，但 Browser MCP 已能看到稳定渲染正文，在完成 `WebView` 判定前，默认保持为 `可生成但高风险`。
- **评估可被推翻但必须同步修正：** 后续 Browser MCP、validator、网络请求证据推翻 assessment 时，必须先更新 `assessment.md`，再继续最终交付。

使用 `references/assessment-template.md` 作为输出模板。

## 3. 网站分析

固定按以下顺序分析：

1. 搜索
2. 详情
3. 目录
4. 正文

每条链路都要记录：

- 页面入口或触发方式
- 请求链路或接口来源
- 稳定抓取依据
- 风险点
- Legado 规则建议

双样本要求：

- 搜索至少验证两个关键词或两本样书
- 正文至少验证两个章节

若正文链路出现签名、密文、CSR 空壳、浏览器渲染正文等情况，必须同时对照：

- `references/analysis-workflow.md`
- `references/reference-source-patterns.md`
- `examples/README.md`

使用 `references/analysis-workflow.md` 作为固定结构。

## 4. 生成 Legado JSON

- 优先稳定 API / JSON。
- 其次稳定 HTML。
- 若 Browser MCP 已证明章节页本身可稳定渲染正文，而不稳定点只在直连接口，优先考虑 `WebView`，不要先上重型签名复刻或解密实现。
- 只有更简单的规则无法表达站点行为时，才加 JS。
- 为了兼容阅读导入器，`book-source.json` 顶层必须是 JSON 数组；即使只有一个书源对象，也要写成 `[ { ... } ]`。
- 顶层字段和子规则字段必须与 Legado 的 `BookSource`、`SearchRule`、`BookInfoRule`、`TocRule`、`ContentRule` 对齐。
- 生成时保持以下文档同步打开：
  - `references/legado-official-rule-notes.md`
  - `references/reference-source-patterns.md`
  - `references/legado-json-structure.md`

至少包含：

- `bookSourceUrl`
- `bookSourceName`
- `searchUrl`
- `ruleSearch`
- `ruleBookInfo`
- `ruleToc`
- `ruleContent`

使用 `references/legado-json-structure.md` 检查最终 JSON。

## 5. Validator 验证

生成 `book-source.json` 后，必须用 validator 跑真实链路验证。

```powershell
node scripts/validate-with-validator.mjs outputs/<site-slug>/book-source.json <关键词> http --output runs/<site-slug>
```

**必须保存 `validator-report.json`**（含 phases/error/ruleHits/bodyPreview），不能只写 summary。

**CSR/WebView 边界**：遇到正文可能是 CSR/WebView 时，先跑 `mode=auto` 或 `mode=browser`，失败后再标 `validator_limitation`。不能只跑 `http` 就下结论。

验证分流：

- **passed** → 进入交付
- **failed** → 读 `validator-report.json` 中的 `error`、`ruleHits`、`phases`，AI 自动回修规则，再跑 validator（最多 3 次）
- **needs_app_review** → 停止自动修，标记需 App/浏览器复核
- **validator_limitation** → 标记工具缺口，不误判站点不可用
- **failed_unresolved** → 3 次回修后仍未通过，标记未解决

回修依据：

- URL 没拼对 → 修 searchUrl/bookUrl/chapterUrl
- 字段没命中 → 修对应规则字段（CSS/JSONPath/Regex）
- 编码问题 → 补 charset
- POST/body 错 → 修请求格式
- JSONPath/CSS 错 → 局部改规则

使用 `references/validator-integration.md`、`references/validation-policy.md`、`references/failure-diagnosis.md`。

## 6. 人工/App 复核（仅硬边界）

只有以下情况才进入人工/App 复核：

- validator 标记 `needs_app_review`（Cloudflare、验证码、登录、WebView、付费墙）
- validator 标记 `validator_limitation`（工具不支持的规则能力）
- validator 标记 `failed_unresolved`（3 次回修后仍未通过）

使用 `references/debugging-collaboration.md`。
