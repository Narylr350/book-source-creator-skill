# book-source-creator-skill

## 中文

一个用于为 Legado 阅读器创建、调试和验证书源的AI Agent skill，核心工作流基于 Browser MCP 的真实网站分析，而不是只靠静态 HTML 猜规则。

- 仓库地址：`https://github.com/Narylr350/book-source-creator-skill`
- Legado 仓库地址：`https://github.com/gedoor/legado`
- 技能包目录：[`book-source-creator/`](./book-source-creator/)
- 示例书源：[`examples/163zw-legado.json`](./examples/163zw-legado.json)

### 项目简介

`book-source-creator-skill` 用来帮助 AI Agent 为 Legado 阅读器创建、调试和验证书源。

这个 skill 的核心思路是：

- 优先用 Browser MCP 查看真实页面
- 优先分析搜索、详情、目录、正文四段链路
- 能登录的网站优先在登录态分析
- 在正式写规则前先做网站可生成性评估
- 脚本只作为辅助验证工具，不作为最终判断依据

### 特性

- Browser MCP 优先，而不是脚本优先
- 支持登录态分析和人工协助登录流程
- 强制要求先做网站可生成性评估
- 支持搜索、详情、目录、正文、多页目录、多页正文等场景
- 提供 Node 版辅助脚本用于校验、审计和模板生成
- 保留 Python 兼容入口，兼容旧调用方式

### 环境要求

- 支持技能机制的 AI Agent 环境
- 可用的 Browser MCP
- 目标小说网站 URL
- 如需运行辅助脚本，建议安装 Node.js
- 用于最终导入验证的 Legado 阅读器
- 如果目标站需要扫码、短信、验证码或二次验证，需要人类协助完成登录

### 安装

把 [`book-source-creator/`](./book-source-creator/) 整个目录放到本地技能目录即可。

常见目录示例：

```text
~/.cc-switch/skills/book-source-creator/
~/.codex/skills/book-source-creator/
```

技能详细说明：

- [`book-source-creator/SKILL.md`](./book-source-creator/SKILL.md)
- [`book-source-creator/README.md`](./book-source-creator/README.md)

### 快速开始

推荐执行顺序：

1. 先判断目标站点是否需要登录
2. 如果需要登录，优先在登录态下分析
3. 在写规则前先输出网站可生成性评估
4. 使用 Browser MCP 验证搜索、详情、目录、正文行为
5. 生成 Legado 书源 JSON
6. 用辅助脚本做结构校验和规则审计
7. 导入 Legado 做实际可用性验证

推荐评估模板：

```markdown
## 网站可生成性评估
- 目标站点：
- 登录状态：
- 搜索可用性：
- 详情可用性：
- 目录可用性：
- 正文可用性：
- 特殊风险：
- 可生成性评级：
- 是否继续生成：
- 继续生成理由 / 停止理由：
```

允许使用的评级：

- `可直接生成`
- `可生成但高风险`
- `需登录后再评估`
- `不建议生成`

其中 `需登录后再评估` 和 `不建议生成` 不是硬阻断，但如果继续推进，必须明确标成 `高风险` 并说明理由。

### 辅助脚本

辅助脚本位于 [`book-source-creator/scripts/`](./book-source-creator/scripts/)：

- `analyze_with_playwright.mjs`
- `validate_source.mjs`
- `test_rules.mjs`
- `generate_template.mjs`

同名 `.py` 文件是兼容入口，会自动转调到对应的 `.mjs` 脚本。

示例命令：

```bash
# 分析网站，支持人工登录后继续
node book-source-creator/scripts/analyze_with_playwright.mjs https://novel-site.com --manual-login --save analysis.json

# 基于分析结果生成模板
node book-source-creator/scripts/generate_template.mjs --analysis analysis.json

# 校验书源结构
node book-source-creator/scripts/validate_source.mjs my_source.json

# 审计规则并预览搜索 URL 替换结果
node book-source-creator/scripts/test_rules.mjs my_source.json --keyword 凡人修仙
```

### 示例资源

仓库当前包含一个实际书源示例：

- 文件：[`examples/163zw-legado.json`](./examples/163zw-legado.json)
- 目标站点：`https://www.163zw.com/`

#### 163中文网书源创建过程

这份 `163中文网` 书源是按下面的流程做出来的：

1. 确认站点当前不需要登录就能访问搜索、详情、目录和正文
2. 先输出网站可生成性评估
3. 用 Browser MCP 搜索 `凡人修仙`，验证结果列表、书名、作者、封面和详情链接
4. 进入详情页，确认书名、作者、封面、简介和目录入口
5. 检查目录页，确认目录存在分页，因此规则中加入 `nextTocUrl`
6. 检查正文页，确认正文是真实文本但单章多页，因此规则中加入 `nextContentUrl`
7. 生成书源 JSON
8. 用辅助脚本做结构校验和规则审计
9. 最后导入 Legado 做实际检查

当前这份样例书源在测试流程里没有发现明显问题，但不代表目标站未来不会改版。

### 验证状态

已验证：

- 这个 skill 已在 Codex 环境中测试成功
- 基于 Browser MCP 的分析流程可正常跑通
- Node 版辅助脚本可运行
- `163中文网` 样例书源已经过一轮实际验证，当前未见明显问题

未验证：

- 其他 AI 工具中的兼容性
- 所有小说站点上的长期稳定性
- 所有登录站点上的一致性表现

### 风险声明

请自行承担使用风险。

- 本项目目前只在 Codex 环境中验证过
- 其他 AI 工具没有系统测试过
- 生成出来的书源依赖第三方网站的实时结构
- 目标站点可能随时修改 HTML、请求链路、反爬策略、分页逻辑或登录流程
- 一个书源某次可用，不代表未来仍然可用
- 仓库中的示例书源只代表某个测试时点的结果，不构成长期可用性保证
- 最终实际表现仍然受 Legado 版本、目标站状态和你自己的验证过程影响
- 你需要自行负责验证、调试和维护实际使用的书源

### 仓库结构

```text
book-source-creator-skill/
  README.md
  examples/
    163zw-legado.json
  book-source-creator/
    SKILL.md
    README.md
    references/
    scripts/
    tests/
```

### 相关链接

- 技能目录：[`book-source-creator/`](./book-source-creator/)
- 技能入口：[`book-source-creator/SKILL.md`](./book-source-creator/SKILL.md)
- 技能说明：[`book-source-creator/README.md`](./book-source-creator/README.md)
- 示例书源：[`examples/163zw-legado.json`](./examples/163zw-legado.json)
- Legado：`https://github.com/gedoor/legado`

---

## English

A Codex skill for creating, debugging, and verifying Legado book sources, with a workflow centered on real website analysis through Browser MCP instead of guessing rules from static HTML alone.

- Repository: `https://github.com/Narylr350/book-source-creator-skill`
- Legado repository: `https://github.com/gedoor/legado`
- Skill package: [`book-source-creator/`](./book-source-creator/)
- Example source: [`examples/163zw-legado.json`](./examples/163zw-legado.json)

### Overview

`book-source-creator-skill` helps Codex create, debug, and verify book sources for Legado.

Its core approach is:

- inspect real pages with Browser MCP
- analyze the full chain of search, detail, TOC, and content pages
- analyze login-state pages first when login is required
- perform a generatability assessment before writing rules
- treat scripts as auxiliary tools rather than the final authority

### Features

- Browser MCP first, not script first
- login-aware workflow with explicit human-assisted login handoff
- mandatory generatability assessment before rule generation
- support for search, detail, TOC, content, paginated TOC, and paginated chapter flows
- Node-based helper scripts for validation, auditing, and template generation
- Python compatibility wrappers for existing entrypoints

### Requirements

- a Codex environment with skill support
- Browser MCP access
- a target novel site URL
- Node.js if you want to run helper scripts locally
- Legado for final import and runtime verification
- human assistance when target sites require QR login, SMS verification, captcha, or secondary authentication

### Installation

Copy the entire [`book-source-creator/`](./book-source-creator/) directory into your local skills directory.

Common locations:

```text
~/.cc-switch/skills/book-source-creator/
~/.codex/skills/book-source-creator/
```

Detailed skill docs:

- [`book-source-creator/SKILL.md`](./book-source-creator/SKILL.md)
- [`book-source-creator/README.md`](./book-source-creator/README.md)

### Quick Start

Recommended execution order:

1. determine whether the target site requires login
2. if login is required, analyze in login state first
3. output a generatability assessment before writing any rule
4. use Browser MCP to verify search, detail, TOC, and content behavior
5. generate the Legado source JSON
6. run validation and rule-audit helpers
7. import the result into Legado and verify actual runtime behavior

Recommended assessment template:

```markdown
## 网站可生成性评估
- 目标站点：
- 登录状态：
- 搜索可用性：
- 详情可用性：
- 目录可用性：
- 正文可用性：
- 特殊风险：
- 可生成性评级：
- 是否继续生成：
- 继续生成理由 / 停止理由：
```

Allowed ratings:

- `可直接生成`
- `可生成但高风险`
- `需登录后再评估`
- `不建议生成`

`需登录后再评估` and `不建议生成` do not hard-block work, but continuing under either rating must be explicitly marked as `高风险` with a clear explanation.

### Helper Scripts

Helper scripts are located in [`book-source-creator/scripts/`](./book-source-creator/scripts/):

- `analyze_with_playwright.mjs`
- `validate_source.mjs`
- `test_rules.mjs`
- `generate_template.mjs`

Files with the same names and `.py` extensions are compatibility wrappers that forward to the `.mjs` scripts.

Example commands:

```bash
# analyze a site with optional human-assisted login
node book-source-creator/scripts/analyze_with_playwright.mjs https://novel-site.com --manual-login --save analysis.json

# generate a template from analysis output
node book-source-creator/scripts/generate_template.mjs --analysis analysis.json

# validate source structure
node book-source-creator/scripts/validate_source.mjs my_source.json

# audit rules and preview search URL substitution
node book-source-creator/scripts/test_rules.mjs my_source.json --keyword 凡人修仙
```

### Example Resource

This repository currently includes one real source example:

- file: [`examples/163zw-legado.json`](./examples/163zw-legado.json)
- target site: `https://www.163zw.com/`

#### 163zw Source Creation Flow

This `163中文网` source was created with the following process:

1. confirm that search, detail, TOC, and content are accessible without login
2. write a generatability assessment before rule design
3. use Browser MCP to search `凡人修仙` and verify result list, title, author, cover, and detail links
4. enter the detail page and confirm title, author, cover, intro, and TOC entry points
5. inspect the TOC and confirm pagination, then add `nextTocUrl`
6. inspect chapter pages and confirm real text with multi-page chapters, then add `nextContentUrl`
7. generate the source JSON
8. run validation and rule audit helpers
9. import and verify the result in Legado

This sample source did not show obvious issues in the tested flow, but that is not a guarantee against future site changes.

### Verification Status

Verified:

- this skill has been tested successfully in Codex
- the Browser MCP based analysis workflow runs successfully
- the Node helper scripts run successfully
- the `163中文网` sample source has passed one round of practical verification and did not show obvious issues in that round

Not verified:

- compatibility with other AI tools
- long-term stability across all novel sites
- behavior consistency across all login-protected sites

### Risk Notice

Use this repository at your own risk.

- This project has only been validated in Codex so far.
- Other AI tools have not been systematically tested.
- Generated book sources depend on the live structure of third-party sites.
- Target sites may change HTML, request chains, anti-bot rules, pagination logic, or login flows at any time.
- A source that works once may stop working later.
- Example sources in this repository represent tested point-in-time results only and are not long-term compatibility guarantees.
- Final runtime behavior still depends on your Legado version, target site state, and your own verification process.
- You are responsible for validating, debugging, and maintaining any source you actually use.

### Repository Layout

```text
book-source-creator-skill/
  README.md
  examples/
    163zw-legado.json
  book-source-creator/
    SKILL.md
    README.md
    references/
    scripts/
    tests/
```

### Related Links

- Skill package: [`book-source-creator/`](./book-source-creator/)
- Skill entry: [`book-source-creator/SKILL.md`](./book-source-creator/SKILL.md)
- Skill docs: [`book-source-creator/README.md`](./book-source-creator/README.md)
- Example source: [`examples/163zw-legado.json`](./examples/163zw-legado.json)
- Legado: `https://github.com/gedoor/legado`
