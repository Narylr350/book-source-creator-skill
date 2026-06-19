# 验证策略

## 回修动作参考

| 失败类型 | 证据来源 | 回修动作 |
|---------|---------|---------|
| URL 没拼对 | error 含 "URL scheme" / "no scheme" | 修 searchUrl/bookUrl/chapterUrl，补 baseUrl |
| 字段没命中 | ruleHits 中某字段 success=false | 修对应规则字段（CSS/JSONPath/Regex） |
| 编码问题 | error 含 "charset" / bodyPreview 乱码 | 补 charset 或改编码处理 |
| POST/body 错 | error 含 "POST" / "body" / request.method 不对 | 修请求格式 |
| JSONPath/CSS 错 | error 含 "SelectorParseException" / "PathNotFoundException" | 局部改规则 |
| 重定向未跟随 | response.code=301/302 但 error | 检查是否需要跟随重定向 |
| 内容为空 | contentLength=0 | 检查正文规则是否正确 |

## 硬边界（停止自动修）

以下情况必须停止自动回修，标记 `needs_app_review`：

1. **Cloudflare/Turnstile** — error 或 bodyPreview 含 "Cloudflare" / "Turnstile" / "challenge"
2. **登录/验证码** — 需要登录态或验证码
3. **WebView/App-only** — 需要 WebView 但 Android Probe 不可用或验证失败
4. **付费墙** — 内容需要付费
5. **生成源含 WebView/WebJs 但未用 Android 验证** — 设备可用时必须用 `mode=android`；HTTP passed 不能作为可用结论

以下情况标记 `validator_limitation`（不是 `needs_app_review`）：

6. **validator 工具限制** — @js 动态 URL、相对路径未拼接、validator 不支持的规则能力

以下情况标记 `failed_unresolved`：

7. **收敛失败** — 同一错误连续 5 次未修复（相同 error + 相同失败字段），判定为死循环，停止自动回修

## 验收标准

新生成书源必须满足：
- search: status=success, resultCount >= 1
- detail: status=success, name 和 author 有值
- toc: status=success, chapterCount >= 10
- content: status=success, contentLength >= 100

不满足则不能标"可用"。

验证结果必须通过 `bsg.mjs record-validation` 记录。不能用手工创建的 report/summary 代替。返回 `blockedBy=android_probe_not_used`、`android_device_disconnected`、`cookie_not_injected` 时按提示补用户动作或凭据后重跑 validator。

## 质量门槛

**validator passed ≠ 质量 pass。** validator 只验证技术链路，不验证书源质量。

以下情况不能标 full pass，只能标 degraded（可导入但阅读体验降级）：
- `ruleToc.chapterUrl` 为空
- 所有章节指向同一全文页
- 章节无法独立定位（URL 不可区分）
- TOC 是伪章节（非真实章节列表）

**ruleToc.chapterUrl 检查**：
- 不得为空
- 多章节时必须能生成稳定且可区分的章节 URL
- 如果只能全书单页阅读，必须在 summary 中标 degraded
