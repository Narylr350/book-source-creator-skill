# 样例目录

本目录存放经过真实站点闭环验证的书源样例。

## 样例

| 样例 | 复杂度 | 验证状态 | 关键特征 |
|------|--------|---------|----------|
| `pattern-api-webview-auth/` | 高 | ✅ App 实测通过 | JSON API + CSR WebView + 登录态 |
| `pattern-css-pagination/` | 中 | ⚠️ validator 通过 | CSS 选择器 + 分页 |
| `pattern-post-detail-toc/` | 低 | ⚠️ validator 通过 | POST 搜索 + 详情嵌目录 |

## 使用规则

- 样例用于说明交付结构与规则组织方式，不构成对目标站点长期可用性的保证。
- 样例不替代目标站点的 Browser MCP 实测。
- 生成复杂站点的书源时，先找最接近的样例对照结构，但规则必须针对目标站点实测调整。
- 不要在 validator 验证前直接复制样例规则到目标站点。

## 典型场景对照

| 站点特征 | 参考样例 | 踩坑记录 |
|---------|---------|---------|
| 搜索/详情/目录用 JSON API，正文 CSR WebView + 登录 | `pattern-api-webview-auth/` | NOTES.md |
| 纯静态 HTML + CSS 选择器 + 分页 | `pattern-css-pagination/` | NOTES.md |
| POST 搜索 + 详情页内嵌目录 | `pattern-post-detail-toc/` | NOTES.md |

每个样例目录下的 `NOTES.md` 记录了真实生成过程中踩过的坑——生成前先读对应类型的 NOTES。
