# 验证策略

> **验证产物核心约束**：`validator-report.json` 只对应生成它时的 `book-source.json`。
> 如果需要修改 `book-source.json`，必须按工具返回的 `correctiveAction` 回到 generate / 规则审计语义，
> 修改后重新通过 rule-check 并重跑 validator。不能修改书源后继续复用旧 report、matrix 或 deliver 结论。

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

以下情况必须停止自动回修，并按 `record-validation` 返回的 `blockedBy` / `requiredUserAction` / `correctiveAction` 收敛；不要手工把不同边界统一改写成 `needs_app_review`：

> 分级标签说明：`[source]` 来自 validator/阅读源码或代码强约束；`[blackbox]` 实测站点/链路观察；`[heuristic]` 启发式判断（有出口、可被用户确认放行）；`[action]` 操作命令。弱模型读到 `[heuristic]` 时不应当作铁律。

1. `[blackbox] [action]` **Cloudflare/Turnstile** — error 或 bodyPreview 含 "Cloudflare" / "Turnstile" / "challenge"。validator 等价于阅读 App，App 也会被 Cloudflare 拦。这是 `failed`，不是 `needs_app_review`。
2. `[blackbox] [action]` **登录/验证码** — 需要登录态或验证码。App 同样会弹验证码。这是 `failed`，不是 `needs_app_review`。如果书源配了登录态（enabledCookieJar + loginUrl + header cookie 注入）但仍失败，检查登录 cookie 是否落在正确域、UA 是否导致重定向到错误子域。
3. `[source] [action]` **WebView/App-only 验证失败** — Android 真机或模拟器可用但未用 Android Probe、Probe 断开、WebView 未渲染、或 WebView 后没有正文提取证据
4. `[heuristic]` ~~**付费墙**~~ — **已降级为软警告**（不再硬阻塞）。`CONTENT_IS_VIP_LOCK_PAGE` 收敛为 `degraded` + `content:vip` 警告，免费/非 VIP 能力可交付。详见下方"VIP 边界"段。
5. `[source]` **生成源含 WebView/WebJs 但未用 Android 验证** — 设备可用时必须用 `mode=android`；HTTP passed 不能作为可用结论
6. `[source]` **Probe 登录态未进入验证请求** — Probe 登录后报告仍是 anonymous 且无 Cookie/Authorization，必须重新注入登录态验证
7. `[source]` **只有 Android mode 但没有正文 WebView 渲染证据** — content 阶段必须有 rendered HTML、截图或 WebView preview；否则按未验证处理
8. `[source]` **只有 WebView 渲染证据但没有整条正文提取证据** — content 阶段必须没有失败 step，并且有 `preview`、`evidence.contentPreview`、`evidence.contentLength` 或 `extracted.contentLength`；否则按正文未验证处理
9. `[source]` **报告已证明是规则错误** — 例如 toc 请求缺 book id、详情字段为空，必须回修规则，不能标 `needs_app_review` / `validator_limitation`
10. `[heuristic]` **正文提取污染** — content success 但 preview 混入重复异常 token、脚本片段、导航/弹窗 chrome 时，必须回修正文规则或 WebView 提取，不能按 passed 交付。基于词表匹配，有误判可能；不确定时由用户确认。
11. `[source] [action]` **最终 passed 不是 Android mode** — PC HTTP/Browser 只辅助写规则；先确认 Android 真机或模拟器，有则运行 `android --run <run-dir>`，没有则由用户明确确认后降级，不能标 full pass

以下情况只有在 `record-validation` 归一化后才可成为 `validator_limitation`，不要由 AI 手工改写：

12. `[source]` **validator 工具限制** — @js 动态 URL、相对路径未拼接、validator 不支持的规则能力
13. `[action]` **Android 不可用导致 WebView 正文无法验证** — 没有 Android 真机或模拟器时不强制阻塞，但 HTTP/browser 通过只能记为 `validator_limitation`，正文可靠性未知，不能标 full pass 或可用

以下情况标记 `failed_unresolved`：

14. `[heuristic]` **收敛失败** — 同一错误连续 5 次未修复（相同 error + 相同失败字段），判定为死循环，停止自动回修。阈值 5 是经验值，搜索命中验证码（`CAPTCHA_DETECTED` → `blocked:captcha`）首次即停，不进入回修循环。

## 验收标准

新生成书源必须满足：
- search: status=success, resultCount >= 1
- detail: status=success, name 和 author 有值
- toc: status=success；chapterCount < 10 时必须确认这是新书/短篇/样本语义，而不是 ruleToc 只取到局部目录
- content: status=success, contentLength >= 100，且 preview 不得混入重复异常 token 或页面脚本/chrome

不满足则不能标"可用"。

验证结果必须通过 `bsg.mjs record-validation` 记录。不能用手工创建的 report/summary 代替。`record-validation` 会生成 `capability-matrix.json`，后续只能从 matrix 判断 search/detail/toc/content 的状态、blocker、render 和 full pass。返回 `blockedBy=android_final_authority_not_used`、`android_probe_not_used`、`android_probe_cookie_not_used`、`android_webview_not_used`、`android_webview_content_not_verified`、`android_device_disconnected`、`hard_rule_error`、`cookie_not_injected`、`content_repeated_noise`、`content_page_chrome` 时按提示补用户动作、凭据或规则后重跑 validator。返回 `requiredUserAction=toc_sample_review` 时，只能在确认短目录是目标书真实状态后运行 `resolve-user-action --action toc_chapter_count_confirmed`。

`CONTENT_IS_VIP_LOCK_PAGE` / VIP / 付费 / 订阅边界不是 selector 错误，也不再作为硬阻塞。`record-validation` 会收敛为 `degraded` 并在 matrix 保留 `content:vip` 警告；可以继续交付免费/非 VIP 能力，但不得写成 full pass、正常阅读全部章节或 VIP 支持。

## 质量门槛

**validator passed ≠ 质量 pass。** validator 只验证技术链路，不验证书源质量。

局部链路成功不等于 full pass。比如 search 被验证码阻断、detail/toc/content 成功时，`capability-matrix.json` 必须是 `partial_candidate`，交付说明不得写成全链路可用。

以下情况不能标 full pass，只能标 degraded（可导入但阅读体验降级）：
- `ruleToc.chapterUrl` 为空
- 所有章节指向同一全文页
- 章节无法独立定位（URL 不可区分）
- TOC 是伪章节（非真实章节列表）

**ruleToc.chapterUrl 检查**：
- 不得为空
- 多章节时必须能生成稳定且可区分的章节 URL
- 如果只能全书单页阅读，必须在 summary 中标 degraded
