# Legado 书源生成 Skill

面向 `Legado / 阅读` 书源编写场景的 AI Skill 仓库。

它的目标不是收集现成书源，而是把"站点评估 -> 规则生成 -> validator 自动验证 -> AI 自动回修 -> 故障协作"整理成一套可复用、可约束、可测试的工作流，供 AI 在真实站点上稳定执行。

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

## 仓库结构

```text
.
├─ README.md
├─ legado-book-source-generator/
│  ├─ SKILL.md                    # 主入口：强制顺序、核心规则、输出结构
│  ├─ README.txt                  # Release 包使用说明
│  ├─ package.json                # npm scripts
│  ├─ examples/
│  │  ├─ README.md
│  │  ├─ 163zw/                   # 真实闭环样例
│  │  ├─ 69shuba-com/             # 冒烟测试样例（POST搜索、目录嵌详情页）
│  │  ├─ static-html-site/        # 静态HTML样例
│  │  ├─ json-api-site/           # JSON API样例
│  │  ├─ webview-fallback-site/   # WebView回退样例
│  │  └─ login-required-site/     # 需登录样例
│  ├─ references/
│  │  ├─ policies.md              # 硬阻断规则与风险判断
│  │  ├─ workflow.md              # 完整工作流（含 validator 验证）
│  │  ├─ outputs.md               # 交付物格式
│  │  ├─ validator-integration.md # validator API 与状态判定
│  │  ├─ validation-policy.md     # 验证策略与自动回修闭环
│  │  ├─ failure-diagnosis.md     # 故障诊断
│  │  ├─ assessment-template.md   # 可生成性评估模板
│  │  ├─ analysis-workflow.md     # 四链路分析结构
│  │  ├─ legado-json-structure.md # JSON字段要求
│  │  ├─ legado-official-rule-notes.md
│  │  ├─ reference-source-patterns.md
│  │  ├─ debugging-collaboration.md
│  │  └─ validation-checklist.md
│  ├─ scripts/
│  │  ├─ project-helper.mjs       # CLI入口（scaffold / validate）
│  │  ├─ audit-source.mjs         # 静态审计
│  │  ├─ validate-with-validator.mjs  # validator 验证脚本
│  │  └─ lib/
│  │     ├─ slug.mjs              # URL转slug
│  │     ├─ output-bundle.mjs     # 脚手架生成
│  │     ├─ source-validate.mjs   # JSON校验
│  │     └─ source-audit.mjs      # 审计逻辑
│  ├─ tests/
│  │  ├─ project-helper.test.mjs  # 单元测试
│  │  ├─ source-audit.test.mjs    # 审计测试
│  │  └─ blackbox.test.mjs        # 黑盒测试（CLI + 文档契约）
│  └─ validator/                  # 内置 validator（运行包）
│     ├─ run.bat                  # 启动服务
│     ├─ stop.bat                 # 停止服务
│     ├─ README.txt               # validator 使用说明
│     ├─ app/
│     │  └─ legado-source-validator.jar
│     └─ examples/               # 测试样例（sources/cases/candidates）
└─ validator/                     # validator 源码（开发用）
   ├─ src/
   ├─ build.gradle.kts
   └─ examples/
```

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

1. 匿名初探 search/detail/toc/content 四条链路
2. 输出 `assessment.md` 到 `runs/`，立即展示评估摘要
3. 用 Browser MCP 分析搜索、详情、目录、正文
4. 结合官方规则和模式矩阵生成 `book-source.json` 到 `outputs/`
5. 用 validator 跑真实链路验证（`node scripts/validate-with-validator.mjs`）
6. validator 失败时 AI 自动回修规则（最多 3 次）
7. 只有硬边界（验证码/登录/Cloudflare/WebView/付费）才需人工/App 复核

固定评级只有四种：`可直接生成` / `可生成但高风险` / `需登录后再评估` / `不建议生成`

## 安装

### 方式 1：作为 Claude Code Skill

把 [`legado-book-source-generator`](./legado-book-source-generator) 目录复制到你的 Claude Code skills 目录：

```text
~/.claude/skills/legado-book-source-generator/
├─ SKILL.md
├─ agents/
├─ examples/
├─ references/
└─ scripts/
```

### 方式 2：作为 Codex Skill

把目录复制到 `$CODEX_HOME/skills/legado-book-source-generator/`。

### 方式 3：作为仓库直接引用

1. clone 本仓库
2. 让 AI 先阅读 `SKILL.md`
3. 再按顺序加载 `references/`
4. 用 `scripts/` 做脚手架和静态检查

## 环境要求

必需：

- Node.js 18+
- Java 17+（用于 validator）
- 可访问目标网站的网络环境
- Browser MCP 或等价浏览器分析能力

推荐：

- Claude Code / Codex
- Git
- 可导入书源并验证的阅读 App（最终 App 复核用）

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

57 个测试，覆盖三层：

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

| 样例 | 类型 | 关键特征 |
|------|------|----------|
| `163zw/` | 真实闭环 | 完整评估+分析+书源+验收 |
| `69shuba-com/` | 冒烟测试 | POST搜索、目录嵌详情页、纯静态HTML |
| `static-html-site/` | 模板 | CSS选择器直接提取 |
| `json-api-site/` | 模板 | REST接口，JSONPath提取 |
| `webview-fallback-site/` | 模板 | 正文有签名，使用WebView模式 |
| `login-required-site/` | 模板 | 需要登录态才能访问 |

样例不能替代实时站点实测，也不能直接复制到目标站点上套用。

## 限制与风险

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
