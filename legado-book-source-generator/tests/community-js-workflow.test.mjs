import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { loadAndVerify, saveRunState } from "../scripts/lib/state.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const BSG = path.join(ROOT, "scripts", "bsg.mjs");
const temporaryDirectories = [];
const noDeviceEnv = {
  ...process.env,
  BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
};

const VALID_JS = `var config = {
  bookSourceUrl: "https://example.com",
  bookSourceName: "Example JS"
};
function search(key, page) { return []; }
function getChapters(book) { return []; }
function getContent(chapter) { return "content"; }
`;

async function makeTemporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bsg-community-js-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function runBsg(args) {
  const result = await execFileAsync("node", [BSG, ...args], {
    encoding: "utf8",
    env: noDeviceEnv,
  });
  return JSON.parse(result.stdout);
}

async function runBsgFailure(args) {
  try {
    await runBsg(args);
  } catch (error) {
    return JSON.parse(error.stdout);
  }
  assert.fail("Expected bsg command to fail");
}

async function initCommunityRun(workDirectory) {
  return runBsg(["init", "https://example.com", "--cwd", workDirectory, "--target", "community-js"]);
}

async function moveToGenerate(runDirectory) {
  const loaded = loadAndVerify(runDirectory);
  assert.equal(loaded.error, null);
  loaded.state.phases.assess.status = "completed";
  loaded.state.phases.assess.recorded = true;
  loaded.state.phases.analyze.status = "completed";
  loaded.state.phases.generate.status = "in_progress";
  await fs.writeFile(path.join(runDirectory, "analysis.md"), "# 网站分析\n\n- 搜索: 已确认\n", "utf8");
  saveRunState(runDirectory, loaded.state);
  return loaded.state;
}

async function writePassedAppReport(runDirectory, sourcePath, overrides = {}) {
  const source = await fs.readFile(sourcePath);
  const report = {
    _generatedBy: "bsg app-mcp validate-js",
    _schemaVersion: "1.0",
    _runDir: runDirectory,
    backend: "legado_app_mcp",
    targetRuntime: "community_app",
    sourceFormat: "community_js",
    sourceHash: createHash("sha256").update(source).digest("hex"),
    serverInfo: { name: "legado", version: "test" },
    bookSourceUrl: "https://example.com",
    readBack: { present: true, matchesSourceExceptManagedTimestamp: true },
    links: { search: true, detail: true, toc: true, content: true },
    appCheck: { passed: true },
    cleanup: { attempted: true, confirmed: true, error: null },
    sourceRetainedInApp: false,
    status: "passed",
    ...overrides,
  };
  await fs.writeFile(path.join(runDirectory, "app-mcp-report.json"), JSON.stringify(report, null, 2), "utf8");
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await fs.rm(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe("community-js workflow", () => {
  it("initializes an explicit community target without a legacy artifact", async () => {
    const workDirectory = await makeTemporaryDirectory();
    const initialized = await initCommunityRun(workDirectory);

    assert.equal(initialized.sourceTarget, "community-js");
    assert.equal(initialized.sourceFormat, "community_js");
    assert.equal(initialized.targetRuntime, "community_app");
    assert.equal(path.basename(initialized.outputs.sourceArtifact), "book-source.js");
    await fs.access(initialized.outputs.sourceArtifact);
    await assert.rejects(fs.access(path.join(workDirectory, "outputs", "example-com", "book-source.json")));
    const checklist = await fs.readFile(path.join(initialized.runDir, "validation-checklist.md"), "utf8");
    assert.match(checklist, /保存 `book-source\.js`/);
    assert.doesNotMatch(checklist, /导入 `book-source\.json`/);

    const status = await runBsg(["status", "--run", initialized.runDir]);
    assert.equal(status.validationBackend, "legado_app_mcp");
    assert.equal(status.sourceArtifact, initialized.outputs.sourceArtifact);
  });

  it("keeps legacy-json as the default target", async () => {
    const workDirectory = await makeTemporaryDirectory();
    const initialized = await runBsg(["init", "https://example.com", "--cwd", workDirectory]);

    assert.equal(initialized.sourceTarget, "legacy-json");
    assert.equal(path.basename(initialized.outputs.sourceArtifact), "book-source.json");
    await fs.access(initialized.outputs.sourceArtifact);
  });

  it("rejects unsupported and conflicting targets", async () => {
    const workDirectory = await makeTemporaryDirectory();
    const unsupported = await runBsgFailure(["init", "https://example.com", "--cwd", workDirectory, "--target", "other"]);
    assert.match(unsupported.error, /不支持的 source target/);
    await assert.rejects(fs.access(path.join(workDirectory, "runs", "example-com")));

    await runBsg(["init", "https://example.com", "--cwd", workDirectory]);
    const duplicate = await runBsgFailure(["init", "https://example.com", "--cwd", workDirectory]);
    assert.match(duplicate.error, /不能覆盖初始化/);
    const conflict = await runBsgFailure(["init", "https://example.com", "--cwd", workDirectory, "--target", "community-js"]);
    assert.match(conflict.error, /已存在 target legacy-json/);
    await assert.rejects(fs.access(path.join(workDirectory, "outputs", "example-com", "book-source.js")));
  });

  it("checks the JavaScript contract before entering App validation", async () => {
    const workDirectory = await makeTemporaryDirectory();
    const initialized = await initCommunityRun(workDirectory);
    await moveToGenerate(initialized.runDir);

    const empty = await runBsg(["run", "--run", initialized.runDir]);
    assert.equal(empty.nextAction, "generate_community_js");

    await fs.writeFile(initialized.outputs.sourceArtifact, "var config = {};\n", "utf8");
    const invalid = await runBsgFailure(["run", "--run", initialized.runDir]);
    assert.match(invalid.error, /缺少 search\(\) 函数/);

    await fs.writeFile(initialized.outputs.sourceArtifact, VALID_JS, "utf8");
    const validated = await runBsg(["run", "--run", initialized.runDir]);
    assert.equal(validated.currentPhase, "validate");
    assert.equal(validated.nextAction, "run_app_mcp_validation");
    assert.deepEqual(validated.readNext, ["references/community-app-mcp.md"]);
    assert.match(validated.nextCommand, /app-mcp validate-js/);
    assert.doesNotMatch(validated.nextCommand, / validate --run /);

    const ruleCheck = JSON.parse(await fs.readFile(path.join(initialized.runDir, "rule-check.json"), "utf8"));
    assert.equal(ruleCheck.status, "passed");
    assert.equal(ruleCheck.sourceFormat, "community_js");
  });

  it("requires a current App MCP report before delivery", async () => {
    const workDirectory = await makeTemporaryDirectory();
    const initialized = await initCommunityRun(workDirectory);
    await moveToGenerate(initialized.runDir);
    await fs.writeFile(initialized.outputs.sourceArtifact, VALID_JS, "utf8");
    await runBsg(["run", "--run", initialized.runDir]);

    await writePassedAppReport(initialized.runDir, initialized.outputs.sourceArtifact, { _runDir: path.join(workDirectory, "runs", "other") });
    const wrongRun = await runBsgFailure(["record-validation", "--run", initialized.runDir, "--status", "passed"]);
    assert.match(wrongRun.error, /_runDir 与当前 run 目录不匹配/);

    await writePassedAppReport(initialized.runDir, initialized.outputs.sourceArtifact, {
      links: { search: true, detail: true, toc: true, content: false },
    });
    const incomplete = await runBsgFailure(["record-validation", "--run", initialized.runDir, "--status", "passed"]);
    assert.match(incomplete.error, /四链路/);

    await writePassedAppReport(initialized.runDir, initialized.outputs.sourceArtifact);
    const recorded = await runBsg(["record-validation", "--run", initialized.runDir, "--status", "passed"]);
    assert.equal(recorded.status, "passed");
    assert.equal(recorded.backend, "legado_app_mcp");

    const delivered = await runBsg(["deliver", "--run", initialized.runDir]);
    assert.equal(delivered.finalStatus, "passed");
    assert.equal(delivered.deliverable, initialized.outputs.sourceArtifact);

    await fs.appendFile(initialized.outputs.sourceArtifact, "\n// changed\n", "utf8");
    const stale = await runBsgFailure(["deliver", "--run", initialized.runDir]);
    assert.match(stale.error, /未通过或不对应当前 book-source.js/);
  });

  it("does not accept legacy validation statuses for community-js", async () => {
    const workDirectory = await makeTemporaryDirectory();
    const initialized = await initCommunityRun(workDirectory);
    await moveToGenerate(initialized.runDir);
    await fs.writeFile(initialized.outputs.sourceArtifact, VALID_JS, "utf8");
    await runBsg(["run", "--run", initialized.runDir]);
    await writePassedAppReport(initialized.runDir, initialized.outputs.sourceArtifact, { status: "needs_app_review" });

    const result = await runBsgFailure(["record-validation", "--run", initialized.runDir, "--status", "needs_app_review"]);
    assert.match(result.error, /只接受 passed 或 failed/);
  });
});
