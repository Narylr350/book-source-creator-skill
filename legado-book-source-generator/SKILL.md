---
name: legado-book-source-generator
description: Use when 需要分析小说站点并生成 Legado 书源，且要先判断登录、评估可生成性、对照官方规则与辅助文档，再输出可验证的书源结果
---

# Legado 书源生成

## 概述

这个 skill 用来把单个小说站点分析成单个 Legado 书源。

目标站点的 Browser MCP 实测行为和阅读官方规则是事实基线。辅助文档不是“可选附件”，而是生产阶段必须同时对照的参考面板，用来约束输出结构、回退路径和风险判断。

在完成可生成性评估之前，禁止生成 `book-source.json`。

## 生产时必须同时对照的文档

生成阶段至少同时对照以下文档：

- `references/assessment-template.md`
- `references/analysis-workflow.md`
- `references/reference-source-patterns.md`
- `references/legado-json-structure.md`
- `references/legado-official-rule-notes.md`

如果正文链路出现签名、密文、CSR 空壳、浏览器渲染等特殊情况，再补看：

- `examples/README.md`
- 最相关的本地样例 bundle

这些文档在生产时必须同时匹配，不能等到出问题了才回头看。

## 核心规则

1. 先判断站点是否支持登录。
2. 只要站点支持登录，就先硬阻断，明确让用户选择登录还是不登录分析。
3. 在用户做出“登录分析 / 不登录分析”选择之前，不要写 `assessment.md`、`analysis.md`、`book-source.json`。
4. 不能因为站点可匿名访问就默认走匿名分析；若用户选择不登录分析，必须整体按更高风险处理。
5. 如果登录需要扫码、验证码、短信或其他人工确认，立即请求用户协助，不要猜。
6. 先完成网站可生成性评估，再进入规则生成。
7. 如果 Browser MCP 与模型推断冲突，以实测为准，并写明修正原因。
8. 如果结论是 `需登录后再评估` 或 `不建议生成`，继续产出时必须显式标注 `高风险`、继续原因和预期失效链路。
9. 如果正文接口带签名、返回密文，或阅读页只有 CSR 空壳，但 Browser MCP 已能稳定看到渲染后的正文，先按 `可生成但高风险` 处理，并优先评估 `P15` (`WebView`)；不能直接判 `不建议生成`。
10. 如果准备给出 `不建议生成`，必须先明确排除 `references/reference-source-patterns.md` 中更低复杂度的回退路径，尤其是 `P15` (`WebView`) 和直接提取方案。
11. 生成规则时，优先服从 `references/legado-official-rule-notes.md` 中提炼的阅读官方规则，再参考模式矩阵和样例组织方式。
12. 默认只覆盖 `search / detail / toc / content`，除非用户明确要求，否则不要启用发现页。
13. 正常生成时，不要把调试说明塞进 `bookSourceComment`；只有用户反馈失败后才进入调试协作模式。

## 工作流

### 1. 登录判定

- 检查登录入口、会员限制、匿名降级、登录后能力变化，以及搜索 / 详情 / 目录 / 正文是否因登录状态不同而改变。
- 如果站点支持登录，先停下来，让用户选择登录还是不登录分析。
- 如果用户选择登录分析，引导其在 Browser MCP 中完成登录，再继续。
- 如果用户选择不登录分析，后续所有评估和生成都要提高风险等级。
- 如果登录无法完成，只允许继续做评估或探索性结果，并明确写出高风险原因。

### 2. 可生成性评估

- 先输出 `assessment.md`。
- 评级只能是以下四种之一：
  - `可直接生成`
  - `可生成但高风险`
  - `需登录后再评估`
  - `不建议生成`
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

使用 `references/assessment-template.md` 作为输出模板。

### 3. 网站分析

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

### 4. 生成 Legado JSON

- 优先稳定 API / JSON。
- 其次稳定 HTML。
- 若 Browser MCP 已证明章节页本身可稳定渲染正文，而不稳定点只在直连接口，优先考虑 `WebView`，不要先上重型签名复刻或解密实现。
- 只有更简单的规则无法表达站点行为时，才加 JS。
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

### 5. 人工调试协作

只有用户反馈导入失败、链路失败、调试失败或 App 崩溃时，才进入这个模式。

调试时：

- 先把用户带到正确的书源编辑或调试入口
- 只索取当前失败链路所需的最小证据
- 优先要源码、阶段性截图或日志，不要一次性索要全部信息
- 如果有 `loginUrl`，先让用户完成内置登录再调试

使用 `references/debugging-collaboration.md`。

### 6. 手工验证

- 输出 `validation-checklist.md`
- 指导用户导入 `book-source.json` 后至少验证：
  - 搜索能找到目标书
  - 详情能显示元数据
  - 目录能加载
  - 至少两个正文章节能打开
- 若验证失败，回溯到对应链路修规则

使用 `references/validation-checklist.md`。

## 输出物

统一写到 `outputs/<site-slug>/`：

- `assessment.md`
- `analysis.md`
- `book-source.json`
- `validation-checklist.md`

可用脚本：

```powershell
node .\legado-book-source-generator\scripts\project-helper.mjs scaffold-output .\outputs https://example.com
node .\legado-book-source-generator\scripts\project-helper.mjs validate-source .\outputs\example-com\book-source.json
node .\legado-book-source-generator\scripts\audit-source.mjs .\outputs\example-com\book-source.json --keyword 凡人修仙 --page 1
```

`audit-source.mjs` 只做静态审计、占位检测和搜索 URL 预览，不能据此判断最终运行可用性。

## 参考入口

- 评估模板: [references/assessment-template.md](references/assessment-template.md)
- 分析流程: [references/analysis-workflow.md](references/analysis-workflow.md)
- 官方规则摘录: [references/legado-official-rule-notes.md](references/legado-official-rule-notes.md)
- JSON 结构: [references/legado-json-structure.md](references/legado-json-structure.md)
- 模式矩阵: [references/reference-source-patterns.md](references/reference-source-patterns.md)
- 调试协作: [references/debugging-collaboration.md](references/debugging-collaboration.md)
- 验证清单: [references/validation-checklist.md](references/validation-checklist.md)
- 样例说明: [examples/README.md](examples/README.md)
