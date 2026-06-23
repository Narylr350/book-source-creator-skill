# BSG Run Entrypoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small `bsg run` command so agents can follow one main entrypoint after `init`, while keeping the existing state machine and validator logic intact.

**Architecture:** `run` is a thin coordinator around the current commands. It does not rewrite state transitions, validation rules, Android Probe logic, or assessment generation. It reads current state, returns the single safe next action, and only delegates to existing command handlers when the next step is script-owned and side-effect-safe.

**Tech Stack:** Node.js ESM, built-in `node:test`, current `scripts/bsg.mjs` CLI.

## Global Constraints

- No hooks.
- No site-specific fixes.
- No state-machine rewrite in this round.
- Keep existing commands available for expert/debug use.
- Shrink the main skill-facing workflow to `init -> run -> run...`.
- If a step requires AI-authored content, `run` must stop and return `writeTarget`/`readNext`; it must not invent content.
- If a step requires user confirmation, `run` must stop and return `requiredUserAction`.
- If a step requires an external action such as validator/login, `run` returns one `nextCommand` instead of guessing.

---

## File Structure

- Modify `scripts/lib/workflow-commands.mjs`: add `cmdRun(args)` near `cmdStatus/cmdAdvance`.
- Modify `scripts/lib/commands.mjs`: export `cmdRun`.
- Modify `scripts/bsg.mjs`: add usage text and dispatch for `run`.
- Modify `SKILL.md`: make `run` the primary workflow and move older command list out of the main path.
- Modify `references/workflow.md`: document the new default loop.
- Modify `tests/bsg-state.test.mjs`: add regression tests for `run`.

---

### Task 1: Add `cmdRun` As A Thin Coordinator

**Files:**
- Modify: `scripts/lib/workflow-commands.mjs`
- Modify: `scripts/lib/commands.mjs`
- Modify: `scripts/bsg.mjs`
- Test: `tests/bsg-state.test.mjs`

**Interfaces:**
- Consumes: `--run <run-dir>`.
- Produces:
  - `nextAction: "write_assessment"` with `writeTarget` when assessment content is needed.
  - `nextAction: "write_analysis"` with `writeTarget` when analysis content is needed.
  - `nextAction: "generate_json"` with `writeTarget` when source JSON is needed.
  - `nextAction: "run_command"` with `nextCommand` when a script/external command is the only legal next step.
  - `nextAction: "stop"` with `requiredUserAction` when user input is required.

- [ ] **Step 1: Write failing tests for `run` command existence**

Add tests near `describe("advance response fields", ...)`:

```js
it("run starts the next pending phase after init", async () => {
  const tmpDir = await makeTmpDir();
  const init = await runBsg(["init", "https://example.com", "--cwd", tmpDir]);

  const result = await runBsg(["run", "--run", init.runDir]);

  assert.equal(result.ok, true);
  assert.equal(result.nextAction, "probe_site");
  assert.ok(Array.isArray(result.readNext));
  assert.ok(result.nextCommand.includes("run"));
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

Expected before implementation: command is unknown.

- [ ] **Step 2: Write failing tests for assessment stop behavior**

```js
it("run stops at assessment authoring instead of asking the agent to advance", async () => {
  const tmpDir = await makeTmpDir();
  const init = await runBsg(["init", "https://example.com", "--cwd", tmpDir]);
  await runBsg(["run", "--run", init.runDir]);
  const result = await runBsg(["run", "--run", init.runDir]);

  assert.equal(result.nextAction, "write_assessment");
  assert.ok(result.writeTarget.endsWith(path.join("runs", "example-com", "assessment.md")));
  assert.ok(result.readNext.some((p) => p.includes("assessment-template")));
  assert.ok(result.nextCommand.includes("run"));
  assert.doesNotMatch(result.message, /展示评估摘要/);
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

Expected before implementation: command is unknown.

- [ ] **Step 3: Write failing tests for required user action stop**

```js
it("run stops when requiredUserAction is pending", async () => {
  const tmpDir = await makeTmpDir();
  const runDir = await initRun(tmpDir);
  await writeAssessmentAndRecord(runDir, ["- 评级: 可生成", "- 风险标签: WebView 依赖"]);
  await runBsg(["advance", "--run", runDir], {
    env: { ...process.env, BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n" },
  });

  const result = await runBsg(["run", "--run", runDir]);

  assert.equal(result.nextAction, "stop");
  assert.equal(result.requiredUserAction, "android_device_needed");
  assert.match(result.nextCommand, /resolve-user-action/);
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

Expected before implementation: command is unknown.

- [ ] **Step 4: Implement `cmdRun(args)`**

Add to `scripts/lib/workflow-commands.mjs`:

```js
export function cmdRun(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" run --run <run-dir>");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const pendingBlock = blockForPendingUserAction(state);
  if (pendingBlock) {
    return {
      ...pendingBlock,
      nextAction: "stop",
      nextCommand: `node "<skill-dir>/scripts/bsg.mjs" resolve-user-action --run ${runDir} --action <action>`,
    };
  }

  const idx = currentPhaseIndex(state);
  if (idx >= PHASE_ORDER.length) {
    return {
      ok: true,
      nextAction: "run_command",
      message: "所有阶段已完成。运行 deliver 完成交付。",
      readNext: PHASE_READ_NEXT.deliver,
      nextCommand: phaseNextCommand(runDir, "deliver"),
    };
  }

  const current = PHASE_ORDER[idx];
  const phase = state.phases[current];

  if (phase.status === "pending") {
    return startPhase(current, state, runDir);
  }

  if (phase.status !== "in_progress") {
    return fail(`阶段 ${current} 状态异常: ${phase.status}`);
  }

  if (current === "probe") return completePhase(current, state, runDir);
  if (current === "assess" && phase.recorded !== true) {
    return {
      ok: true,
      currentPhase: "assess",
      nextAction: "write_assessment",
      writeTarget: path.join(runDir, "assessment.md"),
      readNext: PHASE_READ_NEXT.assess,
      message: "填写 assessment.md 的证据说明区；完成后继续运行 bsg run。",
      nextCommand: `node "<skill-dir>/scripts/bsg.mjs" run --run ${runDir}`,
    };
  }
  if (current === "analyze") {
    return {
      ok: true,
      currentPhase: "analyze",
      nextAction: "write_analysis",
      writeTarget: path.join(runDir, "analysis.md"),
      readNext: PHASE_READ_NEXT.analyze,
      message: "按 search/detail/toc/content 写 analysis.md；完成后继续运行 bsg run。",
      nextCommand: `node "<skill-dir>/scripts/bsg.mjs" run --run ${runDir}`,
    };
  }
  if (current === "generate") {
    return {
      ok: true,
      currentPhase: "generate",
      nextAction: "generate_json",
      writeTarget: path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json"),
      readNext: PHASE_READ_NEXT.generate,
      message: "生成 book-source.json；完成后继续运行 bsg run。",
      nextCommand: `node "<skill-dir>/scripts/bsg.mjs" run --run ${runDir}`,
    };
  }
  if (current === "validate") {
    return {
      ok: true,
      currentPhase: "validate",
      nextAction: "run_command",
      readNext: PHASE_READ_NEXT.validate,
      message: "运行 validator；完成后继续运行 bsg run 或按 validate 返回的 nextCommand 执行。",
      nextCommand: phaseNextCommand(runDir, "validate"),
    };
  }

  return completePhase(current, state, runDir);
}
```

Implementation note: adjust the exact logic if existing helpers already provide a cleaner way, but keep `run` thin and do not duplicate validator/assessment rules.

- [ ] **Step 5: Export and dispatch**

Update `scripts/lib/commands.mjs`:

```js
export { cmdInit, cmdStatus, cmdAdvance, cmdRun } from "./workflow-commands.mjs";
```

Update `scripts/bsg.mjs` imports and switch:

```js
case "run":
  result = cmdRun(args);
  break;
```

Add usage line:

```text
node "<skill-dir>/scripts/bsg.mjs" run --run {dir}
```

- [ ] **Step 6: Run targeted tests**

Run:

```powershell
npm test -- tests/bsg-state.test.mjs
```

Expected: new `run` tests pass.

---

### Task 2: Make `SKILL.md` Teach The Smaller Surface

**Files:**
- Modify: `SKILL.md`
- Modify: `references/workflow.md`
- Test: `tests/bsg-state.test.mjs`

**Interfaces:**
- Consumes: existing skill trigger behavior.
- Produces: a shorter main workflow where weak models see `init`, `run`, `status`, `debug-bundle`, and `resolve-user-action` first.

- [ ] **Step 1: Rewrite the top of `SKILL.md`**

Replace the main flow with:

```md
# Legado 书源生成

拿到 URL 后运行 init。之后默认只运行 run。

```bash
node "<skill-dir>/scripts/bsg.mjs" init <url> [--cwd <输出目录>]
node "<skill-dir>/scripts/bsg.mjs" run --run <run-dir>
```

`run` 返回什么就做什么：

- `readNext`：先读这些文件。
- `writeTarget`：只写这个目标文件，写完继续 `run`。
- `nextCommand`：只执行这个命令，完成后继续 `run`。
- `requiredUserAction`：停止自动操作，等用户确认后再 `resolve-user-action`。
- `correctiveAction`：按它修，不要猜。
```

Keep the three hard rules, but remove the long command list from the main path.

- [ ] **Step 2: Add expert command note**

Add a short section:

```md
## 专家命令

`advance`、`record-assessment`、`validate`、`record-validation`、`deliver`、`login` 等命令仍可用于调试，但主流程优先使用 `run`。除非 `run.nextCommand` 明确要求，不要自行组合这些命令。
```

- [ ] **Step 3: Update workflow reference**

In `references/workflow.md`, add a default loop:

```md
默认执行循环：

1. `init`
2. `run`
3. 按 `run` 返回的 `readNext/writeTarget/nextCommand/requiredUserAction` 执行
4. 再 `run`

旧命令顺序仍保留为专家调试说明，不作为默认 agent 流程。
```

- [ ] **Step 4: Add doc regression assertion**

Add a simple test in `tests/bsg-state.test.mjs`:

```js
it("SKILL main workflow points agents to run", async () => {
  const skill = await fs.readFile(path.join(ROOT, "SKILL.md"), "utf8");
  assert.match(skill, /默认只运行 run|之后.*run/s);
  assert.match(skill, /requiredUserAction/);
  assert.match(skill, /专家命令/);
});
```

- [ ] **Step 5: Run targeted tests**

Run:

```powershell
npm test -- tests/bsg-state.test.mjs
```

Expected: pass.

---

### Task 3: Verify With A Minimal Real Workflow

**Files:**
- Modify only if tests expose a bug.

**Interfaces:**
- Consumes: local temp run created by `init`.
- Produces: evidence that `run` reduces command-choice ambiguity without changing validation semantics.

- [ ] **Step 1: Run full test suite**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run a smoke flow in temp directory**

Run:

```powershell
$tmp = Join-Path $env:TEMP ("bsg-run-smoke-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$init = node D:\Narylr\阅读书源生成技能\legado-book-source-generator\scripts\bsg.mjs init https://example.com --cwd $tmp | ConvertFrom-Json
node D:\Narylr\阅读书源生成技能\legado-book-source-generator\scripts\bsg.mjs run --run $init.runDir
node D:\Narylr\阅读书源生成技能\legado-book-source-generator\scripts\bsg.mjs run --run $init.runDir
```

Expected:
- first `run` starts/completes probe movement using existing state behavior
- second `run` returns `write_assessment`
- no `advance` command is required from the agent-facing path

- [ ] **Step 3: Check diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intended files changed.

- [ ] **Step 4: Commit**

Only after user approval:

```powershell
git add scripts/bsg.mjs scripts/lib/commands.mjs scripts/lib/workflow-commands.mjs SKILL.md references/workflow.md tests/bsg-state.test.mjs
git commit -m "feat: add bsg run entrypoint"
```

---

## Non-Goals

- Do not add Claude Code hooks.
- Do not hide or delete expert commands yet.
- Do not rewrite Android Probe login.
- Do not redesign assessment/site-facts/capability-matrix.
- Do not add a new gate system in this round.

## Self-Review

- Spec coverage: covers single-entry `run`, SKILL main-flow reduction, no hooks, and minimal verification.
- Placeholder scan: no TODO/TBD placeholders.
- Scope check: focused on one small outer wrapper, not a state-machine rewrite.
- Ambiguity check: expert commands remain available but are no longer the default agent path.
