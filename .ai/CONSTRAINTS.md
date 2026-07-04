# Constraints

## 代码改动规则

- 每次改动只动必要范围，匹配既有风格；不顺手重构无关代码。
- 修改 `book-source.json` 后必须重新通过 rule-check 和 validator，不能复用旧报告。
- `run-state.json` 由命令写入，禁止手动编辑（有 SHA256 签名）。

## 开发规则

- `legado-book-source-generator/tests/` 下的测试优先：`npm test`
- validator 源码改动后必须 `./gradlew.bat jar` 并部署 jar 到 `legado-book-source-generator/validator/app/`
- validator 和 Probe 的构建命令见 `.ai/VALIDATION.md`
- 不提交 `docs/superpowers/`、临时文件、调试产物

## 部署规则

- `.ai/` 是项目维护基线，不是 skill 使用文档
- skill 使用文档在 `legado-book-source-generator/SKILL.md` 和 `references/`
- 项目事实 (tech/constraints/validation) 写入 `.ai/`，skill 流程写入 `references/`
