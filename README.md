# Legado 书源生成 Skill

面向 `Legado / 阅读` 书源编写场景的 AI Skill 仓库。

下载和使用前请先阅读免责声明。本项目不是书源分享包，不提供内容资源，只是 AI 生成和本地验证 Legado/阅读书源规则的开发辅助工具。

## 这个项目的核心是什么

人类做书源的闭环是：凭规则和经验写 → 在阅读 App 的调试模式里跑 → 看 debug 模式显示的每一阶段抓取到的网页源码，对照着判断规则哪里没匹配上 → 修。这套对人类有效，但对 AI 很低效：人机共同 debug 慢、AI 拿到的信息不全、不知道为什么失败就只能瞎猜。

本项目把这个闭环搬到 AI 能独立完成的环境里，核心是一个**验证器（validator）**：

> **validator 是阅读 App 书源引擎（webBook / analyzeRule / rhino）的 JVM 移植，不是另写一套半成品。** 书源能通过 validator，几乎等价于在阅读 App 里可用。

这是整个项目的价值锚点。配套的 `android-probe`（真机 WebView 验证）和 `bsg.mjs`（工具箱 CLI）都服务于同一个目标：**模拟阅读的真实执行，并把人类靠 debug 模式才能看到的每阶段抓取信息（网页源码、规则命中、失败原因），结构化地喂给 AI，让它能自己修。**

只要书源能通过 validator 并走完 `deliver`，导入阅读 App 即可用。

## 设计取向

- **价值锚点是真实执行，不是流程约束。** `bsg.mjs` 是工具箱——先初始化，再按当前问题选工具，不是必须机械走完的长状态机。判定对错的最终依据是 validator 跑出来的客观结果。
- **判定建立在客观证据上，不是关键词猜测。** 页面分类、失败归因尽量来自 validator 的结构化 `errorCode`（对应阅读引擎真实会发生的提取失败），而不是扫描 HTML 文本里的 `vip` / `验证码` 等裸词——后者换个站就失效，还会误判正常页。
- **给弱模型的脚手架，但脚手架要可靠。** 强模型能自主探索、自己判断怎么修；弱模型不会，需要被"推着走"去读对应文档、被门禁挡住偷工。这些脚手架（`nextCommand`、按卡点指路的 `readNext`、`deliver` 门禁）都保留，但都建立在 validator 客观信号上。

## 免责声明

- 本项目不是 Legado/阅读 官方项目，与原 App 作者、维护者及任何站点无从属、授权或背书关系。
- 本项目只用于辅助分析用户有权访问的网站结构，并生成/验证书源规则。
- 本项目不提供、不托管、不缓存、不分发任何小说正文内容。
- 本项目不内置可用侵权书源集合，不是书源分享包。
- 本项目不提供绕过验证码、登录限制、付费墙、会员权限、DRM、Cloudflare、反爬或其他访问控制的能力。
- 对需要登录、验证码、Cloudflare、Android WebView、webJs、CookieJar、付费或 App-only 行为的站点，工具只能标记需复核，不能保证可用。
- 使用者应自行确认目标站点的服务条款、版权状态、访问权限和当地法律法规。
- 生成的书源仅供个人学习、调试和兼容性验证；不得用于侵权传播、批量抓取、商业分发或规避平台限制。
- AI 生成结果可能错误；validator passed 只代表当前技术链路验证通过，不代表长期可用、合法可用或阅读体验完整。

## 相关官方入口

- 阅读 App GitHub：<https://github.com/gedoor/legado>
- 阅读官方教程：<https://mgz0227.github.io/The-tutorial-of-Legado/>
- 本仓库主 skill：[`legado-book-source-generator/SKILL.md`](./legado-book-source-generator/SKILL.md)

## 快速开始

这个项目是给 AI 用的 skill，不是给人手动操作的工具。安装方式：到 GitHub Releases 下载发布包，把里面的 `legado-book-source-generator` 解压到 AI 工具的 skills 目录（也可以让 AI 帮你下载解压）：

| 工具 | 安装路径 |
|------|---------|
| Claude Code | `~/.claude/skills/legado-book-source-generator/` |
| Codex | `$CODEX_HOME/skills/legado-book-source-generator/` |
| 其他 | 对应工具的 skills 目录 |

装好就是对 AI 说：**"帮我给 https://xxx.com 生成书源"**。

AI 的典型流程（工具箱模式，按需取用，非固定顺序）：

```powershell
node "<skill-dir>/scripts/bsg.mjs" init <url>      # 初始化，自动检测 Java/adb 环境
node "<skill-dir>/scripts/bsg.mjs" toolbox         # 看可用工具
# … 分析站点、写规则、生成 book-source.json …
node "<skill-dir>/scripts/bsg.mjs" validate --run <run-dir>          # validator 跑真实链路
node "<skill-dir>/scripts/bsg.mjs" record-validation --run <run-dir> --status <status>
node "<skill-dir>/scripts/bsg.mjs" deliver --run <run-dir>           # 唯一最终审计
```

`deliver` 返回 ok 是任务完成的唯一标志。绕过它交一个 JSON 文件，不算完成。

## 两种补充入口

正常使用都由 AI 驱动，以下只是补充：

- **想脱离 AI 手动验证书源** → Release 包里的 `validator\` 下有 `run.bat` / `stop.bat`，双击启动后浏览器打开 `http://localhost:1111` 导入书源、输入关键词、选模式运行。这几个 `.bat` 只为这种手动场景做兼容，不是主推用法。
- **开发 validator / Android Probe** → clone 本仓库，改 Kotlin 源码后 `cd validator && .\gradlew.bat jar` 重建，并把产物部署回 skill 内置目录（见下文仓库结构）。普通使用者不需要 clone，也不需要本地编译 Gradle。

## 输出结构

```text
outputs/<site-slug>/
  book-source.json          # 唯一默认用户交付物

runs/<site-slug>/           # 过程记录，用于 AI 接力和故障回溯
  assessment.md             # 可生成性评估
  analysis.md               # 网站分析
  validator-report.json     # validator 验证报告
  capability-matrix.json    # 能力矩阵（各链路状态 + blocker）
  validator-summary.md      # 验证摘要
```

## 文档导航

第一次接触，按顺序读：

1. [`SKILL.md`](./legado-book-source-generator/SKILL.md) — 工具箱入口、硬规则、输出要求
2. [`references/workflow.md`](./legado-book-source-generator/references/workflow.md) — 完整工作流
3. [`references/policies.md`](./legado-book-source-generator/references/policies.md) — 硬阻断规则
4. [`references/legado-json-structure.md`](./legado-book-source-generator/references/legado-json-structure.md) — JSON 字段要求
5. [`references/official-rule-pack.json`](./legado-book-source-generator/references/official-rule-pack.json) — 官方规则校验包
6. [`references/validator-integration.md`](./legado-book-source-generator/references/validator-integration.md) — validator API 与 errorCode 详解

验证失败回修读 `references/failure-diagnosis.md`；Android / WebView / 登录态读 `references/android-probe-guide.md`。

## bsg.mjs 自动负责的判断

把可机器判断的部分交给脚本，AI 不必记忆规则：

- **结构完整性**：generate→validate 前检查 chapterUrl webView 声明、webJs 轮询、enabledCookieJar / loginUrl 配套、@text/@href、jQuery 选择器、POST 语法等硬错误。
- **客观失败归因**：validator 真实执行后，按结构化 `errorCode`（选择器空、内容过短、HTTP 阻断、CSR 空壳、VIP 锁页等）定位失败链路和可改字段，而非裸词猜测。
- **反爬熔断 + 登录求助**：链路被弹到人机验证 / Cloudflare / 验证码页时**首次即停**（任何客户端重试都累积触发站点 IP 风控）；未登录先求助用户登录（登录可能解除），已登录仍被拦才收敛 `needs_app_review`。
- **Cookie 跨子域归一**：validator 的 CookieStore 按 eTLD+1 归一（复刻阅读 `getSubDomain`），一次登录的 Cookie 在 `www`/`wap`/`m` 子域间共享。
- **Android Probe 强制**：书源含 webView 且真机/模拟器在线时，最终交付证据必须来自 Android mode，不能用 PC HTTP 的 passed 冒充。
- **收敛与防偷工**：同一错误连续 5 次才停（反爬首次即停）；`deliver` 是唯一成功标志；`run-state.json` 有 SHA256 签名防手动篡改。
- **按卡点指路**：`record-validation` 的 `readNext` 随 blocker 变，把弱模型推到最相关的文档前。

## 环境要求

- Node.js 18+（运行 bsg.mjs 和脚本）
- Java 17+（运行 validator，`init` 自动检测）
- adb + Android 设备 / 模拟器（需要 WebView Probe 时；`init` 自动检测，Release 包内含 `setup-adb.bat` 一键安装）
- Browser MCP 或等价浏览器分析能力
- 可访问目标网站的网络环境

详细 validator 启动、adb 安装、Android Probe 配置见 **[SETUP.md](docs/SETUP.md)**。

## 常用脚本

```powershell
npm test                                              # 运行测试
npm run validate -- .\outputs\example-com\book-source.json     # 校验 JSON 结构
npm run audit -- .\outputs\example-com\book-source.json        # 静态审计
```

注意：`book-source.json` 顶层必须是 JSON 数组；静态审计只做结构检查，不等于运行可用——运行可用以 validator + deliver 为准。

## 样例

| 样例 | 验证状态 | 关键特征 |
|------|---------|----------|
| `pattern-api-webview-auth/` | ✅ App 实测通过 | JSON API + CSR WebView 正文 + CookieJar + 登录态 |
| `pattern-css-pagination/` | ✅ App 实测通过 | CSS 选择器 + JS 内容处理 + 目录分页 |
| `pattern-post-detail-toc/` | ❌ 站已加盾 | POST 搜索语法参考（不可导入） |

样例用于说明交付结构与规则组织方式，**不暴露真实域名，不能直接复制套用**。每个样例目录的 `NOTES.md` 记录了真实生成中踩过的坑。

## 仓库结构

```text
legado-book-source-generator/    # AI Skill 目录（SKILL.md + references + scripts + tests + validator）
validator/                       # validator 源码（Kotlin/Gradle，阅读引擎 JVM 移植）
android-probe/                   # Android WebView Probe 源码（Kotlin/Gradle）
docs/SETUP.md                    # 环境配置详解
```

开发 validator 后需 `cd validator && .\gradlew.bat jar` 重建，并把 `build/libs/legado-source-validator.jar` 部署到 `legado-book-source-generator/validator/app/`，否则改动不生效。

## 限制与风险

- 书源长期可用性取决于目标站点是否改版、加反爬或下线。validator passed 也建议 App 端实测。
- 登录态书源涉及 Cookie/Token，注意隐私安全，不要分发含凭据的书源文件。
- 本项目不绕过验证码、付费墙、Cloudflare、DRM。这些场景标记 `needs_app_review`，需用户自行判断。
