# book-source-creator-skill

Create, debug, and verify Legado book sources with a Browser MCP first workflow.

- Repository: `https://github.com/Narylr350/book-source-creator-skill`
- Legado repository: `https://github.com/gedoor/legado`
- Skill package: [`book-source-creator/`](./book-source-creator/)
- Example source: [`examples/163zw-legado.json`](./examples/163zw-legado.json)

## Overview

`book-source-creator-skill` is a Codex skill for building Legado book sources by analyzing real websites instead of guessing rules from static HTML snippets.

The workflow is centered on Browser MCP:

- inspect real pages
- inspect search, detail, TOC, and content chains
- prefer login-state analysis when needed
- assess whether a site is realistically generatable before writing rules
- use scripts only as auxiliary validation tools

## Features

- Browser MCP first analysis instead of script-first guessing
- login-aware workflow with explicit human-assisted login handoff
- mandatory generatability assessment before rule generation
- support for search, detail, TOC, content, paginated TOC, and paginated chapter flows
- Node-based helper scripts for validation, auditing, and template generation
- compatibility Python wrappers for existing script entrypoints

## Requirements

- a Codex environment that supports skills
- Browser MCP access
- a target novel site URL
- Node.js if you want to run helper scripts locally
- Legado for final import and runtime verification
- human assistance when target sites require QR login, SMS verification, captcha, or secondary auth

## Installation

Copy the [`book-source-creator/`](./book-source-creator/) directory into your local skills directory.

Common target locations:

```text
~/.cc-switch/skills/book-source-creator/
~/.codex/skills/book-source-creator/
```

Detailed skill docs:

- [`book-source-creator/SKILL.md`](./book-source-creator/SKILL.md)
- [`book-source-creator/README.md`](./book-source-creator/README.md)

## Quick Start

1. Confirm whether the target site requires login.
2. If login is required, analyze in login state first.
3. Output a generatability assessment before writing any rule.
4. Use Browser MCP to verify search, detail, TOC, and content behavior.
5. Generate the Legado source JSON.
6. Run validation and rule-audit helpers.
7. Import the result into Legado and verify actual behavior.

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

`需登录后再评估` and `不建议生成` do not hard-block work, but continuing under either rating must be explicitly marked as `高风险` with a clear reason.

## Helper Scripts

The helper scripts live in [`book-source-creator/scripts/`](./book-source-creator/scripts/):

- `analyze_with_playwright.mjs`
- `validate_source.mjs`
- `test_rules.mjs`
- `generate_template.mjs`

Python files with the same names are compatibility wrappers that forward to the `.mjs` scripts.

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

## Example Resource

This repository includes a real example source for `163中文网`:

- file: [`examples/163zw-legado.json`](./examples/163zw-legado.json)
- target site: `https://www.163zw.com/`

### 163zw Creation Flow

This source was created with the following process:

1. Confirmed the site does not require login for search, detail, TOC, or content.
2. Wrote a generatability assessment before rule design.
3. Used Browser MCP to verify search results for `凡人修仙`.
4. Entered the detail page and confirmed title, author, cover, and intro extraction points.
5. Confirmed TOC pagination exists and added `nextTocUrl`.
6. Confirmed chapter content is real text but split into multiple pages and added `nextContentUrl`.
7. Generated the JSON source.
8. Ran validation and rule audit helpers.
9. Imported and checked the result in Legado.

Current result: this sample source did not show obvious issues during the tested flow.

## Verification Status

Verified:

- this skill works in Codex
- Browser MCP driven analysis flow was tested successfully
- Node helper scripts run successfully
- the `163中文网` sample source was tested once and did not show obvious issues in that test round

Not verified:

- compatibility with other AI tools
- long-term stability across site revisions
- success rate across all novel sites
- behavior consistency across all login-protected sites

## Risk Notice

Use this repository at your own risk.

- This project is only validated in Codex at the time of writing.
- Other AI tools have not been systematically tested.
- Generated book sources depend on the live structure of third-party sites.
- Target sites may change HTML, request chains, anti-bot rules, pagination logic, or login flows at any time.
- A source that works once may stop working later without any change to this repository.
- Example sources in this repository are examples of a tested point-in-time result, not a long-term compatibility guarantee.
- Final runtime behavior still depends on your Legado version, target site state, and your own verification process.
- You are responsible for validating, debugging, and maintaining any source you actually use.

## Repository Layout

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

## Related Links

- Skill package: [`book-source-creator/`](./book-source-creator/)
- Skill entry: [`book-source-creator/SKILL.md`](./book-source-creator/SKILL.md)
- Skill docs: [`book-source-creator/README.md`](./book-source-creator/README.md)
- Example source: [`examples/163zw-legado.json`](./examples/163zw-legado.json)
- Legado: `https://github.com/gedoor/legado`
