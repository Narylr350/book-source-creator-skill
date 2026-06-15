---
name: legado-book-source-generator
description: Use when 需要分析小说站点并生成 Legado 书源，尤其是在分析网站结构、登录态页面、接口行为或排查解析规则异常时。触发场景：用户给出小说站点 URL 要求生成书源、用户反馈书源导入失败或链路异常需要调试、用户要求评估某站点是否可生成书源。
---

# Legado 书源生成

把单个小说站点分析成单个 Legado 书源。

目标站点的 Browser MCP 实测行为和阅读官方规则是事实基线。

## 强制顺序

```
匿名初探/登录判定 → 可生成性评估 → 立即展示评估摘要 → 网站分析 → 生成 JSON → validator 验证 → AI 自动回修 → 交付 / App 复核 / 工具限制
```

**禁止跳步。** 在完成可生成性评估之前，禁止生成 `book-source.json`。

### 评估摘要展示规则

- 写完 `assessment.md` 后，必须立即给用户 3-6 行摘要（评级 + 关键风险点）。
- 如果结论是"可直接生成"或"可生成但高风险"：继续自动生成，不等用户确认。
- 如果结论是"需登录后再评估"或"不建议生成"：停下来等用户决策。

### 评估可被推翻

- 后续 Browser MCP、validator、网络请求证据推翻 assessment 时，必须先更新 `assessment.md`，再继续最终交付。
- 最终回复必须说明评估结论已修正。

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

1. 先匿名初探 search/detail/toc/content 四条链路。
2. **支持登录 ≠ 必须暂停。** 先匿名分析；只有某条必要链路实测需要登录、验证码、付费或用户明确要求登录态内容时，才请求用户协助登录。
3. 先完成网站可生成性评估，再进入规则生成。
4. 如果 Browser MCP 与模型推断冲突，以实测为准。
5. 优先服从 `references/legado-official-rule-notes.md` 中的官方规则。
6. 默认只覆盖 `search / detail / toc / content`，除非用户明确要求，否则不要启用发现页。
7. 只要用户反馈导入失败、链路失败、调试失败、报错截图、异常日志，先用 validator 诊断；只有 validator 标记硬边界时才进入人工调试协作。
8. **validator 验证是必经步骤** — 生成 JSON 后必须跑 validator，不能跳过。
9. **validator 失败不是结束** — AI 必须根据证据自动回修，最多循环 3 次。
10. **needsAppReview 才是硬边界** — 只有命中 App/人工边界时才停止自动修。
11. **候选池不代表可用** — `candidates/` 只是候选素材，不能当正式样例引用。
12. **评估可被推翻但必须同步修正** — 后续证据推翻 assessment 时，必须先更新 `assessment.md` 再交付。
13. **输出目录 = 用户任务工作目录** — 禁止写入 skill 安装目录（`~/.claude/skills`、`~/.codex/skills` 或 skill 自身目录）。
14. **validator 生命周期管理** — 见下方规则。

## 输出结构

输出目录必须是用户任务工作目录，不写入 skill 安装目录。

```
<用户工作目录>/
  outputs/<site-slug>/book-source.json
  runs/<site-slug>/
    assessment.md
    analysis.md
    validation-checklist.md
    validator-report.json
    validator-summary.md
```

**禁止出现：**
- `legado-book-source-generator/outputs/`
- `legado-book-source-generator/runs/`
- `~/.claude/skills/legado-book-source-generator/outputs/`
- `~/.codex/skills/legado-book-source-generator/outputs/`

如果当前目录是 skill 安装目录，必须先切到用户项目目录；无法判断时询问用户输出目录。

## Validator 生命周期管理

**禁止无提示隐藏启动 validator。**

### 启动规则

- **每次验证前先探测** `http://localhost:1111`，已有服务则复用，不重复启动。
- **用户手动启动**：双击 `run.bat`，可见窗口，标题显示地址，Ctrl+C 或关窗口停止。
- **AI 启动**：前台运行或后台启动但必须：
  - 在回复中说明服务地址、启动方式、停止方式
  - 若后台启动，记录 PID 到 `runs/<site-slug>/validator.pid`
  - 提供停止命令

### 停止规则

- **AI 本次启动的** → 验证结束后负责关闭
- **用户原本开的** → 不要关
- 停止方式：`stop.bat`（按端口停止）或 `taskkill /PID <pid> /F`

最终回复用户时，根据 validator 结果给一句：
- passed: "已生成 book-source.json，validator 验证通过（全链路成功）。"
- needs_app_review: "已生成 book-source.json，validator 检测到需 App 复核（原因：xxx）。报告见 validator-report.json。"
- failed_unresolved: "已生成 book-source.json，validator 回修 3 次后仍未通过。报告见 validator-report.json，需人工检查。"
- validator_limitation: "已生成 book-source.json，validator 无法验证 xxx 能力；预期需要 App/WebView 复核。当前不是 full pass，不能标可用。"
- 评估被推翻时追加："注：评估结论已修正（原评 xxx，现因 xxx 改为 yyy）。"

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
