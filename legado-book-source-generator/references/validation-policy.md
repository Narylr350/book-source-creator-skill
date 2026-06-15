# 验证策略

## 核心原则

1. **validator 失败不是结束条件** — 失败后 AI 必须先根据证据自动回修
2. **needsAppReview 才是硬边界** — 只有命中 App/人工边界时才停止自动修
3. **pass ≠ 书源可用** — 要看 case 的 expected，预期 error 的 case pass 只说明 validator 正确识别限制
4. **新生成书源必须跑完整链路** — 只跑搜索不能标"可用"

## 自动回修闭环

```
生成初版书源
  ↓
跑 /api/debug/run
  ↓
读 steps、error、bodyPreview、ruleHits
  ↓
判断失败类型 → AI 自动回修
  ↓
再跑 validator
  ↓
循环 2-3 次（避免瞎改）
  ↓
通过 → 交付
未通过 → 标记需复核
```

## 失败类型 → 回修动作

| 失败类型 | 证据来源 | 回修动作 |
|---------|---------|---------|
| URL 没拼对 | error 含 "URL scheme" / "no scheme" | 修 searchUrl/bookUrl/chapterUrl，补 baseUrl |
| 字段没命中 | ruleHits 中某字段 success=false | 修对应规则字段（CSS/JSONPath/Regex） |
| 编码问题 | error 含 "charset" / "编码" / bodyPreview 乱码 | 补 charset 或改编码处理 |
| POST/body 错 | error 含 "POST" / "body" / request.method 不对 | 修请求格式 |
| JSONPath/CSS 错 | error 含 "SelectorParseException" / "PathNotFoundException" | 局部改规则 |
| 重定向未跟随 | response.code=301/302 但 error | 检查是否需要跟随重定向 |
| 内容为空 | contentLength=0 | 检查正文规则是否正确 |

## 硬边界（停止自动修）

以下情况必须停止自动回修，标记 `needs_app_review`：

1. **Cloudflare/Turnstile** — error 或 bodyPreview 含 "Cloudflare" / "Turnstile" / "challenge"
2. **登录/验证码** — 需要登录态或验证码
3. **WebView/App-only** — 需要 Android WebView 执行 JS
4. **付费墙** — 内容需要付费
5. **validator 工具限制** — error 含 "已知限制" / "需 App 复核"

## 循环次数限制

- 最多循环 3 次
- 每次循环必须有明确的回修动作（不能瞎改）
- 3 次后仍未通过 → 标记 `needs_app_review`，附带所有失败证据

## 验收标准

新生成书源必须满足：
- search: status=success, resultCount >= 1
- detail: status=success, name 和 author 有值
- toc: status=success, chapterCount >= 10
- content: status=success, contentLength >= 100

不满足则不能标"可用"。
