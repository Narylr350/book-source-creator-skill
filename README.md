# Legado 书源生成 Skill

面向 `Legado / 阅读` 书源编写场景的 AI Skill 仓库。

它的目标不是收集现成书源，而是把“站点评估 -> 规则生成 -> 人工验证 -> 故障协作”整理成一套可复用、可约束、可测试的工作流，供 AI 在真实站点上稳定执行。

## 相关官方入口

- 阅读 App GitHub：<https://github.com/gedoor/legado>
- 阅读官方教程：<https://mgz0227.github.io/The-tutorial-of-Legado/>
- 本仓库主 skill：[`legado-book-source-generator/SKILL.md`](./legado-book-source-generator/SKILL.md)

如果你要分析或生成书源，建议同时打开：

- 阅读 App GitHub，用于确认项目背景与发布入口
- 阅读官方教程，用于确认规则行为
- 本仓库 skill 和 `references/`，用于约束 AI 的执行顺序与输出结构

## 这个仓库解决什么问题

这个仓库主要解决四类问题：

1. AI 不会先判断“这个站到底适不适合做书源”
2. 遇到可登录站点时，AI 会默认匿名分析，遗漏关键能力差异
3. AI 会写出结构像样、实际不可用的规则，或者直接跳到过重的 JS / 解密方案
4. 书源失败后，AI 只会泛泛索要“日志/源码”，不会按阅读 App 的真实调试入口和用户协作

本仓库用文档、样例、辅助脚本和测试把这些问题收成可执行规范。

## 当前约束重点

当前版本的 skill 强制执行以下规则：

- 可登录站点必须先硬阻断，让用户选择“登录分析 / 不登录分析”
- `assessment.md` 必须先于 `book-source.json`
- 生产时必须同时对照辅助文档，不能把 `references/` 当附录
- 正文接口加密、签名、CSR 空壳时，不能直接下 `不建议生成`
- 如果 Browser MCP 已能稳定看到渲染正文，必须先评估 `P15 (WebView)`
- 官方规则优先级高于经验总结、样例组织方式和记忆中的写法

## 仓库结构

```text
.
├─ README.md
├─ legado-book-source-generator/
│  ├─ SKILL.md
│  ├─ agents/
│  │  └─ openai.yaml
│  ├─ examples/
│  │  ├─ README.md
│  │  └─ 163zw/
│  ├─ references/
│  │  ├─ assessment-template.md
│  │  ├─ analysis-workflow.md
│  │  ├─ debugging-collaboration.md
│  │  ├─ legado-json-structure.md
│  │  ├─ legado-official-rule-notes.md
│  │  ├─ reference-source-patterns.md
│  │  └─ validation-checklist.md
│  └─ scripts/
│     ├─ audit-source.mjs
│     ├─ project-helper.mjs
│     └─ lib/
│        └─ source-audit.mjs
```

## 核心文档怎么用

如果你只是第一次接触这个仓库，按这个顺序读：

1. [`legado-book-source-generator/SKILL.md`](./legado-book-source-generator/SKILL.md)
2. [`legado-book-source-generator/references/assessment-template.md`](./legado-book-source-generator/references/assessment-template.md)
3. [`legado-book-source-generator/references/analysis-workflow.md`](./legado-book-source-generator/references/analysis-workflow.md)
4. [`legado-book-source-generator/references/legado-official-rule-notes.md`](./legado-book-source-generator/references/legado-official-rule-notes.md)
5. [`legado-book-source-generator/references/reference-source-patterns.md`](./legado-book-source-generator/references/reference-source-patterns.md)
6. [`legado-book-source-generator/references/legado-json-structure.md`](./legado-book-source-generator/references/legado-json-structure.md)

各文档职责如下：

- `SKILL.md`：主流程、阻断条件、风险判断、输出要求
- `assessment-template.md`：可生成性评估模板
- `analysis-workflow.md`：搜索/详情/目录/正文四链路固定分析结构
- `legado-official-rule-notes.md`：从阅读官方教程提炼的规则要点
- `reference-source-patterns.md`：从样例归纳的模式矩阵与回退路径
- `legado-json-structure.md`：Legado JSON 字段最低要求
- `debugging-collaboration.md`：失败后如何和用户协作调试
- `validation-checklist.md`：导入阅读后的人工验收清单

## 推荐使用流程

标准流程如下：

1. 先判断目标站点是否支持登录
2. 如果支持登录，先让用户选择“登录分析 / 不登录分析”
3. 输出 `assessment.md`
4. 用 Browser MCP 分析搜索、详情、目录、正文
5. 结合官方规则和模式矩阵生成 `book-source.json`
6. 用阅读 App 手工导入验证
7. 若失败，再进入调试协作模式

固定评级只有四种：

- `可直接生成`
- `可生成但高风险`
- `需登录后再评估`
- `不建议生成`

说明：

- 如果正文链路只是“直连失败，但页面能渲染”，优先考虑 `WebView`
- 如果用户选择不登录分析，即使站点可匿名访问，也要按更高风险处理
- 如果准备下 `不建议生成`，必须先排除 `P15 (WebView)` 和更低复杂度方案

## 安装

### 方式 1：作为 Codex Skill

把 [`legado-book-source-generator`](./legado-book-source-generator) 目录复制到你的 Skill 目录：

```text
$CODEX_HOME/skills/legado-book-source-generator/
├─ SKILL.md
├─ agents/
├─ examples/
├─ references/
└─ scripts/
```

### 方式 2：作为其他 AI 的本地技能目录

只要目标 AI 会读取 `SKILL.md`，并且运行时能：

- 访问浏览器工具或等价网页分析工具
- 执行 Node.js 脚本

就可以把整个 `legado-book-source-generator/` 目录按原结构复制过去。

### 方式 3：作为仓库直接引用

如果你不打算安装 skill，也可以直接：

1. clone 本仓库
2. 让 AI 先阅读 `SKILL.md`
3. 再按顺序加载 `references/`
4. 用 `scripts/` 做脚手架和静态检查

## 环境要求

必需：

- Node.js 18+
- 可访问目标网站的网络环境
- Browser MCP 或等价浏览器分析能力
- 可导入书源并验证的阅读 App

推荐：

- Codex / Codex Desktop
- 支持 Skill / Tool 的 AI Agent
- Git

## 辅助脚本

### 输出目录脚手架

```powershell
node .\legado-book-source-generator\scripts\project-helper.mjs scaffold-output .\outputs https://example.com
```

### 结构校验

```powershell
node .\legado-book-source-generator\scripts\project-helper.mjs validate-source .\outputs\example-com\book-source.json
```

### 静态审计

```powershell
node .\legado-book-source-generator\scripts\audit-source.mjs .\outputs\example-com\book-source.json --keyword 凡人修仙 --page 1
```

注意：

- `book-source.json` 提供给阅读导入时，顶层必须是 JSON 数组，即使只有一个书源
- `audit-source.mjs` 只做静态审计、占位检测、嵌入式 JS 语法检查和搜索 URL 预览
- 它不会模拟阅读 App 的完整规则执行
- 静态审计通过，不代表书源运行一定可用

## 样例

当前仓库包含一个闭环样例：

- [`legado-book-source-generator/examples/163zw`](./legado-book-source-generator/examples/163zw)

样例用于展示：

- 输出物目录结构
- 规则组织方式
- 人工验证流程

样例不能替代实时站点实测，也不能直接复制到目标站点上套用。

## 限制与风险

技术上：

- 站点结构、接口、参数、登录机制可能随时变化
- 某些站点存在验证码、反爬、签名、正文加密、会员或付费限制
- AI 可能生成“结构正确但运行错误”的规则

使用上：

- 调试截图、Cookie、Token、登录头可能含敏感信息
- 未验证的书源不应直接分发
- 登录态书源可能存在过期、风控、设备绑定等额外风险

默认不做：

- 发现页
- adb 自动化回归
- 验证码自动化
- 付费绕过

## 合规提醒

本仓库不提供法律意见。使用前请自行评估：

- 目标站点的使用条款
- 内容授权与版权状态
- 是否涉及登录限制、会员限制或付费内容
- 是否会暴露敏感账号信息

不要把本仓库用于绕过付费、权限控制或其他访问限制。
