---
name: legado-book-source-generator
description: Analyze a fiction or novel website and generate a Legado book source JSON. Use when Codex needs to assess whether a site can become a Legado source, inspect login requirements, analyze search/detail/toc/content chains with Browser MCP, map site behavior to Legado rules, or prepare manual Legado import validation artifacts.
---

# Legado Book Source Generator

## Overview

Use this skill to turn a single fiction site into a single Legado book source.

Treat model analysis as the primary judgement for page structure, request chains, and rule semantics. Use Browser MCP and helper scripts only to verify observations, catch contradictions, and structure outputs.

Do not generate `book-source.json` before completing a website feasibility assessment.

Treat the actual target site's Browser MCP observations and Legado's official rule documentation as the source of truth. Reference sources are only supplementary learning material for the AI and must never override live analysis.

## Core Rules

1. Assess login requirements first.
2. If the site supports login, prefer analysis in an authenticated session.
3. If login needs QR scan, CAPTCHA, SMS, or any human confirmation, stop and ask the human to complete it.
4. Complete a website feasibility assessment before generating JSON.
5. If Browser MCP conflicts with the model's inference, trust observed behavior and explain the correction.
6. If the rating is `需登录后再评估` or `不建议生成`, continue only with explicit `高风险` labeling, reasons, and known failure points.
7. When Legado-side debugging is needed, guide the human through the smallest possible repro and ask for stage-specific screenshots or logs instead of asking for everything at once.
8. When the human provides known-good sources, treat them only as supplementary learning material for writing style or rule organization, never as the basis for final rule decisions.
9. Default to search, detail, toc, and content only. Do not enable explore or generate discover-page rules unless the human explicitly asks for them.
10. Do not add debugging guidance to `bookSourceComment` during normal generation. Enter debugging mode only after the human reports that the source no longer works or a specific chain fails in Legado.
11. Repository-level lessons from `jiwangyihao/source-j-legado` and `ZWolken/Light-Novel-Yuedu-Source` have already been distilled into `references/reference-source-patterns.md`; future executions should use the distilled notes there instead of reopening those upstream examples by default.

## Workflow

### 1. Check Login State

- Inspect the site for login entry points, gated content, degraded anonymous pages, member-only chapters, or capability changes across search/detail/toc/content.
- If login is possible, ask the human to complete login in Browser MCP and continue analysis in that session.
- If login requires human intervention, request it immediately instead of guessing.
- If login cannot be completed, keep going only for assessment or exploratory output and mark all downstream results as high risk.

### 2. Write Feasibility Assessment

- Create `assessment.md` before any rule generation.
- Use exactly one rating:
  - `可直接生成`
  - `可生成但高风险`
  - `需登录后再评估`
  - `不建议生成`
- Cover at least:
  - login dependence
  - search reachability
  - detail stability
  - toc stability
  - content stability
  - anti-bot, CAPTCHA, membership, signatures, encryption, payment limits
- If the rating is high risk or blocked, state why work is continuing and which chain is expected to fail.

Use [references/assessment-template.md](references/assessment-template.md) as the output template.

### 3. Analyze the Site

Perform four-chain analysis in this fixed order:

1. search
2. detail
3. toc
4. content

For each chain, record:

- page entry or trigger
- request chain or interface source
- stable extraction evidence
- risk points
- Legado rule recommendation

Use double-sample verification:

- test at least two search keywords or two sample books
- verify at least two content chapters

Use [references/analysis-workflow.md](references/analysis-workflow.md) for the exact structure.

If the human has provided confirmed working sources for similar sites, use only the distilled notes in [references/reference-source-patterns.md](references/reference-source-patterns.md). Do not fetch or inspect those example sources, upstream READMEs, or release JSONs again during normal execution unless the human explicitly asks for that.

### 4. Generate Legado JSON

- Prefer stable JSON or API responses over DOM scraping.
- Prefer stable DOM extraction over JS compensation.
- Add JS only when a simpler rule cannot represent the observed behavior.
- Base all rule decisions on the live target site's Browser MCP observations plus Legado's official rule documentation.
- Keep the JSON aligned with Legado `BookSource`, `SearchRule`, `BookInfoRule`, `TocRule`, and `ContentRule`.
- Include at least:
  - `bookSourceUrl`
  - `bookSourceName`
  - `searchUrl`
  - `ruleSearch`
  - `ruleBookInfo`
  - `ruleToc`
  - `ruleContent`
- Include `loginUrl` and `header` when the site needs them.
- Default `enabledExplore` to `false` and omit discover-page work unless the human explicitly asks for discovery support.

Read [references/legado-json-structure.md](references/legado-json-structure.md) before finalizing the JSON.

### 5. Guide Human-Assisted Debugging

Legado source creation is usually not blocked by JSON generation. It is blocked by missing reproduction evidence from the app.

When debugging with the human:

- Enter this mode only after the human reports a broken source, failed import, failed chain, or app-side failure.
- Send them to the source edit screen first.
- If `loginUrl` exists, ask them to use the built-in login entry before debugging rules.
- Ask for only the evidence needed for the failing stage.
- Prefer raw source dumps over paraphrased descriptions whenever the app can show them.
- If the app crashes or the source editor cannot reach the failing stage, switch to crash/log export instructions.
- Prefer the ready-to-send templates in the debug collaboration guide instead of improvising vague requests.

Use [references/debugging-collaboration.md](references/debugging-collaboration.md) to decide what to request.

### 6. Prepare Manual Legado Validation

- Output `validation-checklist.md`.
- Tell the human to import `book-source.json` into Legado and verify:
  - search returns the target book
  - detail metadata renders
  - toc loads
  - at least two content chapters open
- If validation fails, trace the failure back to the affected chain and revise the rules.

Use [references/validation-checklist.md](references/validation-checklist.md) as the checklist body.

## Output Bundle

Write deliverables under `outputs/<site-slug>/`:

- `assessment.md`
- `analysis.md`
- `book-source.json`
- `validation-checklist.md`

Use the helper script to scaffold or validate artifacts:

```powershell
node .\legado-book-source-generator\scripts\project-helper.mjs scaffold-output .\outputs https://example.com
node .\legado-book-source-generator\scripts\project-helper.mjs validate-source .\outputs\example-com\book-source.json
```

You can also run the static audit helper:

```powershell
node .\legado-book-source-generator\scripts\audit-source.mjs .\outputs\example-com\book-source.json --keyword 凡人修仙 --page 1
```

`audit-source.mjs` only performs static auditing, placeholder detection, and search URL preview. It does not simulate Legado's full rule execution and must not be treated as the authority on runtime availability.

## References

- Assessment template: [references/assessment-template.md](references/assessment-template.md)
- Analysis workflow: [references/analysis-workflow.md](references/analysis-workflow.md)
- Debug collaboration: [references/debugging-collaboration.md](references/debugging-collaboration.md)
- JSON structure: [references/legado-json-structure.md](references/legado-json-structure.md)
- Reference source patterns: [references/reference-source-patterns.md](references/reference-source-patterns.md)
- Manual validation: [references/validation-checklist.md](references/validation-checklist.md)
- Real sample bundles: [examples/README.md](examples/README.md)
