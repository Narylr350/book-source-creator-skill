# 站点检查与评估取证

本文件用于初始化后的站点观察、`site-facts.json` 填写和可生成性评估。站点检查不是独立阶段，初始化后直接进入 `assess`。

## Browser MCP 前置条件

Browser MCP 是书源生成任务的必需能力。开始分析目标站点前必须确认当前执行环境提供浏览器导航、页面快照和交互工具。

如果 Browser MCP 未配置：

1. 执行者先安装或配置 Browser MCP。
2. 只有安装授权、客户端重启或更换支持浏览器工具的客户端需要本人操作时，才停下来说明具体动作。
3. Browser MCP 可用前不进入站点分析，不填写页面事实，不生成规则。

## 首轮浏览器操作

1. 用 Browser MCP 打开用户提供的目标 URL。
2. 等待页面完成加载后获取 snapshot。
3. 从页面可见入口依次观察 search、detail、toc、content。
4. 需要接口信息时，从已经发生的浏览器网络请求中定位。
5. 页面发生跳转或交互后重新 snapshot，记录实际 URL、可见内容和阻塞状态。

Browser MCP 证明的是桌面浏览器行为，不等价于 Android WebView 或阅读 App。涉及 WebView、登录态、Cookie 持久化和 App 行为差异时，后续仍需 Android Probe 和 validator 收敛。

## 四链路证据

四条链路都必须取得当前站点证据：

1. 搜索链路：执行一次正常搜索，记录结果列表或阻塞页面。
2. 详情链路：打开一本书，记录书名、作者、简介和目录入口。
3. 目录链路：进入目录，记录章节列表和分页行为。
4. 正文链路：打开至少两个不同章节，记录正文是否稳定出现。

每条链路至少保留一个 evidence ID。无法进入的链路写 `blocked` 或 `failed`，不得用推测补成 `success`。

## 登录墙处理

出现任一情况即停止当前自动操作，并进入登录能力处理：

- 页面重定向到登录入口
- 浏览器网络请求返回 401/403
- 页面显示“请先登录”“需要会员”或同类限制

Android 真机或模拟器在线时，按 `references/android-probe-guide.md` 使用 Probe 登录。只有授权、账号输入、验证码、扫码和安全确认等步骤需要本人参与。

## 入口反爬处理

搜索、详情、目录任一必需入口出现验证码、Cloudflare、极验或人机验证时，立即运行 `observe` 把该链路写为 `status: blocked`、`blocker: captcha|cloudflare`。命令会关闭未观察链路并返回 `record-assessment`；不得继续使用公开直达样本、排行榜、书库或已知 ID 探查或生成。

发现动态请求签名、字体映射/PUA 混淆、加密正文或必须复现站点前端算法时，只记录请求、渲染和内容边界：正文使用 `render: csr_encrypted`，对应阻塞写 `blocker: encrypt`。不要下载或解析字体、逆向签名算法、实现解码器，下一步同样是填写 facts 并运行 `record-assessment`。

## site-facts.json

四链路每条一个对象：

| 字段 | 允许值 |
|------|--------|
| `status` | `success` / `blocked` / `failed` |
| `render` | `ssr_or_http` / `csr` / `webview` / `csr_encrypted` |
| `blocker` | 付费、登录、验证码、加密情况，或 `null` |
| `evidenceIds` | 证据 ID 列表，如 `["search-1"]` |

`features` 可记录 `hasLogin`、`hasVip`、`hasCaptcha`、`hasCloudflare`、`isAppRequired`。验证码、VIP、加密必须进入结构化字段，不能只写在备注里。免费章节可读但目录含 VIP 章节时，记录成功链路的同时保留边界：

```powershell
node "<skill-dir>/scripts/bsg.mjs" observe --run <run-dir> --phase toc --status success --blocker vip --render ssr_or_http --note "Browser MCP 目录含 VIP 章节标识"
```

## assessment.md

AUTO 区块由 `record-assessment` 生成，不要手动编辑。执行者只在 AUTO 区块外写证据说明和分析备注：

```md
## 证据说明

- evidence:search-1 Browser MCP 搜索结果页 snapshot 显示结果列表。
- evidence:detail-1 Browser MCP 详情页 snapshot 显示书名和目录入口。
```

每个 evidence ID 必须在 `site-facts.json` 中存在，并被对应链路引用。完成四链路事实后运行：

```powershell
node "<skill-dir>/scripts/bsg.mjs" record-assessment --run <run-dir>
```

`record-assessment` 通过前不展示评估摘要，不进入规则分析和生成。
