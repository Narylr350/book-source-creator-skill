import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const BSG = path.join(ROOT, "scripts", "bsg.mjs");
const workDirectories = [];
const noDeviceEnv = { ...process.env, BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n" };

async function runBsg(args) {
  const result = await execFileAsync("node", [BSG, ...args], { encoding: "utf8", env: noDeviceEnv });
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

async function initRun() {
  const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bsg-observe-"));
  workDirectories.push(workDirectory);
  return runBsg(["init", "https://example.com", "--cwd", workDirectory, "--target", "community-js"]);
}

afterEach(async () => {
  while (workDirectories.length > 0) await fs.rm(workDirectories.pop(), { recursive: true, force: true });
});

describe("observe assessment gate", () => {
  it("records ordinary links one at a time", async () => {
    const initialized = await initRun();
    const result = await runBsg([
      "observe", "--run", initialized.runDir,
      "--phase", "search", "--status", "success", "--render", "ssr_or_http",
      "--note", "Browser MCP search result",
    ]);

    assert.equal(result.stopInspection, false);
    assert.equal(result.nextAction, "observe_next_link");
    assert.deepEqual(result.unknownPhases, ["detail", "toc", "content"]);
    assert.match(result.nextCommandTemplate, /observe --run/);
  });

  it("closes inspection immediately when a required entry hits CAPTCHA", async () => {
    const initialized = await initRun();
    const result = await runBsg([
      "observe", "--run", initialized.runDir,
      "--phase", "search", "--status", "blocked", "--blocker", "captcha",
      "--note", "Browser MCP slider CAPTCHA",
    ]);

    assert.equal(result.stopInspection, true);
    assert.equal(result.inspectionBoundary, "entry_antibot");
    assert.equal(result.maxAdditionalPublicSamples, 0);
    assert.equal(result.nextAction, "record_assessment");
    assert.match(result.nextCommand, /record-assessment/);
    assert.ok(result.forbiddenActions.includes("generate_source"));
    assert.ok(result.forbiddenActions.includes("reverse_engineer_signature"));

    const facts = JSON.parse(await fs.readFile(path.join(initialized.runDir, "site-facts.json"), "utf8"));
    assert.equal(facts.inspection.closed, true);
    assert.equal(facts.links.search.blocker, "captcha");
    assert.equal(facts.links.detail.blocker, "inspection_boundary");
    assert.equal(facts.links.content.status, "blocked");

    const continued = await runBsgFailure([
      "observe", "--run", initialized.runDir,
      "--phase", "detail", "--status", "success", "--note", "direct sample",
    ]);
    assert.match(continued.error, /探查已因 entry_antibot 关闭/);

    const recorded = await runBsg(["record-assessment", "--run", initialized.runDir]);
    assert.equal(recorded.summary.fullPass, false);
    assert.ok(recorded.summary.blockers.includes("search:captcha"));
    const next = await runBsg(["run", "--run", initialized.runDir]);
    assert.equal(next.nextAction, "stop");
    assert.equal(next.requiredUserAction, "rating_blocked");

    const status = await runBsg(["status", "--run", initialized.runDir]);
    assert.equal(status.nextAction, "stop");
    assert.equal(status.pendingUserAction.type, "rating_blocked");
    assert.match(status.nextCommand, /resolve-user-action/);
    assert.doesNotMatch(status.nextCommand, /bsg\.mjs" observe/);
  });

  it("closes inspection for signed or font-obfuscated content", async () => {
    const initialized = await initRun();
    const result = await runBsg([
      "observe", "--run", initialized.runDir,
      "--phase", "content", "--status", "blocked", "--blocker", "encrypt",
      "--render", "csr_encrypted", "--note", "dynamic signature and PUA font",
    ]);

    assert.equal(result.stopInspection, true);
    assert.equal(result.inspectionBoundary, "protected_content_implementation");
    assert.equal(result.nextAction, "record_assessment");
    assert.ok(result.forbiddenActions.includes("parse_obfuscation_font"));
    assert.ok(result.forbiddenActions.includes("implement_site_decoder"));
  });
});
