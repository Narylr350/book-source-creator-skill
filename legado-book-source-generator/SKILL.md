---
name: legado-book-source-generator
description: Use when 需要分析小说站点并生成 Legado 书源，尤其是在分析网站结构、登录态页面、接口行为或排查解析规则异常时。触发场景：用户给出小说站点 URL 要求生成书源、用户反馈书源导入失败或链路异常需要调试、用户要求评估某站点是否可生成书源。
---

# Legado 书源生成

把单个小说站点分析成单个 Legado 书源。

目标站点的 Browser MCP 实测行为和阅读官方规则是事实基线。

## 强制顺序

```
登录判定 → 可生成性评估 → 网站分析 → 生成 JSON → 人工验证 → 故障协作(按需)
```

**禁止跳步。** 在完成可生成性评估之前，禁止生成 `book-source.json`。

## 生产时必须同时对照的文档

生成阶段至少同时对照：

- `references/assessment-template.md`
- `references/analysis-workflow.md`
- `references/reference-source-patterns.md`
- `references/legado-json-structure.md`
- `references/legado-official-rule-notes.md`

如果正文链路出现签名、密文、CSR 空壳、浏览器渲染等特殊情况，再补看：

- `examples/README.md`
- 最相关的本地样例 bundle

## 核心规则

1. 先判断站点是否支持登录。
2. 只要站点支持登录，就先硬阻断，明确让用户选择登录还是不登录分析。
3. 先完成网站可生成性评估，再进入规则生成。
4. 如果 Browser MCP 与模型推断冲突，以实测为准。
5. 优先服从 `references/legado-official-rule-notes.md` 中的官方规则。
6. 默认只覆盖 `search / detail / toc / content`，除非用户明确要求，否则不要启用发现页。
7. 只要用户反馈导入失败、链路失败、调试失败、报错截图、异常日志，必须立即进入调试协作模式。

## 输出结构

- `outputs/<site-slug>/book-source.json` — 唯一默认用户交付物
- `runs/<site-slug>/` — 过程记录（assessment.md、analysis.md、validation-checklist.md），用于 AI 接力、自检和故障回溯

最终回复用户时，直接给一句："已生成 book-source.json，评估结果是可生成/高风险，导入后验证搜索、目录、正文两章。"

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
