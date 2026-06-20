# 网站可生成性评估模板

`assessment.md` 是混合文档：

- AUTO 区块由 `bsg.mjs record-assessment` 从 `site-facts.json` 生成，AI 不得手改。
- `## 证据说明` 和 `## 分析备注` 可由 AI 填写，但证据说明必须引用 `site-facts.json` 或 validator report 中的 `evidence:<id>`。
- 评级、风险标签、四链路状态、full pass、阻塞原因、待确认动作都以 AUTO 区块为准。

```md
# 网站可生成性评估

<!-- AUTO:BEGIN summary -->
<!-- AUTO:HASH pending -->
- 站点 URL: https://example.com
- 评级: 待评估
- 风险标签: 待评估
- 总体状态: pending
- 搜索链路: unknown
- 详情链路: unknown
- 目录链路: unknown
- 正文链路: unknown
- 登录/Android/WebView: 待评估
- 阻塞原因: 待评估
- 待确认动作: 无
<!-- AUTO:END summary -->

## 证据说明

- 搜索链路命中 SSR 列表 evidence:search-1
- 详情页标题和作者来自当前 DOM evidence:detail-1

## 分析备注

- 可写 selector 来源、修正原因、站点风险背景。
- 不写“可正常阅读”“无验证码”“VIP 支持”等结论；这些由 AUTO 区块生成。
```

## site-facts.json

`record-assessment` 运行前，必须先写入四链路事实：

```json
{
  "version": "1.0",
  "siteUrl": "https://example.com",
  "links": {
    "search": { "status": "success", "blocker": null, "render": null, "evidenceIds": ["search-1"] },
    "detail": { "status": "success", "blocker": null, "render": null, "evidenceIds": ["detail-1"] },
    "toc": { "status": "success", "blocker": null, "render": null, "evidenceIds": ["toc-1"] },
    "content": { "status": "success", "blocker": null, "render": "ssr_or_http", "evidenceIds": ["content-1"] }
  },
  "evidence": [
    { "id": "search-1", "phase": "search", "kind": "html", "note": "当前实测证据" }
  ]
}
```

`status` 使用 `success`、`blocked`、`failed`，不能保留 `unknown` 后运行 `record-assessment`。`ok/pass/error` 会被脚本归一化，`available/good/可用` 这类自由词会被拒绝。

`render` 使用事实类型，如 `ssr_or_http`、`csr`、`webview`、`csr_encrypted`。`csr`/`webview` 会推导为 `WebView 依赖`，`encrypted`/`crypto` 会推导为 `加密正文`。

`blocker` 使用阻塞类型，如 `captcha`、`login`、`vip`、`cloudflare`、`encrypt`。不要把风险只写在 `assessment.md` 备注里，必须进入 facts。

## 运行规则

填写或更新后运行：

```bash
node scripts/bsg.mjs record-assessment --run <run-dir>
```

如果 AUTO 区块 hash 不匹配，说明有人手改了结论区；不要继续编辑结论，重新运行 `record-assessment`。如果证据说明没有有效 `evidence:<id>`，先补 `site-facts.json` 证据或改成分析备注。
