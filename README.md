# Legado 书源生成 Skill

面向 `Legado / 阅读` 书源编写场景的 AI Skill 仓库。

下载和使用前请先阅读免责声明。本项目不是书源分享包，不提供内容资源，只是 AI 生成和本地验证 Legado/阅读书源规则的开发辅助工具。

## 这个项目是什么

一个让 AI 自主生成和验证书源的 skill。核心是 validator——基于阅读书源规则语义的 JVM/Kotlin 兼容验证器，实现了规则解析、JS/Rhino 执行、CSS/JSONPath/XPath/Regex 提取和主要验证链路。书源通过 validator + deliver 代表规则层具有较强参考价值，纯 HTTP/SSR 站点通常导入即用。

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

## 环境要求

- Node.js 18+（运行 bsg.mjs 和脚本）
- Java 17+（运行 validator，`init` 自动检测，缺失时提示安装）
- Browser MCP 或等价浏览器分析能力
- 可访问目标网站的网络环境

以上就够跑 HTTP / Browser 模式的 validator，覆盖大多数纯静态站和 API 站（搜索/详情/目录/正文都 SSR 直出）。

### Android Probe（可选，CSR 站点需要）

书源含 `webView:true` / `webJs` 时，正文靠客户端 JS 渲染，HTTP 模式抓到的是空壳 HTML。这时需要 **Android Probe**——一个轻量 APK，只跑一个 WebView 暴露 HTTP API，validator 通过 adb 连接手机自动渲染、执行 JS、提取正文，无需人工点来点去。

**三者关系：**
- **validator HTTP 模式**：快速验证非 CSR 的搜索/详情/目录/正文链路
- **validator Android Probe**：接管手机 WebView 自动验证 CSR 正文（代替人工操作）
- **阅读 App**：最终人工验收——书源导入后正常搜索、阅读，确认体验正常

Probe 比桌面 Browser 模式更接近阅读 App 的 WebView 环境，但仍不等于 100% 通过，最终以阅读 App 实测为准。没有设备时 validator 返回 `validator_limitation`，不是书源失败。

需要 Probe 时：
- 一台打开 USB 调试的 Android 真机，或一个已启动的模拟器
- `adb`（Release 包内含 `setup-adb.bat` 一键下载）
- Release 包内置的 `validator\android-probe.apk`

详细启动命令、手机端设置（各品牌开发者选项位置）、adb 自动查找顺序、端口转发配置见 **[SETUP.md](docs/SETUP.md)**。

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
validator/                       # validator 源码（Kotlin/Gradle）
android-probe/                   # Android WebView Probe 源码（Kotlin/Gradle）
docs/SETUP.md                    # 环境配置详解
docs/webview-behavior-matrix.md  # WebView 行为矩阵（App vs Probe vs Validator 能力对比）
docs/legado-source-behavior.md  # 阅读源码已确认的行为边界
```

开发 validator 后需 `cd validator && .\gradlew.bat jar` 重建，并把 `build/libs/legado-source-validator.jar` 部署到 `legado-book-source-generator/validator/app/`，否则改动不生效。

架构和能力边界参考 [`docs/webview-behavior-matrix.md`](./docs/webview-behavior-matrix.md)（阅读 App / Android Probe / Validator HTTP 三列对比）和 [`docs/legado-source-behavior.md`](./docs/legado-source-behavior.md)（Jsoup 选择器等已确认边界）。

## 限制与风险

- 书源长期可用性取决于目标站点是否改版、加反爬或下线。validator passed 也建议 App 端实测。
- 登录态书源涉及 Cookie/Token，注意隐私安全，不要分发含凭据的书源文件。
- 本项目不绕过验证码、付费墙、Cloudflare、DRM。这些场景标记为 `failed` 或 `degraded`，不是 `needs_app_review`。
