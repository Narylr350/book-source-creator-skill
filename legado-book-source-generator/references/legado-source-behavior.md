# 阅读源码行为记录

本文件只记录已从阅读源码或明确实现行为确认的边界。官方教程可确认的规则放在 `official-rule-pack.json`，validator 限制放在 `validator-integration.md` / `validation-policy.md`。

## Jsoup 选择器边界

阅读 HTML 规则使用 Jsoup 解析 CSS selector，不支持 jQuery 扩展选择器，例如 `:contains()`、`:has()`、`:eq()`、`:visible`。

处理方式：用标准 CSS 定位节点，再用 `@text`、`@href`、`<js>` 或后处理规则过滤。

## `@css:` 多 action 链限制

`@css:` 模式下多 action 链容易把前面的 `@href` / `@text` 当成 selector 的一部分。需要链式处理时，优先使用普通规则 action + `##$##<js>` 或明确的 JS 后处理。

## User-Agent 完整性

书源 header 里的 User-Agent 必须是完整浏览器 UA。截断的 UA（如只有 `Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36`）缺少引擎名和版本号，会被反爬系统识别为非标准客户端。

完整 UA 模板：`Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36`

反爬系统检查 UA 完整性是常见行为。AI 抄示例时容易漏掉 `(KHTML, like Gecko) Chrome/... Safari/...` 后半截，因为看起来"不重要"。

## 记录原则

- 没有源码或实现证据的经验不写入本文件。
- validator 兼容建议不写入本文件。
- 站点历史样例不写入本文件。
