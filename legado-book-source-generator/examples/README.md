# 样例目录

本目录仅存放真实站点闭环样例，不存放教学型占位模板。

## 当前样例

- `163zw/`: 163中文网闭环样例 bundle
- `static-html-site/`: 静态HTML站点样例（纯CSS选择器提取）
- `json-api-site/`: JSON API站点样例（REST接口）
- `webview-fallback-site/`: WebView回退样例（正文有签名，使用P15模式）
- `login-required-site/`: 需登录站点样例（登录态访问）

## 使用规则

- 样例用于说明交付结构与规则组织方式。
- 样例不替代目标站点的 Browser MCP 实测。
- 样例可用于静态审计脚本、结构校验脚本和人工导入流程演示。
- 当目标站点因为签名、加密、CSR 空壳或浏览器渲染而接近被判成 `不建议生成` 时，必须先回看样例与 `references/reference-source-patterns.md`，确认是否存在可复用的 fallback 模式，例如 `P15` (`WebView`)。

## 样例分类说明

| 类型 | 场景 | 复杂度 | 关键特征 |
|------|------|--------|----------|
| static-html-site | 纯静态HTML | 低 | CSS选择器直接提取 |
| json-api-site | JSON API | 低 | REST接口，JSONPath提取 |
| webview-fallback-site | WebView回退 | 中 | 正文有签名，使用WebView模式 |
| login-required-site | 需登录 | 中 | 需要登录态才能访问 |
