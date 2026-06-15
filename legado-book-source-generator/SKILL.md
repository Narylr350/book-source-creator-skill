---
name: legado-book-source-generator
description: Use when 需要分析小说站点并生成 Legado 书源，尤其是在分析网站结构、登录态页面、接口行为或排查解析规则异常时。触发场景：用户给出小说站点 URL 要求生成书源、用户反馈书源导入失败或链路异常需要调试、用户要求评估某站点是否可生成书源。
---

# Legado 书源生成

把单个小说站点分析成单个 Legado 书源。

目标站点的 Browser MCP 实测行为和阅读官方规则是事实基线。

## 强制顺序

```
登录判定 → 可生成性评估 → 网站分析 → 生成 JSON → validator 验证 → 交付或故障协作
```

**禁止跳步。** 在完成可生成性评估之前，禁止生成 `book-source.json`。

### validator 验证后的分流

```
validator 通过 → 交付 book-source.json + validator-report
validator 失败，有可修证据 → AI 修规则 → 再跑 validator（最多 3 次）
validator 标记 needsAppReview → 停止自动修，标记需 App/浏览器复核
validator 暴露工具能力缺口 → 标记 validator limitation，不误判站点不可用
validator 失败且证据不足 → 用 Browser MCP 补实测
```

## 生产时必须同时对照的文档

生成阶段至少同时对照：

- `references/assessment-template.md`
- `references/analysis-workflow.md`
- `references/reference-source-patterns.md`
- `references/legado-json-structure.md`
- `references/legado-official-rule-notes.md`

验证阶段必须对照：

- `references/validator-integration.md`
- `references/validation-policy.md`
- `references/failure-diagnosis.md`
- `references/validation-checklist.md`

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
7. 只要用户反馈导入失败、链路失败、调试失败、报错截图、异常日志，先用 validator 诊断；只有 validator 标记硬边界时才进入人工调试协作。
8. **validator 验证是必经步骤** — 生成 JSON 后必须跑 validator，不能跳过。
9. **validator 失败不是结束** — AI 必须根据证据自动回修，最多循环 3 次。
10. **needsAppReview 才是硬边界** — 只有命中 App/人工边界时才停止自动修。
11. **候选池不代表可用** — `candidates/` 只是候选素材，不能当正式样例引用。

## 输出结构

- `outputs/<site-slug>/book-source.json` — 唯一默认用户交付物
- `runs/<site-slug>/` — 过程记录：
  - `assessment.md` — 可生成性评估
  - `analysis.md` — 网站分析
  - `validation-checklist.md` — 验证清单
  - `validator-report.json` — validator 验证报告（Phase 6 新增）
  - `validator-summary.md` — validator 验证摘要（Phase 6 新增）

最终回复用户时，根据 validator 结果给一句：
- passed: "已生成 book-source.json，validator 验证通过（全链路成功）。"
- needs_app_review: "已生成 book-source.json，validator 检测到需 App 复核（原因：xxx）。报告见 validator-report.json。"
- failed_unresolved: "已生成 book-source.json，validator 回修 3 次后仍未通过。报告见 validator-report.json，需人工检查。"
- validator_limitation: "已生成 book-source.json，validator 不支持 xxx 规则能力，需 App 复核。"

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
- **Validator 集成**: [references/validator-integration.md](references/validator-integration.md) (Phase 6)
- **验证策略**: [references/validation-policy.md](references/validation-policy.md) (Phase 6)
- **故障诊断**: [references/failure-diagnosis.md](references/failure-diagnosis.md) (Phase 6)
