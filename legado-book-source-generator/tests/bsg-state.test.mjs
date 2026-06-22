import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const BSG = path.join(ROOT, "scripts", "bsg.mjs");
const noDeviceEnv = {
  ...process.env,
  BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
};

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bsg-state-"));
}

async function runBsg(args, options = {}) {
  const result = await execFileAsync("node", [BSG, ...args], {
    encoding: "utf8",
    ...options,
  });
  return JSON.parse(result.stdout);
}

async function runBsgBlocked(args, options = {}) {
  try {
    await runBsg(args, options);
  } catch (err) {
    const result = JSON.parse(err.stdout);
    assert.equal(result.status, "blocked");
    return result;
  }
  assert.fail("Expected bsg command to exit non-zero with status=blocked");
}

async function initRun(tmpDir, options = {}) {
  const init = await runBsg(["init", "https://example.com", "--cwd", tmpDir], options);
  await runBsg(["advance", "--run", init.runDir]);
  await runBsg(["advance", "--run", init.runDir]);
  return init.runDir;
}

async function writeRequiredDeliverFiles(tmpDir, runDir) {
  await writeSiteFacts(runDir);
  await fs.writeFile(path.join(runDir, "assessment.md"), assessmentContent(["- 四链路已记录 evidence:search-1 evidence:detail-1 evidence:toc-1 evidence:content-1"]), "utf8");
  await runBsg(["record-assessment", "--run", runDir]);
  await runBsg(["advance", "--run", runDir]);
  await fs.writeFile(path.join(runDir, "analysis.md"), "# 网站分析\n", "utf8");
  await runBsg(["advance", "--run", runDir]);
  await writeValidSource(tmpDir);
  await runBsg(["advance", "--run", runDir]);
  await fs.writeFile(path.join(runDir, "validation-checklist.md"), "# 清单\n", "utf8");
  await writeGeneratedValidatorReport(runDir, { status: "needs_app_review" });
  await fs.writeFile(path.join(runDir, "validator-summary.md"), "# summary\n", "utf8");
}

async function writeValidSource(tmpDir, overrides = {}) {
  const sourceDir = path.join(tmpDir, "outputs", "example-com");
  await fs.mkdir(sourceDir, { recursive: true });
  const source = {
    bookSourceUrl: "https://example.com",
    bookSourceName: "Example",
    searchUrl: "https://example.com/search?q={{key}}",
    ruleSearch: { bookList: "$.items", name: "$.title", bookUrl: "$.url" },
    ruleBookInfo: { name: "$.title" },
    ruleToc: { chapterList: "$.chapters", chapterName: "$.title", chapterUrl: "$.url" },
    ruleContent: { content: "$.content" },
    ...overrides,
  };
  await fs.writeFile(path.join(sourceDir, "book-source.json"), JSON.stringify([source]), "utf8");
}

async function writeGeneratedValidatorReport(runDir, report) {
  const state = JSON.parse(await fs.readFile(path.join(runDir, "run-state.json"), "utf8"));
  const sourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  const sourceBytes = await fs.readFile(sourcePath);
  await fs.writeFile(path.join(runDir, "validator-report.json"), JSON.stringify({
    _generatedBy: "validate-with-validator.mjs",
    _schemaVersion: "1.0",
    _runDir: runDir,
    _sourceHash: createHash("sha256").update(sourceBytes).digest("hex"),
    ...report,
  }), "utf8");
}

async function advanceToGenerate(tmpDir, runDir) {
  await writeAssessmentAndRecord(runDir);
  await runBsg(["advance", "--run", runDir]);
  await fs.writeFile(path.join(runDir, "analysis.md"), "# 网站分析\n", "utf8");
  await runBsg(["advance", "--run", runDir]);
  await fs.mkdir(path.join(tmpDir, "outputs", "example-com"), { recursive: true });
}

async function advanceToValidateWithWebViewSource(tmpDir, runDir) {
  await advanceToGenerate(tmpDir, runDir);
  await writeValidSource(tmpDir, {
    ruleToc: { chapterList: "$.chapters", chapterName: "$.title", chapterUrl: "{{$.url}},{\"webView\":true}" },
    respondTime: 180000,
  });
  await runBsg(["advance", "--run", runDir]);
}

function assessmentContent(evidenceLines = [], remarkLines = []) {
  return [
    "# 网站可生成性评估",
    "",
    "<!-- AUTO:BEGIN summary -->",
    "<!-- AUTO:HASH pending -->",
    "- 站点 URL: https://example.com",
    "- 评级: 待评估",
    "- 风险标签: 待评估",
    "- 总体状态: pending",
    "- 搜索链路: unknown",
    "- 详情链路: unknown",
    "- 目录链路: unknown",
    "- 正文链路: unknown",
    "- 登录/Android/WebView: 待评估",
    "- 阻塞原因: 待评估",
    "- 待确认动作: 无",
    "<!-- AUTO:END summary -->",
    "",
    "## 证据说明",
    "",
    ...(evidenceLines.length > 0 ? evidenceLines : ["- 当前四链路事实来自 site-facts.json evidence:search-1 evidence:detail-1 evidence:toc-1 evidence:content-1"]),
    "",
    "## 分析备注",
    "",
    ...remarkLines,
    "",
  ].join("\n");
}

async function writeSiteFacts(runDir, overrides = {}) {
  const links = {};
  for (const phase of ["search", "detail", "toc", "content"]) {
    links[phase] = {
      status: "success",
      blocker: null,
      render: phase === "content" ? "ssr_or_http" : null,
      evidenceIds: [`${phase}-1`],
      ...(overrides.links?.[phase] || {}),
    };
  }
  await fs.writeFile(path.join(runDir, "site-facts.json"), JSON.stringify({
    version: "1.0",
    siteUrl: "https://example.com",
    links,
    evidence: [
      { id: "search-1", phase: "search", kind: "html", note: "search evidence" },
      { id: "detail-1", phase: "detail", kind: "html", note: "detail evidence" },
      { id: "toc-1", phase: "toc", kind: "html", note: "toc evidence" },
      { id: "content-1", phase: "content", kind: "html", note: "content evidence" },
      ...(overrides.evidence || []),
    ],
  }, null, 2), "utf8");
}

function factsFromRemarks(lines = []) {
  const text = lines.join("\n");
  const links = {};
  if (/WebView\s*依赖/i.test(text)) {
    links.content = { render: "webview" };
  }
  if (/VIP|付费|订阅|会员|登录态|需登录|需要登录|Cookie|Authorization|401|403/i.test(text)) {
    links.content = { ...(links.content || {}), blocker: "vip" };
  }
  return { links };
}

async function writeAssessmentAndRecord(runDir, lines = [], factsOverrides = null) {
  await writeSiteFacts(runDir, factsOverrides || factsFromRemarks(lines));
  await fs.writeFile(path.join(runDir, "assessment.md"), assessmentContent([], lines), "utf8");
  return runBsg(["record-assessment", "--run", runDir]);
}

function searchCaptchaFacts() {
  return {
    links: {
      search: { status: "blocked", blocker: "captcha" },
      detail: { status: "success" },
      toc: { status: "success" },
      content: { status: "success", render: "ssr_or_http" },
    },
  };
}

describe("bsg workflow user-action gates", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("refuses to advance assessment before record-assessment passes", async () => {
    const runDir = await initRun(tmpDir);
    await fs.writeFile(path.join(runDir, "assessment.md"), [
      "- 评级: 可生成",
      "- 登录需求: 否",
      "- 风险标签: 无风险",
    ].join("\n"), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "advance", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /record-assessment/);
        return true;
      },
    );
  });

  it("record-assessment generates AUTO summary from site facts", async () => {
    const runDir = await initRun(tmpDir);
    const result = await writeAssessmentAndRecord(runDir);
    const content = await fs.readFile(path.join(runDir, "assessment.md"), "utf8");

    assert.equal(result.ok, true);
    assert.equal(result.signals.protectedContent, false);
    assert.match(content, /<!-- AUTO:HASH [a-f0-9]{16} -->/);
    assert.match(content, /- 总体状态: full_pass_candidate/);
    assert.match(content, /- full pass: 是/);
  });

  it("derives Android entry review action from search CAPTCHA blocker", async () => {
    const runDir = await initRun(tmpDir);
    const result = await writeAssessmentAndRecord(runDir, [], searchCaptchaFacts());
    const content = await fs.readFile(path.join(runDir, "assessment.md"), "utf8");

    assert.equal(result.summary.overallStatus, "partial_candidate");
    assert.deepEqual(result.summary.blockers, ["search:captcha"]);
    assert.ok(result.summary.requiredActions.includes("android_entry_review_needed"));
    assert.equal(result.signals.hasEntryAntiBotRisk, true);
    assert.match(content, /- 待确认动作: .*android_entry_review_needed/);
  });

  it("rejects assessment when site facts are incomplete", async () => {
    const runDir = await initRun(tmpDir);
    await fs.writeFile(path.join(runDir, "assessment.md"), assessmentContent(), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-assessment", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /site-facts\.json|四链路事实不完整/);
        return true;
      },
    );
  });

  it("rejects manual edits inside AUTO summary", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir);
    const assessPath = path.join(runDir, "assessment.md");
    const content = await fs.readFile(assessPath, "utf8");
    await fs.writeFile(assessPath, content.replace("- 风险标签: 无风险", "- 风险标签: 需登录态"), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-assessment", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /自动结论区被手动修改/);
        return true;
      },
    );
  });

  it("rejects manual edits inside pending AUTO summary before first record-assessment", async () => {
    const runDir = await initRun(tmpDir);
    await writeSiteFacts(runDir);
    const assessPath = path.join(runDir, "assessment.md");
    await fs.writeFile(
      assessPath,
      assessmentContent().replace("- 搜索链路: unknown", "- 搜索链路: blocked"),
      "utf8",
    );

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-assessment", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /自动结论区|AUTO|手动修改/);
        return true;
      },
    );
  });

  it("rejects evidence notes without a valid evidence id", async () => {
    const runDir = await initRun(tmpDir);
    await writeSiteFacts(runDir);
    await fs.writeFile(path.join(runDir, "assessment.md"), assessmentContent(["- 搜索看起来正常"]), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-assessment", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /evidence id|evidence:/);
        return true;
      },
    );
  });

  it("records pending android action when WebView assessment has no Android decision", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, ["- 评级: 可生成", "- 风险标签: WebView 依赖"]);

    const result = await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });
    const state = JSON.parse(await fs.readFile(path.join(runDir, "run-state.json"), "utf8"));

    assert.equal(result.requiredUserAction, "android_device_needed");
    assert.equal(state.pendingUserAction?.type, "android_device_needed");
    assert.equal(state.pendingUserAction?.resolved, false);
  });

  it("blocks after assessment when search CAPTCHA needs entry-chain Android review and no device is available", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, [], searchCaptchaFacts());

    const result = await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    assert.equal(result.requiredUserAction, "android_entry_review_needed");
    assert.equal(result.reason, "entry_antibot_requires_android_decision");
    assert.match(result.message, /搜索|入口|Android|模拟器/);
  });

  it("blocks after assessment when adb is online and search CAPTCHA needs Android Probe recheck", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, [], searchCaptchaFacts());

    const result = await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
      },
    });

    assert.equal(result.requiredUserAction, "android_entry_review_needed");
    assert.equal(result.android?.state, "device_ready");
    assert.match(result.message, /Android Probe|入口|搜索/);
  });

  it("does not allow skipping entry Android review after a device becomes available", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, [], searchCaptchaFacts());

    await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    await assert.rejects(
      () => execFileAsync("node", [BSG, "resolve-user-action", "--run", runDir, "--action", "continue_after_entry_risk"], {
        encoding: "utf8",
        env: {
          ...process.env,
          BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
        },
      }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /Android 真机或模拟器在线|android_device_ready/);
        return true;
      },
    );

    const resolved = await runBsg(["resolve-user-action", "--run", runDir, "--action", "android_device_ready"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
      },
    });
    assert.equal(resolved.action, "android_device_ready");
  });

  it("blocks record-validation while android user action is pending", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, ["- 评级: 可生成", "- 风险标签: WebView 依赖"]);
    await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-validation", "--run", runDir, "--status", "needs_app_review"], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /待用户确认动作/);
        return true;
      },
    );
  });

  it("allows assessment to continue after user confirms Android is unavailable", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, ["- 评级: 可生成", "- 风险标签: WebView 依赖"]);
    await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    const resolved = await runBsg(["resolve-user-action", "--run", runDir, "--action", "android_device_unavailable"], { env: noDeviceEnv });
    const advanced = await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    assert.equal(resolved.ok, true);
    assert.equal(advanced.nextAction, "write_analysis");
    assert.equal(advanced.requiredUserAction, null);
  });

  it("rejects fabricated user login choice in assessment", async () => {
    const runDir = await initRun(tmpDir);
    await writeSiteFacts(runDir, { links: { content: { blocker: "vip" } } });
    await fs.writeFile(path.join(runDir, "assessment.md"), assessmentContent([], [
      "- 用户选择: 不登录分析",
    ]), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-assessment", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /不要编用户选择|no_account/);
        return true;
      },
    );
  });

  it("derives login risk from facts even if AI remarks say no risk", async () => {
    const runDir = await initRun(tmpDir);
    const result = await writeAssessmentAndRecord(
      runDir,
      ["- AI 备注: 无风险，无需登录"],
      { links: { content: { blocker: "vip" } } },
    );
    const content = await fs.readFile(path.join(runDir, "assessment.md"), "utf8");

    assert.equal(result.signals.protectedContent, true);
    assert.match(content, /- 风险标签: 需登录态/);
    assert.match(content, /- 登录需求: 部分需要/);
  });

  it("normalizes ok status and derives WebView/encryption risk from csr_encrypted render", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, [], {
      links: {
        search: { status: "ok" },
        detail: { status: "ok" },
        toc: { status: "ok" },
        content: { status: "ok", render: "csr_encrypted" },
      },
    });
    const content = await fs.readFile(path.join(runDir, "assessment.md"), "utf8");

    assert.match(content, /- 评级: 可生成/);
    assert.match(content, /- 风险标签: .*WebView 依赖/);
    assert.match(content, /- 风险标签: .*加密正文/);
    assert.match(content, /- 总体状态: partial_candidate/);
    assert.match(content, /- full pass: 否/);
    assert.match(content, /- 正文链路: success \(csr_encrypted\)/);
    assert.match(content, /- 登录\/Android\/WebView: android_device_needed/);
    assert.doesNotMatch(content, /- 评级: 不建议生成[\s\S]*- 风险标签: 无风险/);
  });

  it("rejects free-form render labels before deriving assessment", async () => {
    const runDir = await initRun(tmpDir);
    await writeSiteFacts(runDir, { links: { content: { render: "normal_reading" } } });
    await fs.writeFile(path.join(runDir, "assessment.md"), assessmentContent(), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-assessment", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /render|normal_reading/);
        return true;
      },
    );
  });

  it("rejects unstructured link status before deriving assessment", async () => {
    const runDir = await initRun(tmpDir);
    await writeSiteFacts(runDir, { links: { search: { status: "available" } } });
    await fs.writeFile(path.join(runDir, "assessment.md"), assessmentContent(), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-assessment", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /site-facts\.json|status|search/);
        return true;
      },
    );
  });

  it("asks about Android availability before Browser login when assessment mentions VIP subscription", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, [
      "- 评级: 可生成",
      "- 登录需求: 部分需要（VIP章节需登录+订阅）",
      "- 用户选择: 登录分析 / 不登录分析",
      "- 当前分析会话: 匿名 / 已登录 / 登录失败",
      "- 风险标签: 需登录态",
      "- 会员限制: VIP章节需订阅",
    ]);

    const result = await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    assert.equal(result.requiredUserAction, "android_device_needed");
    assert.equal(result.reason, "login_requires_android_decision");
  });

  it("asks for login only after user confirms Android is unavailable", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, [
      "- 评级: 可生成",
      "- 登录需求: 部分需要（VIP章节需登录+订阅）",
      "- 用户选择: 登录分析 / 不登录分析",
      "- 当前分析会话: 匿名 / 已登录 / 登录失败",
      "- 风险标签: 需登录态",
      "- 会员限制: VIP章节需订阅",
    ]);
    await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });
    await runBsg(["resolve-user-action", "--run", runDir, "--action", "android_device_unavailable"], { env: noDeviceEnv });

    const result = await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    assert.equal(result.requiredUserAction, "login_required");
    assert.equal(result.reason, "login_required");
    assert.equal(result.adbAvailable, false);
  });

  it("does not accept Browser cookies as login when adb is online", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, [
      "- 评级: 可生成",
      "- 登录需求: 是",
      "- 用户选择: 登录分析 / 不登录分析",
      "- 当前分析会话: 匿名 / 已登录 / 登录失败",
      "- 风险标签: 需登录态",
    ]);
    await fs.writeFile(path.join(runDir, "cookies.json"), JSON.stringify({
      "www.example.com": "a=b; c=d",
    }), "utf8");

    const result = await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
      },
    });

    assert.equal(result.requiredUserAction, "login_required");
    assert.equal(result.android?.state, "device_ready");
  });

  it("does not treat Browser cookies as login without an explicit user decision", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, [
      "- 评级: 可生成",
      "- 登录需求: 是",
      "- 用户选择: 登录分析 / 不登录分析",
      "- 当前分析会话: 匿名 / 已登录 / 登录失败",
      "- 风险标签: 需登录态",
    ]);
    await fs.writeFile(path.join(runDir, "cookies.json"), JSON.stringify({
      "www.example.com": "a=b; c=d",
    }), "utf8");

    const result = await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    assert.equal(result.requiredUserAction, "android_device_needed");
    assert.equal(result.reason, "login_requires_android_decision");
  });

  it("does not resolve Browser login completion without a valid cookies file", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, [
      "- 评级: 可生成",
      "- 登录需求: 是",
      "- 用户选择: 登录分析 / 不登录分析",
      "- 当前分析会话: 匿名 / 已登录 / 登录失败",
      "- 风险标签: 需登录态",
    ]);
    await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });
    await runBsg(["resolve-user-action", "--run", runDir, "--action", "android_device_unavailable"], { env: noDeviceEnv });
    await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    await assert.rejects(
      () => execFileAsync("node", [BSG, "resolve-user-action", "--run", runDir, "--action", "login_completed"], {
        encoding: "utf8",
        env: {
          ...process.env,
          BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
        },
      }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /cookies\.json|Cookie/);
        return true;
      },
    );
  });

  it("does not resolve Probe login completion without Probe cookies when adb is online", async () => {
    const runDir = await initRun(tmpDir);
    await writeAssessmentAndRecord(runDir, [
      "- 评级: 可生成",
      "- 登录需求: 是",
      "- 用户选择: 登录分析 / 不登录分析",
      "- 当前分析会话: 匿名 / 已登录 / 登录失败",
      "- 风险标签: 需登录态",
    ]);
    await runBsg(["advance", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
      },
    });

    await assert.rejects(
      () => execFileAsync("node", [BSG, "resolve-user-action", "--run", runDir, "--action", "login_completed"], {
        encoding: "utf8",
        env: {
          ...process.env,
          BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
          BSG_TEST_PROBE_COOKIE_CHECK: JSON.stringify({ hasCookies: false, cookies: "", url: "https://example.com" }),
        },
      }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /Probe|cookie-check|Cookie/);
        return true;
      },
    );
  });

  it("refuses deliver when validation was fabricated without record-validation", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);

    await assert.rejects(
      () => execFileAsync("node", [BSG, "deliver", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /deliver 阶段|advance|record-validation|验证状态/);
        return true;
      },
    );
  });

  it("requires record-validation then advance before deliver", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    });

    const recorded = await runBsg(["record-validation", "--run", runDir, "--status", "passed"]);
    assert.equal(recorded.nextAction, "advance");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "deliver", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /先运行 advance|不能跳过 advance|deliver 阶段/);
        return true;
      },
    );

    const advanced = await runBsg(["advance", "--run", runDir]);
    assert.equal(advanced.nextAction, "deliver");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "advance", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /运行 deliver|不要用 advance/);
        return true;
      },
    );

    const delivered = await runBsg(["deliver", "--run", runDir]);
    assert.equal(delivered.finalStatus, "passed");
  });

  it("rejects record-validation status that rewrites the validator report status", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await writeValidSource(tmpDir);
    await runBsg(["advance", "--run", runDir]);
    await writeGeneratedValidatorReport(runDir, {
      status: "failed",
      mode: "android",
      phases: { search: "error", detail: "unknown", toc: "unknown", content: "unknown" },
      steps: [{
        phase: "search",
        status: "error",
        mode: "android",
        errorCode: "APP_REVIEW_REQUIRED",
        error: "搜索结果为空",
        request: { url: "https://example.com/search?q=abc" },
      }],
    });

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-validation", "--run", runDir, "--status", "degraded"], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /status failed 不一致|不能把 failed 改写成 degraded/);
        return true;
      },
    );
  });

  it("moves back to generate after validator failed so the source can be repaired", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await writeValidSource(tmpDir);
    await runBsg(["advance", "--run", runDir]);
    await writeGeneratedValidatorReport(runDir, {
      status: "failed",
      phases: { search: "success", detail: "success", toc: "success", content: "error" },
      steps: [{
        phase: "content",
        status: "error",
        errorCode: "CONTENT_EMPTY",
        failedField: "ruleContent.content",
        error: "内容为空",
        request: { url: "https://example.com/chapter/1" },
      }],
    });

    const recorded = await runBsg(["record-validation", "--run", runDir, "--status", "failed"]);
    assert.equal(recorded.status, "failed");
    assert.equal(recorded.nextAction, "repair_in_generate");
    assert.equal(recorded.repairContext.phase, "content");
    assert.equal(recorded.repairContext.failedField, "ruleContent.content");
    assert.match(recorded.message, /回退到 generate/);

    const state = JSON.parse(await fs.readFile(path.join(runDir, "run-state.json"), "utf8"));
    assert.equal(state.phases.generate.status, "in_progress");
    assert.equal(state.phases.validate.status, "pending");
    assert.equal(state.repairContext.failedField, "ruleContent.content");

    const changed = await runBsg([
      "source", "set",
      "--run", runDir,
      "--path", "ruleContent.content",
      "--value", "$.body",
    ]);
    assert.equal(changed.phase, "generate");

    const advanced = await runBsg(["advance", "--run", runDir]);
    assert.equal(advanced.nextAction, "run_validator");
    const repairedState = JSON.parse(await fs.readFile(path.join(runDir, "run-state.json"), "utf8"));
    assert.equal(repairedState.repairContext, undefined);
  });

  it("preserves repeated validator failure counts across generate repair rounds", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await writeValidSource(tmpDir);
    await runBsg(["advance", "--run", runDir]);

    async function recordSameFailure() {
      await writeGeneratedValidatorReport(runDir, {
        status: "failed",
        phases: { search: "success", detail: "success", toc: "success", content: "error" },
        steps: [{
          phase: "content",
          status: "error",
          errorCode: "CONTENT_EMPTY",
          failedField: "ruleContent.content",
          error: "内容为空",
          request: { url: "https://example.com/chapter/1" },
        }],
      });
      return runBsg(["record-validation", "--run", runDir, "--status", "failed"]);
    }

    const first = await recordSameFailure();
    assert.equal(first.consecutiveSame, 1);
    await runBsg(["advance", "--run", runDir]);

    const second = await recordSameFailure();
    assert.equal(second.consecutiveSame, 2);
    assert.match(second.message, /同一错误第 2 次/);
    const state = JSON.parse(await fs.readFile(path.join(runDir, "run-state.json"), "utf8"));
    assert.equal(state.phases.generate.status, "in_progress");
    assert.equal(state.phases.validate.consecutiveSame, 2);
  });

  it("refuses record-validation before validate phase is active", async () => {
    const runDir = await initRun(tmpDir);
    await writeValidSource(tmpDir);

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-validation", "--run", runDir, "--status", "passed"], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /validate 阶段|record-validation/);
        return true;
      },
    );
  });

  it("rejects external validator report paths", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    const externalReport = path.join(tmpDir, "manual-validator-report.json");
    await fs.writeFile(externalReport, JSON.stringify({
      status: "validator_limitation",
      phases: { search: "blocked" },
      steps: [{ phase: "search", status: "blocked", errorCode: "CONTENT_IS_CAPTCHA_PAGE" }],
    }), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-validation", "--run", runDir, "--status", "validator_limitation", "--report", externalReport], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /--report|validate-with-validator|不再接受/);
        return true;
      },
    );
  });

  it("rejects hand-written validator report in run directory", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.writeFile(path.join(runDir, "validator-report.json"), JSON.stringify({
      status: "validator_limitation",
      phases: { search: "blocked" },
      steps: [{ phase: "search", status: "blocked", errorCode: "CONTENT_IS_CAPTCHA_PAGE" }],
    }), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-validation", "--run", runDir, "--status", "validator_limitation"], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /validator-report\.json.*validate-with-validator|手写|来源/);
        return true;
      },
    );
  });

  it("creates a debug bundle with run files, source output, transcript, and redacted cookies", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.writeFile(path.join(runDir, "cookies.json"), JSON.stringify({
      "www.example.com": "session=secret; token=hidden",
    }), "utf8");
    const transcriptPath = path.join(tmpDir, "claude-log.md");
    await fs.writeFile(transcriptPath, "# Claude log\n\ntranscript body\n", "utf8");

    const result = await runBsg([
      "debug-bundle",
      "--run", runDir,
      "--transcript", transcriptPath,
      "--claude-session", "01300c68-e5a5-4b98-baf9-22fdfc352cac",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.includedTranscript, true);
    assert.match(result.bundleDir, /debug-bundles/);

    const manifest = JSON.parse(await fs.readFile(path.join(result.bundleDir, "manifest.json"), "utf8"));
    assert.equal(manifest.siteSlug, "example-com");
    assert.equal(manifest.claude.sessionId, "01300c68-e5a5-4b98-baf9-22fdfc352cac");

    const bundledSource = await fs.readFile(path.join(result.bundleDir, "outputs", "example-com", "book-source.json"), "utf8");
    assert.match(bundledSource, /Example/);

    const bundledTranscript = await fs.readFile(path.join(result.bundleDir, "transcript", "claude-log.md"), "utf8");
    assert.match(bundledTranscript, /transcript body/);

    await assert.rejects(
      () => fs.readFile(path.join(result.bundleDir, "run", "cookies.json"), "utf8"),
      /ENOENT/,
    );
    const redactedCookies = await fs.readFile(path.join(result.bundleDir, "run", "cookies.redacted.json"), "utf8");
    assert.doesNotMatch(redactedCookies, /secret|hidden/);
    assert.match(redactedCookies, /REDACTED/);
  });

  it("creates a debug bundle from the latest run in a work directory", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);

    const result = await runBsg(["debug-bundle", "--cwd", tmpDir]);

    assert.equal(result.ok, true);
    assert.equal(result.runDir, runDir);
    assert.match(result.bundleDir, /debug-bundles/);
    const manifest = JSON.parse(await fs.readFile(path.join(result.bundleDir, "manifest.json"), "utf8"));
    assert.equal(manifest.runDir, runDir);
  });

  it("exports Claude Code transcript automatically with claude-code-log", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    const sessionId = "01300c68-e5a5-4b98-baf9-22fdfc352cac";
    const claudeHome = path.join(tmpDir, ".claude");
    const jsonlDir = path.join(claudeHome, "projects", "D--Narylr-skill-test");
    await fs.mkdir(jsonlDir, { recursive: true });
    await fs.writeFile(path.join(jsonlDir, `${sessionId}.jsonl`), JSON.stringify({
      type: "user",
      message: { content: "生成书源" },
    }) + "\n", "utf8");
    const fakeExporter = path.join(tmpDir, "fake-claude-code-log.mjs");
    await fs.writeFile(fakeExporter, [
      "import fs from 'node:fs';",
      "const out = process.argv[process.argv.indexOf('-o') + 1];",
      "fs.writeFileSync(out, '# exported by claude-code-log\\n\\n' + process.argv.join(' ') + '\\n', 'utf8');",
    ].join("\n"), "utf8");

    const result = await runBsg([
      "debug-bundle",
      "--run", runDir,
      "--claude-session", sessionId,
    ], {
      env: {
        ...process.env,
        BSG_TEST_CLAUDE_HOME: claudeHome,
        BSG_CLAUDE_CODE_LOG_COMMAND: JSON.stringify([process.execPath, fakeExporter]),
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.includedTranscript, true);
    const exported = await fs.readFile(path.join(result.bundleDir, "transcript", "claude-code-log.md"), "utf8");
    assert.match(exported, /--detail high/);
    const manifest = JSON.parse(await fs.readFile(path.join(result.bundleDir, "manifest.json"), "utf8"));
    assert.equal(manifest.claude.transcriptSource.endsWith(`${sessionId}.jsonl`), true);
    assert.notEqual(manifest.claude.exporter, "raw-jsonl-fallback");
    assert.equal(manifest.claude.exporterError, null);
  });

  it("exports the latest Claude Code transcript when no session id is provided", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    const claudeHome = path.join(tmpDir, ".claude");
    const jsonlDir = path.join(claudeHome, "projects", "D--Narylr-skill-test");
    await fs.mkdir(jsonlDir, { recursive: true });
    const oldSessionId = "11111111-1111-4111-8111-111111111111";
    const latestSessionId = "22222222-2222-4222-8222-222222222222";
    const oldPath = path.join(jsonlDir, `${oldSessionId}.jsonl`);
    const latestPath = path.join(jsonlDir, `${latestSessionId}.jsonl`);
    await fs.writeFile(oldPath, "{\"type\":\"user\"}\n", "utf8");
    await fs.writeFile(latestPath, "{\"type\":\"assistant\"}\n", "utf8");
    const oldDate = new Date("2024-01-01T00:00:00Z");
    const latestDate = new Date("2024-01-02T00:00:00Z");
    await fs.utimes(oldPath, oldDate, oldDate);
    await fs.utimes(latestPath, latestDate, latestDate);
    const fakeExporter = path.join(tmpDir, "fake-claude-code-log-latest.mjs");
    await fs.writeFile(fakeExporter, [
      "import fs from 'node:fs';",
      "const input = process.argv.find((arg) => arg.endsWith('.jsonl'));",
      "const out = process.argv[process.argv.indexOf('-o') + 1];",
      "fs.writeFileSync(out, `# ${input}\\n`, 'utf8');",
    ].join("\n"), "utf8");

    const result = await runBsg(["debug-bundle", "--run", runDir], {
      env: {
        ...process.env,
        BSG_TEST_CLAUDE_HOME: claudeHome,
        BSG_CLAUDE_CODE_LOG_COMMAND: JSON.stringify([process.execPath, fakeExporter]),
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.includedTranscript, true);
    const manifest = JSON.parse(await fs.readFile(path.join(result.bundleDir, "manifest.json"), "utf8"));
    assert.equal(manifest.claude.sessionId, latestSessionId);
    assert.equal(manifest.claude.transcriptSource, latestPath);
  });

  it("prefers the latest Claude Code transcript for the requested work directory", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    const claudeHome = path.join(tmpDir, ".claude");
    const matchingDir = path.join(claudeHome, "projects", "C--Users-Tester-skill-test");
    const otherDir = path.join(claudeHome, "projects", "C--Users-Tester-other-project");
    await fs.mkdir(matchingDir, { recursive: true });
    await fs.mkdir(otherDir, { recursive: true });
    const matchingSessionId = "33333333-3333-4333-8333-333333333333";
    const otherSessionId = "44444444-4444-4444-8444-444444444444";
    const matchingPath = path.join(matchingDir, `${matchingSessionId}.jsonl`);
    const otherPath = path.join(otherDir, `${otherSessionId}.jsonl`);
    await fs.writeFile(matchingPath, "{\"type\":\"user\"}\n", "utf8");
    await fs.writeFile(otherPath, "{\"type\":\"assistant\"}\n", "utf8");
    await fs.utimes(matchingPath, new Date("2024-01-01T00:00:00Z"), new Date("2024-01-01T00:00:00Z"));
    await fs.utimes(otherPath, new Date("2024-01-02T00:00:00Z"), new Date("2024-01-02T00:00:00Z"));
    const fakeExporter = path.join(tmpDir, "fake-claude-code-log-cwd.mjs");
    await fs.writeFile(fakeExporter, [
      "import fs from 'node:fs';",
      "const input = process.argv.find((arg) => arg.endsWith('.jsonl'));",
      "const out = process.argv[process.argv.indexOf('-o') + 1];",
      "fs.writeFileSync(out, `# ${input}\\n`, 'utf8');",
    ].join("\n"), "utf8");

    const result = await runBsg(["debug-bundle", "--run", runDir, "--cwd", "C:/Users/Tester/skill-test"], {
      env: {
        ...process.env,
        BSG_TEST_CLAUDE_HOME: claudeHome,
        BSG_CLAUDE_CODE_LOG_COMMAND: JSON.stringify([process.execPath, fakeExporter]),
      },
    });

    assert.equal(result.ok, true);
    const manifest = JSON.parse(await fs.readFile(path.join(result.bundleDir, "manifest.json"), "utf8"));
    assert.equal(manifest.claude.sessionId, matchingSessionId);
    assert.equal(manifest.claude.transcriptSource, matchingPath);
  });

  it("classifies unauthorized adb devices as user authorization required", async () => {
    const result = await runBsg(["android-status"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tunauthorized\n",
      },
    });

    assert.equal(result.android.state, "unauthorized");
    assert.equal(result.requiredUserAction, "authorize_usb_debugging");
  });

  it("reports Probe diagnostics when Android device is ready", async () => {
    const result = await runBsg(["android-status"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
        BSG_TEST_PROBE_INFO: JSON.stringify({
          name: "legado-android-probe",
          version: "0.2.0",
          api: ["/render", "/login", "/cookie-check", "/cookie-clear", "/ping", "/info"],
          webViewVersion: "118.0.5993.80",
        }),
      },
    });

    assert.equal(result.android.state, "device_ready");
    assert.equal(result.probe.state, "ready");
    assert.equal(result.probe.info.version, "0.2.0");
    assert.deepEqual(result.probe.api, ["/render", "/login", "/cookie-check", "/cookie-clear", "/ping", "/info"]);
  });

  it("blocks passed HTTP validation when generated source contains WebView and Android is available", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToValidateWithWebViewSource(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    });

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "passed"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "android_probe_not_used");
    assert.equal(result.forbiddenActions.includes("deliver"), true);
    assert.equal(result.forbiddenActions.includes("validate_http"), true);
    assert.equal(result.forbiddenActions.includes("record_needs_app_review"), true);
    assert.match(result.correctiveAction, /禁止.*deliver|禁止.*交付/);
    assert.match(result.correctiveAction, /validate --run .* --mode android/);
  });

  it("blocks HTTP validation after Probe login when Android is available", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    });
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "passed"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "android_probe_not_used");
    assert.match(result.message, /Probe 登录/);
    assert.doesNotMatch(result.message, /login\s*→/i);
    assert.match(result.message, /validate --run dir --mode android/);
  });

  it("blocks HTTP validation after Probe login when Android disconnected", async () => {
    const runDir = await initRun(tmpDir, {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
      },
    });
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    });
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "passed"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "android_device_disconnected");
    assert.match(result.message, /真机或模拟器已断开/);
  });

  it("downgrades WebView source to validator_limitation when Android is unavailable", async () => {
    const noAndroidEnv = {
      ...process.env,
      BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
    };
    const runDir = await initRun(tmpDir, { env: noAndroidEnv });
    await advanceToValidateWithWebViewSource(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [
        { phase: "search", status: "success", mode: "http" },
        { phase: "detail", status: "success", mode: "http" },
        { phase: "toc", status: "success", mode: "http" },
        { phase: "content", status: "success", mode: "http", preview: "电脑端正文预览" },
      ],
    });

    const recorded = await runBsg(["record-validation", "--run", runDir, "--status", "passed"], {
      env: noAndroidEnv,
    });

    assert.equal(recorded.status, "validator_limitation");
    assert.match(recorded.androidWarning, /Android Probe 不可用|WebView 正文/);

    await runBsg(["advance", "--run", runDir]);
    const delivered = await runBsg(["deliver", "--run", runDir]);
    assert.equal(delivered.finalStatus, "validator_limitation");
    assert.match(delivered.message, /不能标可用|App\/WebView/);
  });

  it("blocks malformed cookies json during validation recording", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({ hasEnabledCookieJar: true })]);
    await fs.writeFile(path.join(runDir, "cookies.json"), JSON.stringify({
      domain: "a=b; c=d",
    }), "utf8");

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "needs_app_review"]);

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "cookie_not_injected");
    assert.match(result.message, /缺少真实域名键/);
  });

  it("accepts Probe-injected cookies in android reports without requiring cookies.json", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await writeValidSource(tmpDir, {
      enabledCookieJar: true,
      loginUrl: "https://example.com/login",
      header: "<js>JSON.stringify({'Cookie': java.getCookie('https://example.com') || ''})</js>",
    });
    await runBsg(["advance", "--run", runDir]);
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
      _loginVerified: true,
    })]);
    await writeGeneratedValidatorReport(runDir, {
      status: "failed",
      mode: "android",
      phases: { search: "error", detail: "unknown", toc: "unknown", content: "unknown" },
      steps: [{
        phase: "search",
        status: "error",
        mode: "android",
        androidProbeUsed: true,
        androidBackend: "probe_webview",
        errorCode: "APP_REVIEW_REQUIRED",
        error: "搜索结果为空",
        request: { url: "https://example.com/search?q=abc", headers: { Cookie: "session=probe" } },
      }],
    });

    const result = await runBsg(["record-validation", "--run", runDir, "--status", "failed"]);

    assert.equal(result.status, "failed");
    assert.equal(result.nextAction, "repair_in_generate");
    assert.notEqual(result.blockedBy, "cookie_not_injected");
  });

  it("blocks Probe login when android report only used PC HTTP transport", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await writeValidSource(tmpDir, {
      enabledCookieJar: true,
      loginUrl: "https://example.com/login",
      header: "<js>JSON.stringify({'Cookie': java.getCookie('https://example.com') || ''})</js>",
    });
    await runBsg(["advance", "--run", runDir]);
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
      _loginVerified: true,
    })]);
    await writeGeneratedValidatorReport(runDir, {
      status: "failed",
      mode: "android",
      phases: { search: "error", detail: "unknown", toc: "unknown", content: "unknown" },
      steps: [{
        phase: "search",
        status: "error",
        mode: "android",
        androidProbeUsed: false,
        androidBackend: "pc_http",
        errorCode: "APP_REVIEW_REQUIRED",
        error: "搜索结果为空",
        request: { url: "https://example.com/search?q=abc", headers: { Cookie: "session=probe" } },
      }],
    });

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "failed"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
      },
    });

    assert.equal(result.blockedBy, "android_probe_not_used");
  });

  it("requires explicit Android availability decision before accepting needs_app_review", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "error", detail: "success", toc: "success", content: "success" },
      steps: [
        { phase: "search", status: "error", error: "CAPTCHA required", response: { title: "验证码" } },
        { phase: "detail", status: "success", response: { bodyPreview: "<h1>book</h1>" } },
        { phase: "toc", status: "success", response: { bodyPreview: "<a>chapter</a>" } },
        { phase: "content", status: "success", response: { bodyPreview: "<p>content</p>" } },
      ],
    });

    const blocked = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "needs_app_review"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedBy, "android_device_needed");
    assert.equal(blocked.requiredUserAction, "android_device_needed");

    await runBsg(["resolve-user-action", "--run", runDir, "--action", "android_device_unavailable"], { env: noDeviceEnv });
    const accepted = await runBsg(["record-validation", "--run", runDir, "--status", "needs_app_review"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    assert.equal(accepted.status, "needs_app_review");
  });

  it("blocks record-validation when site facts changed after record-assessment", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await writeValidSource(tmpDir);
    await runBsg(["advance", "--run", runDir]);
    await writeSiteFacts(runDir, { links: { content: { render: "csr" } } });
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    });

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-validation", "--run", runDir, "--status", "passed"], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /site-facts\.json|record-assessment|评估|回退到 assess/);
        return true;
      },
    );
    const state = JSON.parse(await fs.readFile(path.join(runDir, "run-state.json"), "utf8"));
    assert.equal(state.phases.assess.status, "in_progress");
    assert.equal(state.phases.analyze.status, "pending");
    assert.equal(state.phases.validate.status, "pending");
  });

  it("blocks record-validation when book-source changed after generate checks", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await writeValidSource(tmpDir);
    await runBsg(["advance", "--run", runDir]);
    await writeValidSource(tmpDir, { bookSourceName: "Changed After Generate" });
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    });

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-validation", "--run", runDir, "--status", "passed"], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /book-source\.json|generate|rule-check|回退到 generate/);
        return true;
      },
    );
    const state = JSON.parse(await fs.readFile(path.join(runDir, "run-state.json"), "utf8"));
    assert.equal(state.phases.generate.status, "in_progress");
    assert.equal(state.phases.validate.status, "pending");
  });

  it("blocks needs_app_review when report shows a hard toc rule error", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "error" },
      steps: [
        { phase: "detail", status: "success", extracted: { tocUrl: "https://example.com/chapter-list/" } },
        { phase: "toc", status: "error", request: { url: "https://example.com/chapter-list/" } },
      ],
    });

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "needs_app_review"]);

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "hard_rule_error");
    assert.match(result.message, /tocUrl|chapter-list|规则错误/);
  });

  it("blocks Probe login plus webView source when android report has no WebView render evidence", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToValidateWithWebViewSource(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "android",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{
        phase: "content",
        status: "success",
        mode: "android",
        request: { headers: { Cookie: "a=b" } },
      }],
    });
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "passed"]);

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "android_probe_not_used");
  });

  it("refuses deliver after blocked validation matrix", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToValidateWithWebViewSource(tmpDir, runDir);
    await fs.writeFile(path.join(runDir, "validation-checklist.md"), "# 清单\n", "utf8");
    await writeGeneratedValidatorReport(runDir, {
      mode: "android",
      phases: { search: "error" },
      steps: [
        { phase: "search", status: "error", mode: "android", error: "搜索结果为空" },
      ],
    });

    const blocked = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "validator_limitation"]);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedBy, "android_probe_not_used");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "deliver", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /blocked:android_probe_not_used|验证未完成|record-validation/);
        return true;
      },
    );
  });

  it("blocks Android WebView validation without extracted content evidence", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToValidateWithWebViewSource(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "android",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{
        phase: "content",
        status: "success",
        mode: "android",
        request: { headers: { Cookie: "a=b" } },
        webViewHtmlPreview: "<html><body><div id=\"J_BookRead\"></div></body></html>",
        evidence: { contentLength: 0 },
        preview: "",
      }],
    });
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "passed"]);
    const matrix = JSON.parse(await fs.readFile(path.join(runDir, "capability-matrix.json"), "utf8"));

    assert.equal(result.blockedBy, "android_webview_content_not_verified");
    assert.equal(matrix.links.content.status, "blocked");
    assert.equal(matrix.links.content.blocker, "android_webview_content_not_verified");
    assert.equal(matrix.overall.status, "blocked:android_webview_content_not_verified");
  });

  it("accepts Probe login plus webView source when android content step has WebView render evidence", async () => {
    const adbEnv = {
      ...process.env,
      BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
    };
    const runDir = await initRun(tmpDir, { env: adbEnv });
    await advanceToValidateWithWebViewSource(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "android",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{
        phase: "content",
        status: "success",
        mode: "android",
        request: { headers: { Cookie: "a=b" } },
        webViewHtmlPreview: "<html><body><div id=\"J_BookRead\">正文</div></body></html>",
        evidence: { contentLength: 120, contentPreview: "这是一段从 Android WebView DOM 中提取出的章节正文。" },
        preview: "这是一段从 Android WebView DOM 中提取出的章节正文。",
        extracted: { contentLength: 120 },
      }],
    });
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsg(["record-validation", "--run", runDir, "--status", "passed"], { env: adbEnv });

    assert.equal(result.status, "anonymous_candidate");
    assert.equal(result.nextAction, "advance");
  });

  it("blocks Probe login when android report stays anonymous with no cookie evidence", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "android",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{
        phase: "content",
        status: "success",
        mode: "android",
        androidProbeUsed: true,
        androidBackend: "probe_webview",
        sessionMode: "anonymous",
        request: { headers: { Cookie: "" } },
      }],
    });
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "passed"]);

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "android_probe_cookie_not_used");
    assert.match(result.message, /匿名|Cookie/);
  });

  it("record-validation generates validator-summary.md", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.rm(path.join(runDir, "validator-summary.md"), { force: true });
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    });

    await runBsg(["record-validation", "--run", runDir, "--status", "passed"]);
    const summary = await fs.readFile(path.join(runDir, "validator-summary.md"), "utf8");

    assert.match(summary, /此文件由 record-validation 生成/);
    assert.match(summary, /最终状态: passed/);
  });

  it("blocks passed validation when search success has zero extracted books", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      status: "passed",
      mode: "http",
      summary: {
        resultCount: 0,
        firstBook: "",
        chapterCount: 20,
        contentPreview: "这是一段足够长的正文预览。".repeat(10),
      },
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [
        { phase: "search", status: "success", response: { bodyPreview: "<li>book</li>" }, extracted: {} },
        { phase: "detail", status: "success", response: { bodyPreview: "detail" } },
        { phase: "toc", status: "success", response: { bodyPreview: "toc" } },
        { phase: "content", status: "success", response: { bodyPreview: "content" }, preview: "这是一段足够长的正文预览。".repeat(10) },
      ],
    });

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "passed"]);
    const matrix = JSON.parse(await fs.readFile(path.join(runDir, "capability-matrix.json"), "utf8"));

    assert.equal(result.blockedBy, "search_result_empty");
    assert.equal(matrix.links.search.status, "blocked");
    assert.equal(matrix.links.search.blocker, "search_result_empty");
    assert.match(result.message, /阅读语义证据|resultCount/);
  });

  it("acceptance gate blocks include correctiveAction and stderr next step", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      status: "passed",
      mode: "http",
      summary: {
        resultCount: 0,
        firstBook: "",
        chapterCount: 20,
        contentPreview: "这是一段足够长的正文预览。".repeat(10),
      },
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [
        { phase: "search", status: "success", response: { bodyPreview: "<li>book</li>" }, extracted: {} },
        { phase: "detail", status: "success", response: { bodyPreview: "detail" } },
        { phase: "toc", status: "success", response: { bodyPreview: "toc" } },
        { phase: "content", status: "success", response: { bodyPreview: "content" }, preview: "这是一段足够长的正文预览。".repeat(10) },
      ],
    });

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-validation", "--run", runDir, "--status", "passed"], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.equal(result.status, "blocked");
        assert.equal(result.blockedBy, "search_result_empty");
        assert.ok(result.correctiveAction);
        assert.ok(result.nextCommand);
        assert.ok(err.stderr.includes("## 下一步"));
        return true;
      },
    );
  });

  it("short toc sample requires explicit user confirmation instead of permanent rule failure", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      status: "passed",
      mode: "http",
      summary: {
        resultCount: 1,
        firstBook: "新书",
        chapterCount: 8,
        contentLength: 180,
        contentPreview: "这是一段足够长的正文预览。".repeat(10),
      },
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [
        { phase: "search", status: "success", response: { bodyPreview: "search" }, extracted: { name: "新书" } },
        { phase: "detail", status: "success", response: { bodyPreview: "detail" } },
        { phase: "toc", status: "success", response: { bodyPreview: "toc" }, extracted: { chapterCount: 8 } },
        { phase: "content", status: "success", response: { bodyPreview: "content" }, preview: "这是一段足够长的正文预览。".repeat(10) },
      ],
    });

    const blocked = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "passed"]);
    assert.equal(blocked.blockedBy, "toc_chapter_count_too_low");
    assert.equal(blocked.requiredUserAction, "toc_sample_review");
    assert.match(blocked.message, /短目录样本|确认/);

    const resolved = await runBsg(["resolve-user-action", "--run", runDir, "--action", "toc_chapter_count_confirmed"]);
    assert.equal(resolved.action, "toc_chapter_count_confirmed");

    const result = await runBsg(["record-validation", "--run", runDir, "--status", "passed"]);
    assert.equal(result.nextAction, "advance");
  });

  it("does not accept Android WebView content evidence when another content step failed", async () => {
    const adbEnv = {
      ...process.env,
      BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
    };
    const runDir = await initRun(tmpDir, { env: adbEnv });
    await advanceToValidateWithWebViewSource(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "android",
      phases: { search: "success", detail: "success", toc: "success", content: "error" },
      steps: [
        {
          phase: "content",
          status: "success",
          mode: "android",
          request: { headers: { Cookie: "a=b" } },
          webViewHtmlPreview: "<html><body><div id=\"J_BookRead\">正文</div></body></html>",
          evidence: { contentLength: 160, contentPreview: "这是一段从 Android WebView DOM 中提取出的章节正文。".repeat(4) },
          preview: "这是一段从 Android WebView DOM 中提取出的章节正文。".repeat(4),
          extracted: { contentLength: 160 },
        },
        {
          phase: "content",
          status: "error",
          mode: "android",
          errorCode: "CONTENT_IS_CAPTCHA_PAGE",
          response: { title: "验证码" },
        },
      ],
    });
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "passed"], { env: adbEnv });
    const matrix = JSON.parse(await fs.readFile(path.join(runDir, "capability-matrix.json"), "utf8"));

    assert.equal(result.blockedBy, "android_webview_content_not_verified");
    assert.equal(matrix.links.content.status, "blocked");
    assert.equal(matrix.links.content.blocker, "android_webview_content_not_verified");
  });

  it("blocks polluted content preview even when validator marks content success", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      status: "passed",
      mode: "http",
      summary: {
        resultCount: 1,
        firstBook: "Example",
        chapterCount: 20,
        contentLength: 292,
        contentPreview: "正文开始 2gtxaw 2gtxaw 2gtxaw 2gtxaw 2gtxaw 2gtxaw 2gtxaw 2gtxaw",
      },
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [
        { phase: "search", status: "success", response: { bodyPreview: "search" }, extracted: { name: "Example" } },
        { phase: "detail", status: "success", response: { bodyPreview: "detail" } },
        { phase: "toc", status: "success", response: { bodyPreview: "toc" }, extracted: { chapterCount: 20 } },
        { phase: "content", status: "success", response: { bodyPreview: "content" }, preview: "正文开始 2gtxaw 2gtxaw 2gtxaw 2gtxaw 2gtxaw 2gtxaw 2gtxaw 2gtxaw", evidence: { contentLength: 292 } },
      ],
    });

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "passed"]);
    const matrix = JSON.parse(await fs.readFile(path.join(runDir, "capability-matrix.json"), "utf8"));

    assert.equal(result.blockedBy, "content_repeated_noise");
    assert.equal(matrix.links.content.status, "blocked");
    assert.equal(matrix.links.content.blocker, "content_repeated_noise");
  });

  it("capability matrix keeps search CAPTCHA as partial candidate, not full pass", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "error", detail: "success", toc: "success", content: "success" },
      steps: [
        { phase: "search", status: "error", error: "CAPTCHA required", response: { title: "验证码" } },
        { phase: "detail", status: "success", response: { bodyPreview: "<h1>book</h1>" } },
        { phase: "toc", status: "success", response: { bodyPreview: "<a>chapter</a>" } },
        { phase: "content", status: "success", response: { bodyPreview: "<p>content</p>" } },
      ],
    });

    await runBsgBlocked(["record-validation", "--run", runDir, "--status", "needs_app_review"]);
    await runBsg(["resolve-user-action", "--run", runDir, "--action", "android_device_unavailable"], { env: noDeviceEnv });
    await runBsg(["record-validation", "--run", runDir, "--status", "needs_app_review"]);
    const matrix = JSON.parse(await fs.readFile(path.join(runDir, "capability-matrix.json"), "utf8"));

    assert.equal(matrix.links.search.status, "blocked");
    assert.equal(matrix.links.search.blocker, "captcha");
    assert.equal(matrix.overall.status, "partial_candidate");
    assert.equal(matrix.overall.fullPass, false);
  });

  it("lesson-check does not change capability matrix status", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.writeFile(path.join(runDir, "lesson-check.json"), JSON.stringify({
      version: "1.0",
      status: "answered",
      triggeredLessons: ["ssr-content-does-not-prove-discovery"],
      answers: [{ lessonId: "ssr-content-does-not-prove-discovery", answer: "checked" }],
    }, null, 2), "utf8");
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [
        { phase: "search", status: "success", response: { bodyPreview: "search" } },
        { phase: "detail", status: "success", response: { bodyPreview: "detail" } },
        { phase: "toc", status: "success", response: { bodyPreview: "toc" } },
        { phase: "content", status: "success", response: { bodyPreview: "content" } },
      ],
    });

    await runBsg(["record-validation", "--run", runDir, "--status", "passed"]);
    const matrix = JSON.parse(await fs.readFile(path.join(runDir, "capability-matrix.json"), "utf8"));

    assert.equal(matrix.overall.status, "full_pass");
    assert.equal(matrix.overall.fullPass, true);
  });

  it("rejects ruleBookInfo.summary before leaving generate phase", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await fs.writeFile(path.join(tmpDir, "outputs", "example-com", "book-source.json"), JSON.stringify([{
      bookSourceUrl: "https://example.com",
      bookSourceName: "Example",
      searchUrl: "https://example.com/search?q={{key}}",
      ruleSearch: { bookList: "$.items", name: "$.title", bookUrl: "$.url" },
      ruleBookInfo: { name: "$.title", summary: "$.summary" },
      ruleToc: { chapterList: "$.chapters", chapterName: "$.title", chapterUrl: "$.url" },
      ruleContent: { content: "$.content" },
    }]), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "advance", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /official-rule-pack|ruleBookInfo\.summary|intro/);
        return true;
      },
    );
    const ruleCheck = JSON.parse(await fs.readFile(path.join(runDir, "rule-check.json"), "utf8"));
    assert.equal(ruleCheck.status, "failed");
    assert.ok(ruleCheck.errors.some((issue) => issue.ruleId === "book-info-intro-field"));
  });

  it("rejects empty searchUrl and ruleSearch before validate", async () => {
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await fs.writeFile(path.join(tmpDir, "outputs", "example-com", "book-source.json"), JSON.stringify([{
      bookSourceUrl: "https://example.com",
      bookSourceName: "Example",
      searchUrl: "",
      enabledExplore: true,
      exploreUrl: "排行https://example.com/rank",
      ruleSearch: { bookList: "", name: "", bookUrl: "" },
      ruleBookInfo: { name: "$.title" },
      ruleToc: { chapterList: "$.chapters", chapterName: "$.title", chapterUrl: "$.url" },
      ruleContent: { content: "$.content" },
    }]), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "advance", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /searchUrl|ruleSearch|搜索入口/);
        return true;
      },
    );
  });
});

describe("printHint stderr output", () => {
  it("init stderr contains no ## 下一步 on success", async () => {
    const tmpDir = await makeTmpDir();
    const result = await execFileAsync("node", [BSG, "init", "https://example.com", "--cwd", tmpDir], { encoding: "utf8" });

    assert.ok(!result.stderr.includes("## 下一步"));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("advance stderr contains ## 下一步 on wrong-phase error", async () => {
    const tmpDir = await makeTmpDir();
    const init = await runBsg(["init", "https://example.com", "--cwd", tmpDir]);
    await runBsg(["advance", "--run", init.runDir]);
    await runBsg(["advance", "--run", init.runDir]);

    try {
      await execFileAsync("node", [BSG, "advance", "--run", init.runDir], { encoding: "utf8" });
      assert.fail("should have failed");
    } catch (err) {
      assert.ok(err.stderr.includes("## 下一步"), "stderr should contain ## 下一步");
      assert.ok(err.stderr.includes("运行："), "stderr should contain 运行：");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("record-validation stderr contains ## 下一步 when run dir is invalid", async () => {
    try {
      await execFileAsync("node", [BSG, "record-validation", "--run", "/nonexistent", "--status", "passed"], { encoding: "utf8" });
      assert.fail("should have failed");
    } catch (err) {
      const result = JSON.parse(err.stdout);
      assert.ok(result.correctiveAction, "should have correctiveAction");
      assert.ok(err.stderr.includes("## 下一步"), "stderr should contain ## 下一步");
    }
  });
});

describe("advance response fields", () => {
  it("init response has nextCommand", async () => {
    const tmpDir = await makeTmpDir();
    const result = await runBsg(["init", "https://example.com", "--cwd", tmpDir]);

    assert.ok(result.nextCommand, "init should return nextCommand");
    assert.ok(result.nextCommand.includes("advance"), "nextCommand should suggest advance");
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("advance probe to assess response has readNext and nextCommand", async () => {
    const tmpDir = await makeTmpDir();
    const init = await runBsg(["init", "https://example.com", "--cwd", tmpDir]);
    await runBsg(["advance", "--run", init.runDir]);
    const result = await runBsg(["advance", "--run", init.runDir]);

    assert.ok(Array.isArray(result.readNext), "readNext should be array");
    assert.ok(result.readNext.length > 0, "readNext should not be empty for assess");
    assert.ok(result.nextCommand, "nextCommand should exist");
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("advance generate to validate response has readNext", async () => {
    const tmpDir = await makeTmpDir();
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await writeValidSource(tmpDir);
    const result = await runBsg(["advance", "--run", runDir]);

    assert.ok(Array.isArray(result.readNext), "readNext should be array for validate");
    assert.ok(result.readNext.some((f) => f.includes("validator")), "readNext should include validator reference");
    assert.ok(result.nextCommand.includes("bsg.mjs\" validate"), "nextCommand should run validator before record-validation");
    assert.ok(!result.nextCommand.includes("record-validation"), "nextCommand should not skip directly to record-validation");
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("validate command tells the agent to start validator when the report is skipped", async () => {
    const tmpDir = await makeTmpDir();
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await writeValidSource(tmpDir);
    await runBsg(["advance", "--run", runDir]);

    const result = await runBsg(["validate", "--run", runDir], {
      env: { ...process.env, VALIDATOR_URL: "http://127.0.0.1:1" },
    });

    assert.equal(result.status, "skipped");
    assert.ok(result.nextCommand.includes("validator-start"), "skipped validation should tell the agent to start validator");
    assert.ok(!result.nextCommand.includes("--status skipped"), "nextCommand must not suggest an unsupported record-validation status");
    assert.ok(!/验证完成/.test(result.message), "skipped validator should not be described as completed validation");
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

describe("correctiveAction on hash mismatch", () => {
  it("record-validation returns correctiveAction when source changed", async () => {
    const tmpDir = await makeTmpDir();
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await writeValidSource(tmpDir);
    await runBsg(["advance", "--run", runDir]);
    await writeValidSource(tmpDir, { bookSourceName: "Changed After Generate" });
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    });

    try {
      await execFileAsync("node", [BSG, "record-validation", "--run", runDir, "--status", "passed"], { encoding: "utf8" });
      assert.fail("should fail");
    } catch (err) {
      const result = JSON.parse(err.stdout);
      assert.ok(result.correctiveAction, "should have correctiveAction");
      assert.ok(result.nextCommand, "should have nextCommand");
      assert.ok(result.correctiveAction.includes("generate"), "correctiveAction should mention generate phase");
      assert.ok(err.stderr.includes("## 下一步"), "stderr should contain ## 下一步");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("correctiveAction on command ordering errors", () => {
  it("advance in validate in_progress returns correctiveAction", async () => {
    const tmpDir = await makeTmpDir();
    const runDir = await initRun(tmpDir);
    await advanceToGenerate(tmpDir, runDir);
    await writeValidSource(tmpDir);
    await runBsg(["advance", "--run", runDir]);

    try {
      await execFileAsync("node", [BSG, "advance", "--run", runDir], { encoding: "utf8" });
      assert.fail("should fail");
    } catch (err) {
      const result = JSON.parse(err.stdout);
      assert.ok(result.correctiveAction, "should have correctiveAction");
      assert.ok(result.nextCommand, "should have nextCommand");
      assert.ok(result.nextCommand.includes("record-validation"), "nextCommand should suggest record-validation");
      assert.ok(err.stderr.includes("## 下一步"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("record-assessment in probe phase returns correctiveAction", async () => {
    const tmpDir = await makeTmpDir();
    const init = await runBsg(["init", "https://example.com", "--cwd", tmpDir]);

    try {
      await execFileAsync("node", [BSG, "record-assessment", "--run", init.runDir], { encoding: "utf8" });
      assert.fail("should fail");
    } catch (err) {
      const result = JSON.parse(err.stdout);
      assert.ok(result.correctiveAction, "should have correctiveAction");
      assert.ok(err.stderr.includes("## 下一步"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("correctiveAction on blocked validation", () => {
  it("hard_rule_error blocked response has correctiveAction", async () => {
    const tmpDir = await makeTmpDir();
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await writeGeneratedValidatorReport(runDir, {
      mode: "http",
      phases: { search: "success", detail: "success", toc: "error" },
      steps: [
        { phase: "detail", status: "success", extracted: { tocUrl: "https://example.com/chapter-list/" } },
        { phase: "toc", status: "error", request: { url: "https://example.com/chapter-list/" } },
      ],
    });

    const result = await runBsgBlocked(["record-validation", "--run", runDir, "--status", "passed"]);

    assert.equal(result.blockedBy, "hard_rule_error");
    assert.ok(result.correctiveAction, "should have correctiveAction");
    assert.ok(result.nextCommand, "should have nextCommand");
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
