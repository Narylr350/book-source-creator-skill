# Probe 阶段指南

本文件在 `nextAction: probe_site` 时由 `readNext` 加载。

## Browser MCP 探测规范

必须用 Browser MCP。HTTP fetch 只作辅助。

四条链路每条至少 snapshot 一次：

1. 搜索链路：打开搜索页，输入关键词，snapshot 结果列表
2. 详情链路：点击任一书籍，snapshot 详情页（书名、作者、简介、目录入口）
3. 目录链路：进入目录页，snapshot 章节列表
4. 正文链路：进入两个不同章节，snapshot 正文内容

## 登录墙处理

出现任一情况即停止并询问用户是否可登录：

- 任一页面重定向到 `/login`
- API 返回 401/403
- 页面显示“请先登录”或“需要会员”

停止后不要检查 localStorage，不翻源码，不研究 WebSocket，直接问用户是否可以提供账号或登录协助。

## 入口反爬处理

搜索、详情、目录任一入口链路出现验证码、Cloudflare、极验、人机验证，属于入口链路阻塞。不得自行写“改用排行榜/书库”继续生成；先记录 `site-facts.json` 的 `blocker`，后续由 `record-assessment` / `advance` 生成用户确认或 Android 复核动作。

## site-facts.json 写法

四链路每条一个对象：

| 字段 | 允许值 |
|------|--------|
| `status` | `success` / `blocked` / `failed` |
| `render` | `ssr_or_http` / `csr` / `webview` / `csr_encrypted` |
| `blocker` | 付费、登录、验证码、加密情况，或 `null` |
| `evidenceIds` | 证据 ID 列表，如 `["search-1"]` |

验证码、VIP、加密必须写入 `blocker` 或 `render`，不能只写在自然语言备注里。

## assessment.md 证据区块

AUTO 区块由 `record-assessment` 生成，不要手写 AUTO 区块。

AI 只能在 AUTO 区块外写证据说明：

```md
## 证据说明

- evidence:search-1: 搜索页截图显示...
- evidence:detail-1: 详情页 meta 包含...
```

每条证据 ID 必须在 `site-facts.json` 的 evidence 字段中存在，且被对应链路引用。

## 写完 site-facts.json 后

必须运行 `record-assessment` 后才能向用户展示评估摘要。摘要只引用 AUTO 区块内容，不自行改写结论。
