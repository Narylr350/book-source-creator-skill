# Legado 书源生成 Skill

面向 `Legado / 阅读` 书源编写场景的 AI Skill 仓库。

下载和使用前请先阅读免责声明。本项目不是书源分享包，不提供内容资源，只是 AI 生成和本地验证 Legado/阅读书源规则的开发辅助工具。

它的目标不是收集现成书源，而是把工作流做成**可执行的代码门禁**，而非靠自然语言规范约束 AI。核心是 `bsg.mjs` 工作流状态机——强制阶段顺序、结构完整性检查、收敛检测和交付物验证。AI 负责分析网站和编写规则，脚本负责所有可机器判断的规则。

## 重要免责声明

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

## 这个仓库解决什么问题

1. AI 不会先判断"这个站到底适不适合做书源"
2. 遇到可登录站点时，AI 会默认匿名分析，遗漏关键能力差异
3. AI 会写出结构像样、实际不可用的规则，或者直接跳到过重的 JS / 解密方案
4. 书源失败后，AI 只会泛泛索要"日志/源码"，不会按阅读 App 的真实调试入口和用户协作

本仓库用文档、样例、辅助脚本和测试把这些问题收成可执行规范。

## 输出结构

```text
outputs/<site-slug>/
  book-source.json          # 唯一默认用户交付物

runs/<site-slug>/
  assessment.md             # 可生成性评估（过程记录）
  analysis.md               # 网站分析（过程记录）
  validation-checklist.md   # 验收清单（过程记录）
  validator-report.json     # validator 验证报告
  validator-summary.md      # validator 验证摘要
```

- `outputs/` 只放可交付内容
- `runs/` 放 AI 生成过程、自检、分析记录，用于 AI 接力和故障回溯

## 核心文档怎么用

第一次接触这个仓库，按这个顺序读：

1. [`SKILL.md`](./legado-book-source-generator/SKILL.md) — 主流程、阻断条件、输出要求
2. [`references/policies.md`](./legado-book-source-generator/references/policies.md) — 硬阻断规则
3. [`references/workflow.md`](./legado-book-source-generator/references/workflow.md) — 完整工作流
4. [`references/assessment-template.md`](./legado-book-source-generator/references/assessment-template.md) — 评估模板
5. [`references/legado-official-rule-notes.md`](./legado-book-source-generator/references/legado-official-rule-notes.md) — 官方规则
6. [`references/legado-json-structure.md`](./legado-book-source-generator/references/legado-json-structure.md) — JSON字段要求

## 推荐使用流程

> **AI 执行** = AI 自主完成 &nbsp;|&nbsp; **人类协助** = 需要人类操作

1. **AI** 运行 `bsg.mjs init <url>` 初始化工作流，自动检测 Java/adb 环境
2. **AI** 按 `nextAction` 执行各阶段：`probe → assess → analyze → generate → validate → deliver`
3. **AI** 用 Browser MCP 分析搜索、详情、目录、正文；**人类** 操作浏览器登录（如需要）
4. **AI** 生成 `book-source.json` 到 `outputs/`，`advance` 进入 validate 前自动检查结构完整性（chapterUrl 缺 webView、webJs 无轮询、enabledCookieJar 缺失等硬拦截）
5. **AI** 用 validator 跑真实链路验证，CSR 站点自动要求 Android Probe
6. **AI** validator 失败时自动回修规则（不限次数，同一错误连续 5 次才停止）
7. 只有硬边界（验证码、Cloudflare、付费墙、Android WebView 不可用等）才需 **人类/App** 复核

固定评级：`可生成`（附带风险标签） / `不建议生成`（硬阻断）

## 安装

### 方式 0：作为 AI Skill（推荐）

把 [`legado-book-source-generator`](./legado-book-source-generator) 复制（或 junction）到 AI 工具的 skills 目录：

| 工具 | 安装路径 |
|------|---------|
| Claude Code | `~/.claude/skills/legado-book-source-generator/` |
| Mimo Code | `~/.config/mimocode/skills/legado-book-source-generator/` |
| Codex | `$CODEX_HOME/skills/legado-book-source-generator/` |

安装后对 AI 说：**"帮我给 https://xxx.com 生成书源"**。工作流由 `bsg.mjs`（或 `bsg.bat`）驱动。

### 方式 1：下载 Release 包（人类调试 / 手动验证）

1. 到 GitHub Releases 下载 `legado-book-source-generator-<version>.zip`
2. 解压后进入 `legado-book-source-generator\validator\`
3. 双击 `run.bat`，浏览器打开 `http://localhost:1111`
4. 导入书源 JSON，输入关键词，选择验证模式后运行

`run.bat` 会打开可见窗口，`Ctrl+C` 停止；也可以双击 `stop.bat`。

Release 包里已经包含：

```text
legado-book-source-generator\
  SKILL.md
  bsg.bat
  references\
  scripts\
  tests\
  validator\
    run.bat
    stop.bat
    setup-adb.bat
    setup-android-probe.bat
    android-probe.apk
    app\legado-source-validator.jar
    examples\
```

普通使用者不需要本地编译 Gradle 项目；只有开发 validator 或 Android Probe 时才需要 clone 仓库并构建。

### 方式 2：作为 Codex Skill

把目录复制到 `$CODEX_HOME/skills/legado-book-source-generator/`。

### 方式 3：作为仓库直接引用

1. clone 本仓库
2. 让 AI 先阅读 `SKILL.md`
3. 再按顺序加载 `references/`
4. 用 `scripts/` 做脚手架和静态检查

## 环境要求

- Node.js 18+（运行 bsg.mjs 和脚本）
- Java 17+（运行 validator，`bsg.mjs init` 自动检测，缺失时提示安装）
- adb + Android 设备（需要 WebView Probe 时；`bsg.mjs init` 自动检测，`validator/setup-adb.bat` 一键安装）
- Browser MCP 或等价浏览器分析能力
- 可访问目标网站的网络环境

详细 validator 启动、adb 安装、Android Probe 配置见 **[SETUP.md](docs/SETUP.md)**。

## 辅助脚本

```powershell
# 创建 outputs/<site-slug>/book-source.json
npm run scaffold -- .\outputs https://example.com

# 创建 runs/<site-slug>/ 过程文档
npm run scaffold-run -- .\runs https://example.com

# 校验 JSON
npm run validate -- .\outputs\example-com\book-source.json

# 静态审计
npm run audit -- .\outputs\example-com\book-source.json --keyword 凡人修仙 --page 1

# 运行测试
npm test
```

注意：

- `book-source.json` 提供给阅读导入时，顶层必须是 JSON 数组
- `audit-source.mjs` 只做静态审计，不模拟阅读 App 的完整规则执行
- 静态审计通过，不代表书源运行一定可用

## 测试

```powershell
cd legado-book-source-generator
npm test
```

54 个测试，覆盖三层：

| 层级 | 文件 | 覆盖内容 |
|------|------|----------|
| 单元测试 | `project-helper.test.mjs` | slug生成、JSON校验、脚手架输出 |
| 单元测试 | `source-audit.test.mjs` | JS语法检查、占位检测、风险字段 |
| 黑盒测试 | `blackbox.test.mjs` | CLI命令、交付物结构、文档契约 |

黑盒测试不 import 内部函数，直接跑 `node scripts/project-helper.mjs ...` 验证：
- `scaffold-output` 只生成 `book-source.json`
- `scaffold-run` 只生成过程 md
- `validate` 对合法/非法 JSON 返回正确退出码
- 文档中不得把 md 放在 `outputs/` 下

## 样例

| 样例 | 关键特征 |
|------|----------|
| `pattern-css-pagination/` | CSS 选择器 + JS 内容处理 + 目录分页 |
| `pattern-post-detail-toc/` | POST 搜索、目录嵌详情页、纯静态 HTML |
| `pattern-api-webview-auth/` | JSON API + CSR WebView 正文 + CookieJar + 登录态 |

样例不暴露真实域名，不能直接复制到目标站点上套用。

## 仓库结构

```
legado-book-source-generator/    # AI Skill 目录（SKILL.md + references + scripts + tests + validator）
validator/                       # validator 源码（Kotlin/Gradle）
android-probe/                   # Android WebView Probe 源码（Kotlin/Gradle）
```

详细结构见 [SKILL.md](./legado-book-source-generator/SKILL.md) 和 [SETUP.md](docs/SETUP.md)。

---

## 限制与风险

### 当前已实现的自动检测

- **环境检测**：`bsg.mjs init` 自动检测 Java 和 adb，缺失时给出安装指引。
- **结构完整性检查**：`advance` 进入 validate 前强制检查 chapterUrl 是否带 webView、webJs 是否有轮询等待、enabledCookieJar 是否配置、respondTime 是否设置等。
- **CSR 空壳检测**：`record-validation` 自动识别 Vite/Nuxt/Next.js 前端框架壳，拒绝将 JS 空壳误标为 passed。
- **收敛检测**：同一错误签名连续 5 次未修复时停止自动回修，防止死循环；不同错误无限重试。
- **Android Probe 强制**：写源用了 webView 且有 adb 设备时必须用 Android 模式验证。
- **Cookie 注入检测**：enabledCookieJar 已设但未注入 cookies.json 时拒绝通过。

### 当前已知限制

- Android Probe 需要已连接的 Android 设备或模拟器。
- 复杂 CSR 页面（Nuxt + Cloudflare + 加密）在 Probe WebView 中可能加载缓慢或超时。
- Cloudflare、验证码、付费墙、会员权限、DRM 等访问控制不会被绕过，只能标记 `needs_app_review`。
- `validator passed` 只代表当前技术链路跑通，不代表长期可用性或阅读体验完整。
- 多章节 URL 为空或指向同一页等情况应标记 `degraded`，不能当作完整通过。

### 一般限制与风险

技术上：

- 站点结构、接口、参数、登录机制可能随时变化
- 某些站点存在验证码、反爬、签名、正文加密、会员或付费限制
- AI 可能生成"结构正确但运行错误"的规则

使用上：

- 调试截图、Cookie、Token、登录头可能含敏感信息
- 未验证的书源不应直接分发
- 登录态书源可能存在过期、风控、设备绑定等额外风险

默认不做：

- 发现页
- 登录态 / CookieJar 管理
- 验证码自动化
- 付费绕过

## 合规提醒

本仓库不提供法律意见。使用前请自行评估：

- 目标站点的使用条款
- 内容授权与版权状态
- 是否涉及登录限制、会员限制或付费内容
- 是否会暴露敏感账号信息

不要把本仓库用于绕过付费、权限控制或其他访问限制。对于验证码、Cloudflare、登录态、CookieJar、Android WebView、webJs、付费或 App-only 行为，本项目只能辅助识别并标记需复核，不能保证生成结果可用。
