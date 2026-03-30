# Legado 书源生成 Skill

面向 `Legado / 阅读` 书源编写场景的 AI Skill。

这个仓库的目标不是“批量收集书源”，而是为 AI 提供一套可复用的工作流，让它在分析目标站点后，生成结构正确、可调试、可人工验证的 Legado 书源，并在书源失效时能和人类高效协作定位问题。

## 这个仓库解决什么问题

常见问题不是“不会写 JSON”，而是：

- 不知道目标站点是否适合生成书源
- 登录站点分析顺序混乱
- AI 过度依赖示例源，忽略目标站点真实行为
- 书源出问题后，AI 只会泛泛地说“发日志”“发源码”，不会告诉用户去哪里点
- 生成和调试过程缺少统一约束，导致不同 AI 输出不稳定

这个 Skill 的核心就是把这些问题固化成一套可执行规范。

## 核心原则

- AI 对页面结构、接口链路、规则语义的分析是主判断依据。
- Browser MCP 和辅助脚本只用于验证，不替代主分析。
- 正式生成 `book-source.json` 之前，必须先做网站可生成性评估。
- 网站可登录时，优先在登录态下分析。
- 如果登录需要扫码、验证码、短信或人工确认，必须立即请求人类协助。
- 默认只做 `搜索 / 详情 / 目录 / 正文`，不默认启用发现页。
- 正常生成时，不在 `bookSourceComment` 中塞调试说明。
- 只有用户反馈失效、导入失败、链路异常或 App 崩溃时，才进入调试模式。

## 功能概览

- 登录判定
- 网站可生成性评估
- 搜索 / 详情 / 目录 / 正文 四段链路分析
- Legado 书源 JSON 生成
- 静态审计脚本
- 输出物脚手架与结构校验
- 面向 Legado 用户的中文调试协作模板
- 真实闭环样例 bundle

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
│  │  ├─ reference-source-patterns.md
│  │  └─ validation-checklist.md
│  └─ scripts/
│     ├─ audit-source.mjs
│     ├─ project-helper.mjs
│     └─ lib/
│        └─ source-audit.mjs
└─ tests/
   ├─ audit-source.test.mjs
   └─ project-helper.test.mjs
```

## 运行环境

### 必需环境

- Node.js 18 或更高版本
- 能访问目标网站的网络环境
- Browser MCP 或等价的浏览器自动化 / 页面检查能力
- 可导入书源并进行实机验证的 Legado App

### 推荐环境

- Codex / Codex Desktop
- 支持 Skill / Tool 调用的 AI Agent
- Git

### 非必需环境

- Python 不是主流程必需环境
- 本仓库主流程、静态审计、结构校验都走 Node.js
- 只有当你自己想运行某些外部 Skill 校验工具时，才可能额外需要 Python

## 安装说明

### 方式 1：作为 Codex Skill 安装

把 [`legado-book-source-generator`](./legado-book-source-generator) 整个目录复制到你的 Skill 目录中，安装后目录应类似：

```text
$CODEX_HOME/skills/legado-book-source-generator/
├─ SKILL.md
├─ agents/
├─ references/
├─ scripts/
└─ examples/
```

如果你的 Codex 环境使用的是其他 Skill 搜索目录，也保持同样的目录结构即可，关键是 `SKILL.md` 必须位于 `legado-book-source-generator/` 根目录。

### 方式 2：作为 Claude Code / 其他支持 Skill 的 AI 安装

把 [`legado-book-source-generator`](./legado-book-source-generator) 目录复制到该 AI 所使用的 Skill 目录下，并确保：

- Skill 系统会读取 `SKILL.md`
- AI 运行时可以调用浏览器工具或等价网页分析工具
- AI 运行时可以执行 Node.js 脚本

如果该 AI 没有标准 Skill 安装机制，也可以直接把 [`SKILL.md`](./legado-book-source-generator/SKILL.md) 作为系统提示或任务参考入口，并同时提供 `references/` 与 `scripts/` 目录。

### 方式 3：不安装，仅作为仓库引用

如果你只是想让其他 AI 参考这套流程：

1. 把仓库 clone 到本地
2. 让 AI 先阅读 [`SKILL.md`](./legado-book-source-generator/SKILL.md)
3. 再按需读取 `references/` 中的对应文档
4. 运行 `scripts/` 下的 Node.js 辅助脚本做结构校验或静态审计

## 使用流程

标准流程固定如下：

1. 判断目标站点是否需要登录
2. 正式生成前先输出网站可生成性评估
3. 用 Browser MCP 分析搜索、详情、目录、正文四条链路
4. 生成 Legado 书源 JSON
5. 导入 Legado 做人工验证
6. 如果失败，再进入调试模式

### 可生成性评级

固定只允许四种评级：

- `可直接生成`
- `可生成但高风险`
- `需登录后再评估`
- `不建议生成`

若评级为 `需登录后再评估` 或 `不建议生成`，仍可继续，但必须明确标为 `高风险`，并写明继续生成的理由与预期失效点。

## 调试协作

本仓库特别强调“AI 如何和人类协作调试”。

调试模式下，AI 不应直接说：

- “把 search_src 发我”
- “发日志”
- “发源码”

而应写成用户能直接照着点的路径，例如：

- `书源管理 -> 对应书源 -> 编辑页 -> 右上角三点 -> 调试源`
- `调试页 -> 右上角三点 -> 搜索源码 / 书籍源码 / 目录源码 / 正文源码`
- `我的 -> 关于 -> 崩溃日志`
- `我的 -> 关于 -> 保存日志`

详细模板见：

- [`references/debugging-collaboration.md`](./legado-book-source-generator/references/debugging-collaboration.md)

## 辅助脚本

### 1. 输出目录脚手架 / 结构校验

```powershell
node .\legado-book-source-generator\scripts\project-helper.mjs scaffold-output .\outputs https://example.com
node .\legado-book-source-generator\scripts\project-helper.mjs validate-source .\outputs\example-com\book-source.json
```

### 2. 静态审计

```powershell
node .\legado-book-source-generator\scripts\audit-source.mjs .\outputs\example-com\book-source.json --keyword 凡人修仙 --page 1
```

说明：

- `audit-source.mjs` 只做静态审计、占位检测和搜索 URL 预览
- 它不会模拟 Legado 的完整运行逻辑
- 不能把静态审计结果当成真实可用性的最终依据

## 测试

```powershell
node --test .\tests\project-helper.test.mjs .\tests\audit-source.test.mjs
```

## 真实样例

当前仓库包含一个真实闭环样例：

- [`examples/163zw`](./legado-book-source-generator/examples/163zw)

样例只用于展示：

- 输出物结构
- 规则组织方式
- 人工验证流程

样例不能替代目标站点的实时分析。

## 风险与限制

### 技术风险

- 目标站点结构、接口、域名、参数、登录机制可能随时变化，生成出来的书源可能失效
- 某些站点存在验证码、反爬、动态签名、会员限制、加密正文或支付章节，可能无法稳定支持
- AI 生成的规则可能“结构正确但运行错误”，仍然需要 Legado 实机验证
- 登录态书源可能涉及过期 Token、Cookie 失效、设备绑定或账户风控

### 使用风险

- 不当分享调试截图、日志、Cookie、Token、登录头，可能泄露个人账号信息
- 直接分发未验证的书源，可能导致他人导入后异常、抓错内容或误判站点状态
- 对高风险站点继续生成书源，可能造成错误调试结论和重复劳动

### 限制

- 默认不生成发现页
- 默认不做 adb 自动化回归
- 默认不处理验证码自动化
- 默认不处理付费章节绕过
- 默认不保证所有登录站都能稳定生成

## 法律与合规说明

本仓库不提供法律意见，使用前请自行评估所在地区法律、目标站点条款与内容授权情况。

请特别注意：

- 遵守目标网站的使用条款、robots 规则、接口限制和登录限制
- 不要将本 Skill 用于绕过付费、会员、权限控制或其他访问限制
- 不要在未经授权的情况下分享他人的账号、Cookie、Token、登录头或日志
- 生成和分发书源前，请确认目标内容的版权、转载、抓取和再分发是否被允许
- 某些网站或内容可能受版权、数据库权利、服务条款或地区性法规保护

如果你打算公开分享基于特定站点生成的书源，请先自行确认：

- 该站点是否允许此类访问与再分发
- 书源中是否含有敏感登录信息
- 书源是否可能访问受限、付费或授权内容

## 适合谁

- 维护 Legado 书源的人
- 想让 AI 协助分析目标站点的人
- 想把“生成书源 + 人工调试”流程标准化的人
- 想给多个 AI 提供统一书源工作流的人

## 不适合谁

- 只想拿现成大合集、完全不做验证的人
- 想用 AI 自动绕过登录、验证码、付费限制的人
- 不愿意在 Legado 里做人工验证与调试的人

## 相关入口

- Skill 主入口：[`legado-book-source-generator/SKILL.md`](./legado-book-source-generator/SKILL.md)
- 调试协作文档：[`references/debugging-collaboration.md`](./legado-book-source-generator/references/debugging-collaboration.md)
- 规则模式矩阵：[`references/reference-source-patterns.md`](./legado-book-source-generator/references/reference-source-patterns.md)
- JSON 结构说明：[`references/legado-json-structure.md`](./legado-book-source-generator/references/legado-json-structure.md)

## 声明

本仓库提供的是一种 AI 工作流与工程化约束，不保证任何具体站点长期可用，也不保证所有生成结果都可直接投入分发。

最终是否可用，以目标站点实时行为、Legado 实机验证结果和使用者自行承担的合规判断为准。
