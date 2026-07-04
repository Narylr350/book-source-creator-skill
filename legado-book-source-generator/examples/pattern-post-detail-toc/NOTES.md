# 教训：POST 搜索站点

⚠️ 此样例未通过手机验证。站点已启用 Cloudflare Turnstile，无法完成 App 实测。书源仅供 POST 搜索语法和选择器结构参考，不可直接导入。

## 必须做

- **POST 搜索正确语法**：`url,{"body":"key={{key}}","method":"POST"}`。`;post=` 简写语法在部分 Legado 版本中不工作，返回 404。
- **详情页嵌目录**时 `tocUrl` 留空或指向详情页自身。不需要单独的 TOC API。
- **加 User-Agent header**。纯 Java HTTP 客户端可能被 Cloudflare 拦截。

## 不要做

- **WebView 不能绕过 Cloudflare Turnstile**。AI 经常误以为加 `webView:true` 就能过验证码——实际是两回事。Turnstile 是硬边界，按 validator / record-validation 证据收敛，不能手工标 `needs_app_review`。
- **Browser MCP 里能看到 ≠ validator HTTP 能拿到**。前者走真实 Chrome，后者走 Java HTTP 客户端，反爬规则不同。
