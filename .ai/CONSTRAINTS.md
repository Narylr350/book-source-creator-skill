# Constraints

## 代码改动规则

- 每次改动只动必要范围，匹配既有风格；不顺手重构无关代码。
- 修改当前书源产物后必须重新通过对应 rule-check 和验证后端，不能复用旧报告：`book-source.json` 使用 validator，`book-source.js` 使用社区版 App MCP。
- `run-state.json` 由命令写入，禁止手动编辑（有 SHA256 签名）。

## 开发规则

- `legado-book-source-generator/tests/` 下的测试优先：`npm test`
- validator 源码改动后必须 `./gradlew.bat jar` 并部署 jar 到 `legado-book-source-generator/validator/app/`
- validator 和 Probe 的构建命令见 `.ai/VALIDATION.md`
- 不提交 `docs/superpowers/`、临时文件、调试产物
- `docs/compose/`、`docs/superpowers/` 是 ignored 历史计划材料，不作为当前行为事实源；当前事实以源码、测试、`SKILL.md`、`references/` 和 `.ai/` 为准

## 状态演进与旧模式退役

- 当前 canonical 模式是 `bsg.mjs` 工具箱：`init` 创建 run，`toolbox/status/check/source/android/validate` 处理当前问题，`record-assessment` 和 `record-validation` 收敛机器事实，`deliver` 做唯一最终交付审计。
- 旧内部模式不得作为 fallback 保留。普通 CLI、线性状态机命令、旧 validator 客户端判定、旧文档事实源和旧测试契约，如果没有公开兼容理由，必须删除、禁用或改为薄转发到当前工具箱模式。
- 公开兼容入口如果必须保留，只能提示迁移到当前 canonical 命令，不得保留独立实现路径。
- 状态迁移完成标准：新模式是唯一内部实现路径；旧模式相关测试已删除或改为断言新模式；README / `SKILL.md` / `references/` 只描述当前推荐入口；重复事实文档只保留一套 canonical 来源。

## 部署规则

- `.ai/` 是项目维护基线，不是 skill 使用文档
- skill 使用文档在 `legado-book-source-generator/SKILL.md` 和 `references/`
- 项目事实 (tech/constraints/validation) 写入 `.ai/`，skill 流程写入 `references/`
