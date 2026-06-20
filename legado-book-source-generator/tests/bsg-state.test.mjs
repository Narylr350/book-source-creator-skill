import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const BSG = path.join(ROOT, "scripts", "bsg.mjs");

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

async function initRun(tmpDir, options = {}) {
  const init = await runBsg(["init", "https://example.com", "--cwd", tmpDir], options);
  await runBsg(["advance", "--run", init.runDir]);
  await runBsg(["advance", "--run", init.runDir]);
  return init.runDir;
}

async function writeRequiredDeliverFiles(tmpDir, runDir) {
  await fs.writeFile(path.join(runDir, "assessment.md"), "- 评级: 可生成\n- 风险标签: 无风险\n", "utf8");
  await fs.writeFile(path.join(runDir, "analysis.md"), "# 网站分析\n", "utf8");
  await fs.writeFile(path.join(runDir, "validation-checklist.md"), "# 清单\n", "utf8");
  await fs.writeFile(path.join(runDir, "validator-report.json"), JSON.stringify({ status: "needs_app_review" }), "utf8");
  await fs.writeFile(path.join(runDir, "validator-summary.md"), "# summary\n", "utf8");

  const sourceDir = path.join(tmpDir, "outputs", "example-com");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, "book-source.json"), JSON.stringify([{
    bookSourceUrl: "https://example.com",
    bookSourceName: "Example",
    searchUrl: "https://example.com/search?q={{key}}",
    ruleSearch: { bookList: "$.items", name: "$.title", bookUrl: "$.url" },
    ruleBookInfo: { name: "$.title" },
    ruleToc: { chapterList: "$.chapters", chapterName: "$.title", chapterUrl: "$.url" },
    ruleContent: { content: "$.content" },
  }]), "utf8");
}

async function advanceToGenerate(tmpDir, runDir) {
  await writeAssessmentAndRecord(runDir, [
    "- 评级: 可生成",
    "- 登录需求: 否",
    "- 风险标签: 无风险",
  ]);
  await runBsg(["advance", "--run", runDir]);
  await fs.writeFile(path.join(runDir, "analysis.md"), "# 网站分析\n", "utf8");
  await runBsg(["advance", "--run", runDir]);
  await fs.mkdir(path.join(tmpDir, "outputs", "example-com"), { recursive: true });
}

async function writeAssessmentAndRecord(runDir, lines) {
  const normalized = [...lines];
  if (!normalized.some((line) => /登录需求[：:]/.test(line))) {
    normalized.splice(1, 0, "- 登录需求: 否");
  }
  await fs.writeFile(path.join(runDir, "assessment.md"), normalized.join("\n"), "utf8");
  return runBsg(["record-assessment", "--run", runDir]);
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

  it("accepts a completed no-risk assessment without treating template headings as paid content", async () => {
    const runDir = await initRun(tmpDir);
    const result = await writeAssessmentAndRecord(runDir, [
      "- 目标站点: Example",
      "- 站点 URL: https://example.com",
      "- 登录需求: 否",
      "- 用户选择: 待用户确认",
      "- 当前分析会话: 匿名",
      "- 评级: 可生成",
      "- 风险标签: 无风险",
      "- 官方规则对照: 已完成",
      "- 辅助文档对照: 已完成",
      "",
      "## 风险与阻塞",
      "",
      "- 反爬或验证码: 无",
      "- 会员限制: 无",
      "- 动态签名或加密: 无",
      "- 支付限制: 无",
      "- 其他阻塞点: 无",
      "- `P15(WebView)` 是否已排除: 是",
      "- 更低复杂度回退是否已排除: 是",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.signals.protectedContent, false);
  });

  it("rejects assessment that keeps template risk labels", async () => {
    const runDir = await initRun(tmpDir);
    await fs.writeFile(path.join(runDir, "assessment.md"), [
      "- 评级: 可生成",
      "- 登录需求: 否",
      "- 风险标签: （可多选）无风险 / WebView 依赖 / 需登录态 / 有反爬风险 / 加密正文",
    ].join("\n"), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-assessment", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /风险标签/);
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

    const resolved = await runBsg(["resolve-user-action", "--run", runDir, "--action", "android_device_unavailable"]);
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
    await fs.writeFile(path.join(runDir, "assessment.md"), [
      "- 评级: 可生成",
      "- 登录需求: 是",
      "- 风险标签: 需登录态",
      "- 用户选择: 不登录分析",
    ].join("\n"), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-assessment", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /不要编用户选择|no_account/);
        return true;
      },
    );
  });

  it("rejects assessment that hides VIP login risk as no login and no risk", async () => {
    const runDir = await initRun(tmpDir);
    await fs.writeFile(path.join(runDir, "assessment.md"), [
      "- 评级: 可生成",
      "- 登录需求: 否（浏览免费章节无需登录，VIP章节需登录+订阅）",
      "- 用户选择: 登录分析 / 不登录分析",
      "- 当前分析会话: 匿名 / 已登录 / 登录失败",
      "- 风险标签: 无风险",
      "- 会员限制: VIP章节需订阅",
    ].join("\n"), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [BSG, "record-assessment", "--run", runDir], { encoding: "utf8" }),
      (err) => {
        const result = JSON.parse(err.stdout);
        assert.match(result.error, /需登录态|无风险|VIP|订阅/);
        return true;
      },
    );
  });

  it("requires user login decision when assessment mentions VIP subscription", async () => {
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

    assert.equal(result.requiredUserAction, "login_required");
    assert.equal(result.reason, "login_required");
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

    assert.equal(result.requiredUserAction, "login_required");
    assert.equal(result.adbAvailable, false);
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
        assert.match(result.error, /record-validation|验证状态/);
        return true;
      },
    );
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

  it("blocks passed HTTP validation when generated source contains WebView and Android is available", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.writeFile(path.join(runDir, "validator-report.json"), JSON.stringify({
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    }), "utf8");

    const sourcePath = path.join(tmpDir, "outputs", "example-com", "book-source.json");
    const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
    source[0].ruleToc.chapterUrl = "{{$.url}},{\"webView\":true}";
    await fs.writeFile(sourcePath, JSON.stringify(source), "utf8");

    const result = await runBsg(["record-validation", "--run", runDir, "--status", "passed"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "android_probe_not_used");
  });

  it("blocks HTTP validation after Probe login when Android is available", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.writeFile(path.join(runDir, "validator-report.json"), JSON.stringify({
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    }), "utf8");
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsg(["record-validation", "--run", runDir, "--status", "passed"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "android_probe_not_used");
    assert.match(result.message, /Probe 登录/);
  });

  it("blocks HTTP validation after Probe login when Android disconnected", async () => {
    const runDir = await initRun(tmpDir, {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\nABC123\tdevice\n",
      },
    });
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.writeFile(path.join(runDir, "validator-report.json"), JSON.stringify({
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    }), "utf8");
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsg(["record-validation", "--run", runDir, "--status", "passed"], {
      env: {
        ...process.env,
        BSG_TEST_ADB_DEVICES_OUTPUT: "List of devices attached\n",
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "android_device_disconnected");
    assert.match(result.message, /设备已断开/);
  });

  it("blocks malformed cookies json during validation recording", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({ hasEnabledCookieJar: true })]);
    await fs.writeFile(path.join(runDir, "cookies.json"), JSON.stringify({
      domain: "a=b; c=d",
    }), "utf8");

    const result = await runBsg(["record-validation", "--run", runDir, "--status", "needs_app_review"]);

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "cookie_not_injected");
    assert.match(result.message, /缺少真实域名键/);
  });

  it("blocks needs_app_review when report shows a hard toc rule error", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.writeFile(path.join(runDir, "validator-report.json"), JSON.stringify({
      mode: "http",
      phases: { search: "success", detail: "success", toc: "error" },
      steps: [
        { phase: "detail", status: "success", extracted: { tocUrl: "https://example.com/chapter-list/" } },
        { phase: "toc", status: "error", request: { url: "https://example.com/chapter-list/" } },
      ],
    }), "utf8");

    const result = await runBsg(["record-validation", "--run", runDir, "--status", "needs_app_review"]);

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "hard_rule_error");
    assert.match(result.message, /tocUrl|chapter-list|规则错误/);
  });

  it("blocks Probe login plus webView source when android report has no WebView render evidence", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.writeFile(path.join(runDir, "validator-report.json"), JSON.stringify({
      mode: "android",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{
        phase: "content",
        status: "success",
        mode: "android",
        request: { headers: { Cookie: "a=b" } },
      }],
    }), "utf8");
    const sourcePath = path.join(tmpDir, "outputs", "example-com", "book-source.json");
    const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
    source[0].ruleToc.chapterUrl = "{{$.url}},{\"webView\":true}";
    await fs.writeFile(sourcePath, JSON.stringify(source), "utf8");
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsg(["record-validation", "--run", runDir, "--status", "passed"]);

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "android_webview_not_used");
  });

  it("accepts Probe login plus webView source when android content step has WebView render evidence", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.writeFile(path.join(runDir, "validator-report.json"), JSON.stringify({
      mode: "android",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{
        phase: "content",
        status: "success",
        mode: "android",
        request: { headers: { Cookie: "a=b" } },
        webViewHtmlPreview: "<html><body><div id=\"J_BookRead\">正文</div></body></html>",
      }],
    }), "utf8");
    const sourcePath = path.join(tmpDir, "outputs", "example-com", "book-source.json");
    const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
    source[0].ruleToc.chapterUrl = "{{$.url}},{\"webView\":true}";
    await fs.writeFile(sourcePath, JSON.stringify(source), "utf8");
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsg(["record-validation", "--run", runDir, "--status", "passed"]);

    assert.equal(result.status, "anonymous_candidate");
    assert.equal(result.nextAction, "deliver");
  });

  it("blocks Probe login when android report stays anonymous with no cookie evidence", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.writeFile(path.join(runDir, "validator-report.json"), JSON.stringify({
      mode: "android",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{
        phase: "content",
        status: "success",
        mode: "android",
        sessionMode: "anonymous",
        request: { headers: { Cookie: "" } },
      }],
    }), "utf8");
    await runBsg(["set-login-features", "--run", runDir, "--flags", JSON.stringify({
      hasEnabledCookieJar: true,
      _loginMethod: "probe",
    })]);

    const result = await runBsg(["record-validation", "--run", runDir, "--status", "passed"]);

    assert.equal(result.status, "blocked");
    assert.equal(result.blockedBy, "android_probe_cookie_not_used");
    assert.match(result.message, /匿名|Cookie/);
  });

  it("record-validation generates validator-summary.md", async () => {
    const runDir = await initRun(tmpDir);
    await writeRequiredDeliverFiles(tmpDir, runDir);
    await fs.rm(path.join(runDir, "validator-summary.md"), { force: true });
    await fs.writeFile(path.join(runDir, "validator-report.json"), JSON.stringify({
      mode: "http",
      phases: { search: "success", detail: "success", toc: "success", content: "success" },
      steps: [{ phase: "content", status: "success", mode: "http" }],
    }), "utf8");

    await runBsg(["record-validation", "--run", runDir, "--status", "passed"]);
    const summary = await fs.readFile(path.join(runDir, "validator-summary.md"), "utf8");

    assert.match(summary, /此文件由 record-validation 生成/);
    assert.match(summary, /最终状态: passed/);
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
        assert.match(result.error, /ruleBookInfo\.summary|intro/);
        return true;
      },
    );
  });
});
