# 教训：静态 HTML + 分页站点

来源：实测记录

## 必须做

- 先用 Browser MCP 观察 search/detail/toc/content 四条链路，再决定规则结构。站点可能有重定向、Cloudflare 或 JS 渲染，未取得浏览器证据前不要生成规则。
- **目录分页和正文分页经常同时出现**。`nextTocUrl`（目录翻页）和 `nextContentUrl`（同章翻页）不要漏。
- **域名重定向要在 assessment 里告知用户**。如 xbiquge.com → xbiquge.com.cn，不能静默切换。
- **评估摘要必须展示给用户**（3-6 行：评级 + 风险标签 + 4 条链路状态）。

## 不要做

- `:has()` 和 `:contains()` 是 jQuery 选择器，Legado 的 Jsoup **不支持**。替代：`:has()` → parent 选择器，`:contains()` → `@text` action + `<js>` 过滤。
- `@css:selector@action@js:...` 多 action 链会触发 Legado 的 `lastIndexOf('@')` 解析 bug——前面的 `@action` 被当成 CSS 选择器导致 Jsoup 报错。用 `##$##<js>` 替代。
- **不要手动编辑 run-state.json**。SHA256 签名会拒绝。
