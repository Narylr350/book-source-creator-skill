#!/usr/bin/env node

/**
 * bsg.mjs ― Legado 书源生成工作流状态机
 *
 * 用法:
 *   node scripts/bsg.mjs init <url> [--fast]
 *   node scripts/bsg.mjs status --run <dir>
 *   node scripts/bsg.mjs advance --run <dir>
 *   node scripts/bsg.mjs check --run <dir>
 *   node scripts/bsg.mjs set-login-features --run <dir> [--flags <json>]
 *   node scripts/bsg.mjs record-validation --run <dir> --status <status> [--report <file>]
 *   node scripts/bsg.mjs deliver --run <dir>
 *   node scripts/bsg.mjs validator-start [--background]
 *   node scripts/bsg.mjs validator-stop
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deriveSiteSlug } from "./lib/slug.mjs";
import { initializeRunBundle } from "./lib/output-bundle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");
const VALIDATOR_URL = process.env.VALIDATOR_URL || "http://localhost:1111";

// ── helpers ────────────────────────────────────────────────────────────────

function isInSkillInstallDir(cwd) {
  const norm = (p) => path.resolve(p).toLowerCase();
  const dir = norm(cwd);
  const blocked = [
    norm(path.join(SKILL_ROOT)),
    norm(path.join(process.env.HOME || "", ".claude", "skills")),
    norm(path.join(process.env.HOME || "", ".codex", "skills")),
    norm(path.join(process.env.HOME || "", ".agents", "skills")),
  ];
  return blocked.some((b) => dir === b || dir.startsWith(b + path.sep));
}

const SKILL_INSTALL_DIRS = [
  "~/.claude/skills",
  "~/.codex/skills",
  "~/.agents/skills",
];

function formatDirList() {
  return SKILL_INSTALL_DIRS.join(", ");
}

function loadRunState(runDir) {
  const p = path.join(runDir, "run-state.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function saveRunState(runDir, state) {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(runDir, "run-state.json"),
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}

function freshRunState(siteUrl, siteSlug, mode, workingDir) {
  return {
    version: "1.0",
    siteUrl,
    siteSlug,
    mode,
    workingDir,
    isSkillInstallDir: isInSkillInstallDir(workingDir),
    phases: {
      probe:   { status: "pending" },
      assess:  { status: "pending", rating: null },
      analyze: { status: "pending" },
      generate:{ status: "pending" },
      validate:{ status: "pending", attempts: 0, lastStatus: null, lastError: "", consecutiveSame: 0 },
      adbDetected: false, // set at init, used to detect dropped connections
      deliver: { status: "pending" },
    },
    loginFeatures: {
      hasLoginUrl: false,
      hasEnabledCookieJar: false,
      hasAuthorization: false,
      hasWebJs: false,
      hasWebView: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function fail(message) {
  return { ok: false, error: message };
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function parseArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  return args[idx + 1] || null;
}

// ── phase ordering ─────────────────────────────────────────────────────────

const PHASE_ORDER = ["probe", "assess", "analyze", "generate", "validate", "deliver"];

function currentPhaseIndex(state) {
  for (let i = 0; i < PHASE_ORDER.length; i++) {
    const p = state.phases[PHASE_ORDER[i]];
    if (p.status !== "completed") return i;
  }
  return PHASE_ORDER.length; // all done
}

// ── environment check ──────────────────────────────────────────────────────

function checkEnvironment() {
  const results = [];

  // Java
  try {
    const javaOut = execSync("java -version 2>&1", { encoding: "utf-8", timeout: 5000 });
    const javaMatch = javaOut.match(/version "(\d+)/);
    const javaVer = javaMatch ? javaMatch[1] : "unknown";
    const javaOk = javaMatch ? parseInt(javaMatch[1]) >= 17 : false;
    results.push({
      tool: "Java",
      ok: javaOk,
      version: javaVer,
      message: javaOk
        ? `✅ Java ${javaVer}`
        : `❌ Java ${javaVer} — 需要 Java 17+。安装: https://adoptium.net/download/`,
    });
  } catch {
    results.push({
      tool: "Java",
      ok: false,
      version: null,
      message: "❌ 未找到 Java。需要 Java 17+。安装: https://adoptium.net/download/",
    });
  }

  // adb
  try {
    const adbOut = execSync("adb version", { encoding: "utf-8", timeout: 5000 });
    const adbMatch = adbOut.match(/Android Debug Bridge version ([^\s]+)/);
    results.push({
      tool: "adb",
      ok: true,
      version: adbMatch ? adbMatch[1] : "found",
      message: `✅ adb ${adbMatch ? adbMatch[1] : "已安装"}`,
    });
  } catch {
    results.push({
      tool: "adb",
      ok: false,
      version: null,
      message: "⚠️ 未找到 adb。Android Probe 不可用。安装: validator/setup-adb.bat",
    });
  }

  const allOk = results.every((r) => r.ok || r.tool === "adb"); // adb is optional
  return { results, allOk };
}

// ── init ───────────────────────────────────────────────────────────────────

function cmdInit(args) {
  if (args.length < 1) {
    return fail("用法: node scripts/bsg.mjs init <site-url> [--fast] [--cwd <dir>]");
  }

  const siteUrl = args[0];
  const fastMode = args.includes("--fast");
  const cwdIdx = args.indexOf("--cwd");
  const cwd = cwdIdx >= 0 ? path.resolve(args[cwdIdx + 1]) : process.cwd();

  let parsed;
  try { parsed = new URL(siteUrl); } catch {
    return fail("无效的站点 URL: " + siteUrl);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return fail("站点 URL 必须以 http:// 或 https:// 开头");
  }

  const inSkillDir = isInSkillInstallDir(cwd);
  const env = checkEnvironment();

  const siteSlug = deriveSiteSlug(siteUrl);
  const runsRoot = path.join(cwd, "runs");
  const runDir = initializeRunBundle(runsRoot, siteUrl);

  const state = freshRunState(siteUrl, siteSlug, fastMode ? "fast" : "full", cwd);
  state.adbDetected = checkAdb();
  saveRunState(runDir, state);

  return {
    ok: true,
    nextAction: "probe_site",
    runDir,
    siteSlug,
    mode: state.mode,
    workingDir: cwd,
    environment: {
      allOk: env.allOk,
      results: env.results,
    },
    warnSkillDir: inSkillDir
      ? `当前在 skill 安装目录下运行。输出将写入 ${cwd}，建议切换到项目目录并用 --cwd 指定。`
      : null,
    message: fastMode
      ? "快速路径已启用。跳过 Browser MCP，直接进入网络分析。"
      : "完整路径。先匿名初探 4 条链路，判断站点结构和反爬。",
    hint: fastMode
      ? "用 HTTP fetch 匿名探索 search/detail/toc/content 链路，记录发现到 analysis.md。"
      : "用 Browser MCP 或 HTTP fetch 匿名探索 search/detail/toc/content 链路。检测登录入口、反爬、WebView 需求。",
    outputs: {
      runsRoot,
      runDir,
      stateFile: path.join(runDir, "run-state.json"),
      bookSourceDir: path.join(cwd, "outputs", siteSlug),
    },
  };
}

// ── status ─────────────────────────────────────────────────────────────────

function cmdStatus(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs status --run <run-dir>");

  const state = loadRunState(runDir);
  if (!state) return fail(`未找到 run-state.json: ${runDir}`);

  const phases = Object.entries(state.phases).map(([name, p]) => ({
    phase: name,
    status: p.status,
    ...(name === "assess" && p.rating ? { rating: p.rating } : {}),
    ...(name === "validate" ? { attempts: p.attempts, lastStatus: p.lastStatus, consecutiveSame: p.consecutiveSame } : {}),
  }));

  const completed = phases.filter((p) => p.status === "completed").map((p) => p.phase);
  const inProgress = phases.find((p) => p.status === "in_progress");
  const pending = phases.filter((p) => p.status === "pending").map((p) => p.phase);

  const currentPhase = inProgress ? inProgress.phase : (pending.length > 0 ? pending[0] : "all_completed");

  let nextAction = null;
  if (!inProgress && pending.length > 0) {
    const next = pending[0];
    nextAction = next === "assess" ? "write_assessment"
      : next === "analyze" ? "write_analysis"
      : next === "generate" ? "generate_json"
      : next === "validate" ? "run_validator"
      : next === "deliver" ? "deliver"
      : "probe_site";
  }

  return {
    ok: true,
    siteUrl: state.siteUrl,
    siteSlug: state.siteSlug,
    mode: state.mode,
    currentPhase,
    completed,
    pending,
    inProgress: inProgress ? inProgress.phase : null,
    nextAction,
    loginFeatures: state.loginFeatures,
    phases,
  };
}

// ── advance ────────────────────────────────────────────────────────────────

function cmdAdvance(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs advance --run <run-dir>");

  const state = loadRunState(runDir);
  if (!state) return fail(`未找到 run-state.json: ${runDir}`);

  const idx = currentPhaseIndex(state);
  if (idx >= PHASE_ORDER.length) {
    return { ok: true, message: "所有阶段已完成。运行 deliver 完成交付。", nextAction: "all_done" };
  }

  const current = PHASE_ORDER[idx];
  const currentPhase = state.phases[current];

  // If current phase is "pending", start it (first advance into this phase)
  if (currentPhase.status === "pending") {
    return startPhase(current, state, runDir);
  }

  // If current phase is "in_progress", validate gates and mark completed, then move to next
  if (currentPhase.status === "in_progress") {
    return completePhase(current, state, runDir);
  }

  return fail(`阶段 ${current} 状态异常: ${currentPhase.status}`);
}

function startPhase(phase, state, runDir) {
  if (phase === "probe") {
    state.phases.probe.status = "in_progress";
    saveRunState(runDir, state);
    return {
      ok: true,
      nextAction: "probe_site",
      message: "匿名初探：用 HTTP fetch 或 Browser MCP 探索 search/detail/toc/content 四条链路。",
      requiredUserAction: null,
    };
  }

  // For all other phases, the gates are checked during the in_progress→completed transition.
  // Starting them is just status update.
  state.phases[phase].status = "in_progress";
  saveRunState(runDir, state);

  const actions = {
    assess:  { nextAction: "write_assessment", message: "写 assessment.md，评级必须是 4 种之一。完成后 advance。" },
    analyze: { nextAction: "write_analysis",   message: "按 search→detail→toc→content 顺序分析，写 analysis.md。完成后 advance。" },
    generate:{ nextAction: "generate_json",     message: "生成 book-source.json 到 outputs/<slug>/。完成后 advance。" },
    validate:{ nextAction: "run_validator",     message: "运行 validator，保存 validator-report.json。完成后 record-validation。" },
    deliver: { nextAction: "deliver",           message: "运行 deliver 完成最终交付。" },
  };

  const a = actions[phase] || { nextAction: phase, message: `阶段: ${phase}` };
  return { ok: true, ...a, requiredUserAction: null };
}

function completePhase(phase, state, runDir) {
  // Phase-specific completion gates
  if (phase === "probe") {
    // Probe is lightweight — always allowed to complete
    state.phases.probe.status = "completed";
    state.phases.probe.completedAt = new Date().toISOString();
    saveRunState(runDir, state);
    return moveToNext(phase, state, runDir);
  }

  if (phase === "assess") {
    const rating = state.phases.assess.rating;
    const assessPath = path.join(runDir, "assessment.md");
    if (!fileExists(assessPath)) {
      return fail("assessment.md 不存在，请先完成评估。");
    }
    if (!rating) {
      // Try to detect rating from the file
      const content = fs.readFileSync(assessPath, "utf-8");
      const m = content.match(/评级[：:]\s*(可生成|不建议生成)/);
      if (m) state.phases.assess.rating = m[1];
      else return fail("assessment 评级未设置。assessment.md 中必须有 '评级: 可生成 / 不建议生成'。");
    }

    // Auto-detect risk labels
    const assessContent = fs.readFileSync(assessPath, "utf-8");
    if (/WebView\s*依赖/i.test(assessContent)) state.loginFeatures.hasWebView = true;
    if (/需登录态/i.test(assessContent)) state.loginFeatures.hasEnabledCookieJar = true;
    if (/加密正文/i.test(assessContent)) { state.loginFeatures.hasWebView = true; state.loginFeatures.hasWebJs = true; }

    if (state.phases.assess.rating === "不建议生成") {
      return {
        ok: true,
        nextAction: "stop",
        requiredUserAction: "rating_blocked",
        message: `评估评级为"不建议生成"，需要用户决定是否继续。`,
        blockingPhase: "assess",
        rating: state.phases.assess.rating,
      };
    }

    // WebView/CSR detected during probe/assess → check Android device now
    if ((state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs) && !checkAdb()) {
      saveRunState(runDir, state);
      return {
        ok: true,
        nextAction: "stop",
        requiredUserAction: "android_device_needed",
        message: [
          "评估发现站点需要 WebView/CSR 渲染正文，但未检测到 Android 设备。",
          "",
          "请确认：你是否有满足以下条件的设备？",
          "  • Android 真机（已开启 USB 调试）或 Android 模拟器",
          "  • 电脑通过 USB 数据线连接手机",
          "  • 电脑上有 adb（可运行 validator/setup-adb.bat 下载）",
          "",
          "如果有，请现在连接手机并在手机上确认 USB 调试授权（各品牌设置方法见 docs/SETUP.md），然后回复「已连接」。",
          "如果没有 Android 设备，也可以继续——正文验证将标 needs_app_review，需在 Legado App 内手动测试。",
        ].join("\n"),
        blockingPhase: "assess",
        reason: "webview_requires_android",
      };
    }

    state.phases.assess.status = "completed";
    state.phases.assess.completedAt = new Date().toISOString();
    saveRunState(runDir, state);
    return moveToNext(phase, state, runDir);
  }

  if (phase === "analyze") {
    const analysisPath = path.join(runDir, "analysis.md");
    if (!fileExists(analysisPath)) {
      return fail("analysis.md 不存在，请先完成网站分析。");
    }
    state.phases.analyze.status = "completed";
    state.phases.analyze.completedAt = new Date().toISOString();
    saveRunState(runDir, state);
    return moveToNext(phase, state, runDir);
  }

  if (phase === "generate") {
    const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
    if (!fileExists(bookSourcePath)) {
      return fail(`book-source.json 不存在: ${bookSourcePath}。请先生成书源。`);
    }

    let sourceJson, parsed;
    try {
      sourceJson = fs.readFileSync(bookSourcePath, "utf-8");
      parsed = JSON.parse(sourceJson);
    } catch (e) {
      return fail(`book-source.json 不是合法 JSON: ${e.message}`);
    }

    if (!Array.isArray(parsed)) {
      return fail("book-source.json 必须是 JSON 数组 [{...}]，当前是 " + typeof parsed + "。");
    }
    if (parsed.length === 0) {
      return fail("book-source.json 是空数组，至少需要一个书源。");
    }

    // Check empty string fields
    const source = parsed[0];
    for (const key of ["header", "loginUrl", "exploreUrl", "bookSourceComment"]) {
      if (source[key] === "") {
        return fail(`book-source.json 中 "${key}" 为空字符串。可选字段应填有效值或删除。`);
      }
    }

    // Auto-detect webView/webJs from book-source.json content
    const jsonStr = JSON.stringify(parsed);
    const hasWebView = jsonStr.includes('"webView":true') || jsonStr.includes("'webView':true");
    const hasWebJs = jsonStr.includes('"webJs"') || jsonStr.includes("'webJs'");
    if (hasWebView && !state.loginFeatures.hasWebView) state.loginFeatures.hasWebView = true;
    if (hasWebJs && !state.loginFeatures.hasWebJs) state.loginFeatures.hasWebJs = true;

    // Structural integrity checks before advance
    const structuralErrors = [];

    // Rule: CSR site MUST have webView on chapterUrl, not just on ruleContent
    if ((state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs) && source.ruleToc?.chapterUrl) {
      const cu = source.ruleToc.chapterUrl;
      if (!cu.includes('webView') && !cu.includes('webview')) {
        structuralErrors.push(
          "ruleToc.chapterUrl 缺少 webView:true。CSR 站点必须把 webView 写在 chapterUrl 上（如 /book/{{$.id}},{\"webView\":true}），Legado 只在 chapterUrl 检查 webView 选项。"
        );
      }
    }

    // Rule: webView should NOT be on search/detail/toc/API URLs
    const webViewFields = [];
    if (source.searchUrl && /webView|webview/i.test(source.searchUrl)) webViewFields.push("searchUrl");
    if (source.ruleBookInfo?.tocUrl && /webView|webview/i.test(source.ruleBookInfo.tocUrl)) webViewFields.push("ruleBookInfo.tocUrl");
    if (source.ruleSearch?.bookUrl && /webView|webview/i.test(source.ruleSearch.bookUrl)) webViewFields.push("ruleSearch.bookUrl");
    if (webViewFields.length > 0) {
      structuralErrors.push(
        `webView:true 不应出现在 ${webViewFields.join(", ")} 上。WebView 只用于渲染 CSR 正文页面，JSON API 和静态 HTML 不需要 WebView。将 webView 移到 ruleToc.chapterUrl 上。`
      );
    }

    // Rule: auth site MUST have enabledCookieJar + header or loginUrl
    if (state.loginFeatures.hasEnabledCookieJar || state.loginFeatures.hasAuthorization) {
      if (!source.enabledCookieJar) {
        structuralErrors.push("loginFeatures 标记了 enabledCookieJar/Authorization，但书源中 enabledCookieJar 为 false。需要登录态的站点必须设 enabledCookieJar: true。");
      }
      if (!source.loginUrl && !source.header) {
        structuralErrors.push("需要登录态但书源缺少 loginUrl 或 header。参考 examples/pattern-api-webview-auth/。");
      }
    }

    // Rule: WebView/CSR site needs polling webJs
    if ((state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs) && source.ruleContent?.webJs) {
      const wj = source.ruleContent.webJs;
      if (!/sleep|setTimeout|setInterval|retry|while\s*\(/.test(wj)) {
        structuralErrors.push(
          "ruleContent.webJs 缺少轮询等待逻辑（无 java.sleep / while / retry）。CSR 页面的 DOM 在 JS 执行后才渲染，webJs 必须循环等待元素出现。参考 examples/pattern-api-webview-auth/ 的 webJs 写法。"
        );
      }
    }

    // Rule: no jQuery selectors (Jsoup doesn't support :contains, :has, :eq, etc.)
    const jqueryPatterns = [":contains(", ":has(", ":eq(", ":first", ":last", ":text", ":input", ":visible", ":hidden"];
    for (const pattern of jqueryPatterns) {
      if (jsonStr.includes(pattern)) {
        structuralErrors.push(
          `检测到 jQuery 选择器 "${pattern}" — Legado 底层是 Jsoup，不支持此选择器。:contains() 需改用 @text action + <js> 过滤，:first/:last 改用 :first-child/:last-child。详见 references/legado-official-rule-notes.md。`
        );
        break;
      }
    }

    // Rule: wrong POST search syntax (;post= is not Legado format)
    if (source.searchUrl && (source.searchUrl.includes(";post=") || source.searchUrl.includes(";get="))) {
      structuralErrors.push(
        "searchUrl 使用了错误的 POST 语法 (;post=)。正确格式: url,{\"body\":\"key={{key}}\",\"method\":\"POST\"}。"
      );
    }

    // Rule: respondTime for WebView sites
    if ((state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs) && !source.respondTime) {
      structuralErrors.push("WebView 站点建议设置 respondTime: 180000（3 分钟），CSR 页面加载较慢。");
    }

    if (structuralErrors.length > 0) {
      const msg = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        `❌ 结构完整性检查未通过 (${structuralErrors.length} 项)`,
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        ...structuralErrors.map((e, i) => `  ${i + 1}. ${e}`),
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "修复以上问题后重新 advance。",
      ].join("\n");
      return fail(msg);
    }

    state.phases.generate.status = "completed";
    state.phases.generate.completedAt = new Date().toISOString();
    saveRunState(runDir, state);
    return moveToNext(phase, state, runDir);
  }

  if (phase === "validate") {
    // Validation completion is handled by record-validation, not advance
    // If validate is in_progress, the AI should run record-validation first
    return fail("请先运行 record-validation 记录验证结果，再 advance 进入 deliver。");
  }

  if (phase === "deliver") {
    return cmdDeliverCheck(state, runDir);
  }

  return fail(`未知阶段: ${phase}`);
}

function moveToNext(fromPhase, state, runDir) {
  const nextIdx = PHASE_ORDER.indexOf(fromPhase) + 1;
  if (nextIdx >= PHASE_ORDER.length) {
    return { ok: true, message: "所有阶段已完成。运行 deliver。", nextAction: "deliver" };
  }
  const next = PHASE_ORDER[nextIdx];
  state.phases[next].status = "in_progress";
  saveRunState(runDir, state);

  // Auto-detect auth features from analysis before generate/validate
  let authReminder = null;
  if (next === "generate" || next === "validate") {
    const authInfo = detectAuthFromAnalysis(runDir);
    if (authInfo.found) {
      const missing = Object.entries(authInfo.flags)
        .filter(([k, v]) => v && !state.loginFeatures[k])
        .map(([k]) => k);
      if (missing.length > 0) {
        authReminder = `⚠️ analysis.md 提到 auth/登录特征但 loginFeatures 未设: ${missing.join(", ")}。请在生成书源前运行: node scripts/bsg.mjs set-login-features --run <dir>`;
      }
    }
  }

  // Build validate message based on detected features
  let validateMessage = `运行 validator (第 ${(state.phases.validate.attempts || 0) + 1} 次)。保存 validator-report.json。完成后运行 record-validation。`;
  let validateWebViewInstruction = null;

  if (state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs) {
    validateWebViewInstruction = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "⚠️  WebView/CSR 正文 — 必须用 Android Probe",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "1. validator-start（窗口必须可见）",
      "2. validator/setup-adb.bat（3 个镜像自动重试）",
      "3. validator/setup-android-probe.bat",
      "4. validate-with-validator.mjs ... android",
      "5. Android 不可用时: mode=http + 正文失败标 validator_limitation",
      "",
      "禁止跳过 Android Probe 直接用 mode=http 标 passed！",
      "",
      "Android Probe 验证失败时的诊断顺序（不要直接说「已知限制」就跳过）：",
      "  a. 读 validator-report.json → steps[content].error 看具体错误",
      "  b. 超时 → 增加 webJs 等待时间（java.sleep(3000)）",
      "  c. 空内容 → webJs 选择器不对，用 Browser MCP snapshot 重新确认 DOM 结构",
      "  d. 401/403 → 需要 Cookie，提取并注入（见下方 Cookie 注入流程）",
      "  e. JS 报错 → 页面可能依赖特定 WebView API，检查兼容性",
      "  f. 以上都试过仍失败 → 才标记 needs_app_review",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");
    validateMessage = "🔴 WebView/CSR 正文 — 必须先尝试 Android Probe。\n" + validateWebViewInstruction;
  }

  // If login features are set, add cookie extraction reminder
  const hasLoginFeatures = Object.values(state.loginFeatures).some((b) => b === true);
  if (hasLoginFeatures && state.loginFeatures.hasEnabledCookieJar) {
    const cookieFlow = [
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🔑 登录态验证 — 必须先注入 Cookie",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "用户已在 Browser MCP 登录 → 必须提取 Cookie 注入 validator，否则正文鉴权失败。",
      "",
      "1. browser_network_requests 找到 API 请求头的 Cookie 或 Authorization",
      "2. 保存为 runs/<slug>/cookies.json: {\"domain\": \"full_cookie_string\"}",
      "3. 传给 validator: --cookie=runs/<slug>/cookies.json",
      "",
      "未注入 Cookie 的验证结果不能标 passed，只能标 anonymous_candidate。",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");
    validateMessage += cookieFlow;
  }

  const actions = {
    assess:  { nextAction: "write_assessment", message: "写 assessment.md 到 runs/<slug>/。评级必须是 4 种之一。完成后 advance。" },
    analyze: { nextAction: "write_analysis",   message: "按 search→detail→toc→content 顺序分析 4 条链路。双样本。完成后 advance。" },
    generate:{
      nextAction: "generate_json",
      message: "生成 book-source.json 到 outputs/<slug>/。对照 legado-official-rule-notes.md。若站点有登录/session/token/cookie 依赖，必须配置 enabledCookieJar + header。完成后 advance。" + (authReminder ? "\n" + authReminder : ""),
    },
    validate:{ nextAction: "run_validator", message: validateMessage },
    deliver: { nextAction: "deliver", message: "最终交付检查。运行 deliver 命令。" },
  };

  const a = actions[next] || { nextAction: next, message: `进入阶段: ${next}` };

  return {
    ok: true,
    nextAction: a.nextAction,
    currentPhase: next,
    message: a.message,
    ...(authReminder ? { authReminder } : {}),
    ...(a.csrWebViewHint ? { csrWebViewHint: a.csrWebViewHint } : {}),
    requiredUserAction: null,
  };
}

// ── adb / Android ───────────────────────────────────────────────────────────

function checkAdb() {
  try {
    const out = execSync("adb devices", { encoding: "utf-8", timeout: 5000 });
    // Look for a device line that isn't the header and has "device" status
    const lines = out.split("\n").filter((l) => l.trim() && !l.startsWith("List"));
    return lines.some((l) => l.includes("\tdevice") || l.includes("device"));
  } catch {
    return false;
  }
}

// ── auth detection from analysis ────────────────────────────────────────────

function detectAuthFromAnalysis(runDir) {
  const analysisPath = path.join(runDir, "analysis.md");
  if (!fileExists(analysisPath)) return { found: false };

  const text = fs.readFileSync(analysisPath, "utf-8").toLowerCase();
  const flags = {
    hasLoginUrl: /loginurl|登录页|登录.*url|sign.*?in.*?url/i.test(text),
    hasEnabledCookieJar: /enabledcookiejar|cookie.*?jar|session.*?(token|key|id)|cookie.*?auth/i.test(text),
    hasAuthorization: /authorization\s*:|bearer\s+|auth\s*token|x-api-key|api[_-]key/i.test(text),
    hasWebJs: /webjs|webview.*?js|dom.*?extract/i.test(text),
    hasWebView: /webview|web.view|csr.*?render|spa.*?render|aes.*?gcm|encrypt.*?client/i.test(text),
  };

  const detected = Object.entries(flags).filter(([, v]) => v).map(([k]) => k);
  return {
    found: detected.length > 0,
    flags,
    detected,
    message: detected.length > 0
      ? `从 analysis.md 自动检测到登录/Auth 特征: ${detected.join(", ")}。请运行 set-login-features 记录。`
      : null,
  };
}

function cmdCheck(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs check --run <run-dir>");

  const state = loadRunState(runDir);
  if (!state) return fail(`未找到 run-state.json: ${runDir}`);

  const results = [];

  // Rule 1: Not in skill install dir
  results.push({
    rule: "SKILL_DIR_CHECK",
    passed: !state.isSkillInstallDir,
    message: state.isSkillInstallDir
      ? "❌ 工作目录在 skill 安装目录内，禁止输出。"
      : "✅ 工作目录不是 skill 安装目录。",
  });

  // Rule 2-7 need book-source.json
  const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (!fileExists(bookSourcePath)) {
    results.push({ rule: "SOURCE_EXISTS", passed: false, message: "❌ book-source.json 不存在。" });
    return { ok: true, checks: results, allPassed: false };
  }

  let sourceJson, parsed;
  try {
    sourceJson = fs.readFileSync(bookSourcePath, "utf-8");
    parsed = JSON.parse(sourceJson);
  } catch {
    results.push({ rule: "SOURCE_EXISTS", passed: false, message: "❌ book-source.json 不是合法 JSON。" });
    return { ok: true, checks: results, allPassed: false };
  }

  // Rule 2: Array wrapper
  results.push({
    rule: "ARRAY_WRAPPER",
    passed: Array.isArray(parsed) && parsed.length > 0,
    message: Array.isArray(parsed)
      ? "✅ book-source.json 是 JSON 数组。"
      : "❌ book-source.json 必须是 JSON 数组 [{...}]。",
  });

  const source = Array.isArray(parsed) ? parsed[0] : parsed;

  // Rule 3: No empty string optional fields
  const emptyFields = [];
  for (const key of ["header", "loginUrl", "exploreUrl", "bookSourceComment"]) {
    if (source[key] === "") emptyFields.push(key);
  }
  results.push({
    rule: "NO_EMPTY_STRINGS",
    passed: emptyFields.length === 0,
    message: emptyFields.length > 0
      ? `❌ 空字符串字段: ${emptyFields.join(", ")}。删除它们或填有效值。`
      : "✅ 无可选字段为空字符串。",
  });

  // Rule 4: chapterUrl not empty
  const tocRule = source.ruleToc;
  const hasChapterUrl = tocRule && typeof tocRule.chapterUrl === "string" && tocRule.chapterUrl.trim().length > 0;
  results.push({
    rule: "CHAPTER_URL",
    passed: hasChapterUrl,
    message: hasChapterUrl
      ? "✅ ruleToc.chapterUrl 已填写。"
      : "❌ ruleToc.chapterUrl 为空。多章节时必须能生成稳定可区分的章节 URL。",
  });

  // Rule 5: 5 files integrity (only check if we're past generate)
  if (state.phases.assess.status === "completed") {
    const requiredFiles = [
      "assessment.md",
      "analysis.md",
      "validation-checklist.md",
      "validator-report.json",
      "validator-summary.md",
    ];
    const missing = requiredFiles.filter((f) => !fileExists(path.join(runDir, f)));
    results.push({
      rule: "FIVE_FILES",
      passed: missing.length === 0,
      message: missing.length > 0
        ? `❌ 缺少文件: ${missing.join(", ")}`
        : "✅ 5 个必要文件齐全。",
    });
  }

  // Rule 6: validator-report.json has full structure (if exists)
  const reportPath = path.join(runDir, "validator-report.json");
  if (fileExists(reportPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      const hasFull = report.phases && (report.steps || report.raw);
      results.push({
        rule: "VALIDATOR_REPORT_FULL",
        passed: hasFull,
        message: hasFull
          ? "✅ validator-report.json 包含完整 phases/steps。"
          : "❌ validator-report.json 缺少 phases 或 steps，不允许仅 summary。",
      });
    } catch {
      results.push({ rule: "VALIDATOR_REPORT_FULL", passed: false, message: "❌ validator-report.json 无法解析。" });
    }
  }

  // Rule 7: Explore disabled (unless user explicitly requested)
  const exploreEnabled = source.enabledExplore === true || (source.exploreUrl && source.exploreUrl.trim().length > 0);
  results.push({
    rule: "EXPLORE_DISABLED",
    passed: !exploreEnabled,
    message: exploreEnabled
      ? "⚠️ 已启用发现页。除非用户明确要求，否则应禁用。"
      : "✅ 发现页未启用。",
  });

  // Rule 8: Output dir is under user working dir
  const inUserDir = path.resolve(runDir).toLowerCase().startsWith(path.resolve(state.workingDir).toLowerCase());
  results.push({
    rule: "OUTPUT_DIR",
    passed: inUserDir,
    message: inUserDir
      ? "✅ runs/ 在用户工作目录下。"
      : "❌ runs/ 不在用户工作目录下。",
  });

  const allPassed = results.every((r) => r.passed);

  return {
    ok: true,
    checks: results,
    allPassed,
    message: allPassed
      ? "全部检查通过。"
      : `${results.filter((r) => !r.passed).length} 项检查未通过。`,
  };
}

// ── set-login-features ─────────────────────────────────────────────────────

function cmdSetLoginFeatures(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs set-login-features --run <dir> [--flags <json>]");

  const state = loadRunState(runDir);
  if (!state) return fail(`未找到 run-state.json: ${runDir}`);

  const flagsIdx = args.indexOf("--flags");
  if (flagsIdx >= 0) {
    try {
      const flags = JSON.parse(args[flagsIdx + 1]);
      Object.assign(state.loginFeatures, flags);
    } catch {
      return fail("--flags 必须是有效 JSON。");
    }
  }

  // Auto-detect from analysis.md if no explicit flags
  if (flagsIdx < 0) {
    const authInfo = detectAuthFromAnalysis(runDir);
    if (authInfo.found) {
      Object.assign(state.loginFeatures, authInfo.flags);
    }
  }

  // Also try to detect from existing book-source.json
  const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (fileExists(bookSourcePath)) {
    try {
      const json = JSON.parse(fs.readFileSync(bookSourcePath, "utf-8"));
      const source = Array.isArray(json) ? json[0] : json;
      if (!state.loginFeatures.hasLoginUrl && source.loginUrl) state.loginFeatures.hasLoginUrl = true;
      if (!state.loginFeatures.hasEnabledCookieJar && source.enabledCookieJar) state.loginFeatures.hasEnabledCookieJar = true;
      if (!state.loginFeatures.hasWebView) {
        const jsonStr = JSON.stringify(source);
        if (jsonStr.includes('"webView":true') || jsonStr.includes("'webView':true")) state.loginFeatures.hasWebView = true;
      }
      if (!state.loginFeatures.hasWebJs && source.ruleContent?.webJs) state.loginFeatures.hasWebJs = true;
    } catch { /* book-source.json not ready yet */ }
  }

  saveRunState(runDir, state);

  const flagsSet = Object.entries(state.loginFeatures).filter(([, v]) => v === true).map(([k]) => k);
  return {
    ok: true,
    loginFeatures: state.loginFeatures,
    message: flagsSet.length > 0
      ? `已记录登录态特征: ${flagsSet.join(", ")}`
      : "未检测到登录态特征。",
  };
}

// ── record-validation ──────────────────────────────────────────────────────

function cmdRecordValidation(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs record-validation --run <dir> --status <status> [--report <file>]");

  const statusIdx = args.indexOf("--status");
  if (statusIdx < 0) return fail("缺少 --status 参数 (passed|failed|needs_app_review|validator_limitation|degraded)");
  const status = args[statusIdx + 1];
  if (!status) return fail("--status 需要值");

  const validStatuses = ["passed", "failed", "needs_app_review", "validator_limitation", "degraded"];
  if (!validStatuses.includes(status)) {
    return fail(`无效状态: ${status}。可选值: ${validStatuses.join(", ")}`);
  }

  const state = loadRunState(runDir);
  if (!state) return fail(`未找到 run-state.json: ${runDir}`);

  const v = state.phases.validate;
  v.attempts += 1;
  v.lastStatus = status;

  const hasLoginFeatures = Object.values(state.loginFeatures).some((b) => b === true);
  let shouldRetry = false;
  let finalStatus = null;
  let nextAction = "deliver";
  let cookieWarning = null;
  let androidWarning = null;
  let convergenceBlock = null;

  // Check: content "success" but is actually CSR shell → fake pass
  if (status === "passed") {
    const reportPath = path.join(runDir, "validator-report.json");
    if (fileExists(reportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
        const preview = report.summary?.contentPreview || "";
        const csrShells = [
          "import.meta.url", "__nuxt", "__vite", "vite_is_modern",
          "window.__NUXT__", "<div id=\"__nuxt\"></div>", "<div id=\"app\"></div>",
          "id=\"__next\"", "_next/static", "webpackJsonp",
        ];
        if (csrShells.some((s) => preview.includes(s))) {
          // Override: this is a CSR shell, not real content
          const bookSourcePath2 = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
          if (fileExists(bookSourcePath2)) {
            try {
              const bs = JSON.parse(fs.readFileSync(bookSourcePath2, "utf-8"));
              const source = Array.isArray(bs) ? bs[0] : bs;
              const jsonStr = JSON.stringify(source);
              const hasWVonChapter = /chapterUrl[^}]*"webView"\s*:\s*true/i.test(jsonStr);
              const hasWVonContent = source.ruleContent?.webView === true;
              const csrWarning = [
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
                "⛔ 假阳性检测 — content 返回了 CSR 空壳",
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
                `contentPreview 包含 ${csrShells.filter((s) => preview.includes(s)).join(" / ")}，这是前端框架 JS 壳，不是正文。`,
                hasWVonChapter
                  ? "✅ chapterUrl 已配 webView:true。可能是 Android Probe 超时，检查 webJs 是否需要轮询等待。"
                  : hasWVonContent
                    ? "⚠️  ruleContent 有 webView 但 chapterUrl 没有！Legado 只有 chapterUrl 上的 webView 才会触发 WebView 加载。修复 chapterUrl 加上 ,{\"webView\":true}。"
                    : "❌ 书源未配置 WebView。CSR 页面需要 webView:true 在 chapterUrl 上，并在 webJs 中用轮询等待 DOM 渲染。",
                "修完后重新验证，不要标 passed。",
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
              ].join("\n");
              // Override: reject this passed status
              v.attempts -= 1;
              v.lastStatus = "failed";
              state.loginFeatures.hasWebView = true;
              saveRunState(runDir, state);
              return {
                ok: true,
                status: "blocked",
                blockedBy: "csr_shell_detected",
                shouldRetry: true,
                nextAction: "fix_csr_shell_and_retry",
                message: csrWarning,
              };
            } catch { /* ignore parse error */ }
          }
        }
      } catch { /* ignore parse error */ }
    }
  }

  // Check: book source has webView/webJs → verify via Android Probe
  const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (fileExists(bookSourcePath) && (status === "failed" || status === "needs_app_review" || status === "validator_limitation")) {
    try {
      const bs = JSON.parse(fs.readFileSync(bookSourcePath, "utf-8"));
      const source = Array.isArray(bs) ? bs[0] : bs;
      const jsonStr = JSON.stringify(source);
      const hasWV = jsonStr.includes('"webView":true') || jsonStr.includes("'webView':true");
      const hasWJ = source.ruleContent?.webJs;
      if (hasWV || hasWJ) {
        state.loginFeatures.hasWebView = hasWV;
        state.loginFeatures.hasWebJs = !!hasWJ;
        const adbOk = checkAdb();
        if (adbOk) {
          // Device connected but AI didn't use it → BLOCK
          androidWarning = [
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "⛔ WebView 未验证 — Android 设备已连接但未使用",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "adb 检测到设备，但你用了 mode=http 验证 WebView 正文。",
            "立即执行: validator/setup-android-probe.bat → 重新验证 → record-validation。",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          ].join("\n");
        } else if (state.adbDetected) {
          // Device was available at init but now gone → likely disconnected/sleeping
          androidWarning = [
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "⚠️  Android 设备已断开 — 请重新连接",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "init 时检测到 Android 设备，但现在 adb 找不到设备。",
            "可能原因：手机息屏后 USB 断开、adb 授权过期、数据线松动。",
            "请重新插拔 USB 并在手机上确认 USB 调试授权。",
            "然后运行: validator/setup-android-probe.bat → 重新用 mode=android 验证。",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          ].join("\n");
        } else {
          // No Android device → warn but don't block. User genuinely can't provide one.
          androidWarning = [
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "⚠️  WebView 正文 — Android Probe 不可用",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "无 Android 设备，WebView 正文无法在本机验证。",
            "书源状态将标为 needs_app_review——需在 Legado App 内实测正文。",
            "如果用户后续连接了 Android 设备，可用 validator/setup-android-probe.bat 重新验证。",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          ].join("\n");
        }
        saveRunState(runDir, state);
      }
    } catch { /* ignore */ }
  }

  if (androidWarning && checkAdb()) {
    // adb available but not used → BLOCK
    v.attempts -= 1;
    saveRunState(runDir, state);
    return { ok: true, status: "blocked", blockedBy: "android_probe_not_used", shouldRetry: true, nextAction: "setup_android_probe_and_retry", message: androidWarning };
  }
  if (androidWarning && state.adbDetected) {
    // Device was available at init but now disconnected → BLOCK, fixable
    v.attempts -= 1;
    saveRunState(runDir, state);
    return { ok: true, status: "blocked", blockedBy: "android_device_disconnected", shouldRetry: true, nextAction: "reconnect_device_and_retry", message: androidWarning };
  }
  // Never had device → warning only, allow continue
  if (androidWarning) {
    state._androidWarning = androidWarning;
  }

  // Check: enabledCookieJar set but no cookies.json → likely forgot to inject
  if (state.loginFeatures.hasEnabledCookieJar && (status === "failed" || status === "needs_app_review")) {
    const cookieFile = path.join(runDir, "cookies.json");
    if (!fileExists(cookieFile)) {
      cookieWarning = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⛔ Cookie 未注入 — 拒绝通过",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "enabledCookieJar=true 但 runs/<slug>/cookies.json 不存在。",
        "用户已在 Browser MCP 登录 → 必须先提取 Cookie 注入 validator：",
        "1. browser_network_requests 找 API 请求的 Cookie/Authorization header",
        "2. 保存 {\"domain\": \"cookie_string\"} 到 runs/<slug>/cookies.json",
        "3. 重新验证: validate-with-validator.mjs ... --cookie=runs/<slug>/cookies.json",
        "4. 再次运行 record-validation",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");
    }
  }

  if (cookieWarning) {
    // Block: don't record this as a real validation result
    v.attempts -= 1; // don't count this attempt
    saveRunState(runDir, state);
    return {
      ok: true,
      status: "blocked",
      blockedBy: "cookie_not_injected",
      shouldRetry: true,
      nextAction: "inject_cookies_and_retry",
      message: cookieWarning,
    };
  }

  if (status === "passed" && !hasLoginFeatures) {
    finalStatus = "passed";
    v.status = "completed";
    v.consecutiveSame = 0;
  } else if (status === "passed" && hasLoginFeatures) {
    finalStatus = "anonymous_candidate";
    v.status = "completed";
    v.consecutiveSame = 0;
  } else if (status === "degraded") {
    finalStatus = "degraded";
    v.status = "completed";
    nextAction = "deliver";
  } else if (status === "failed") {
    // Convergence detection: extract error signature from validator report
    let errorSig = status;
    const reportPath = path.join(runDir, "validator-report.json");
    if (fileExists(reportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
        const contentStep = (report.steps || []).find((s) => s.phase === "content");
        const failedHits = (contentStep?.ruleHits || []).filter((r) => !r.success).map((r) => r.field).sort().join(",");
        errorSig = (contentStep?.error || "unknown") + "|" + failedHits;
      } catch { /* keep raw status as sig */ }
    }

    if (errorSig === v.lastError) {
      v.consecutiveSame = (v.consecutiveSame || 0) + 1;
    } else {
      v.consecutiveSame = 1;
    }
    v.lastError = errorSig;

    if (v.consecutiveSame >= 5) {
      // Same error 3 times → convergence failure (not making progress)
      finalStatus = "failed_unresolved";
      v.status = "completed";
      nextAction = "deliver";
      convergenceBlock = `同一错误连续 ${v.consecutiveSame} 次未修复 (${errorSig.slice(0, 120)})，判定为死循环。停止自动回修，需人工介入。`;
    } else {
      shouldRetry = true;
      finalStatus = "failed";
      nextAction = "fix_and_retry";
    }
  } else if (status === "needs_app_review") {
    finalStatus = "needs_app_review";
    v.status = "completed";
    nextAction = "deliver";
  } else if (status === "validator_limitation") {
    finalStatus = "validator_limitation";
    v.status = "completed";
    nextAction = "deliver";
  }

  saveRunState(runDir, state);

  let baseMessage;
  if (shouldRetry) {
    baseMessage = `验证失败 (第 ${v.attempts} 次${v.consecutiveSame > 1 ? `，同一错误第 ${v.consecutiveSame} 次` : ""})。请根据错误证据回修规则。${v.consecutiveSame >= 2 ? "⚠️ 已连续 " + v.consecutiveSame + " 次相同错误，再失败将停止自动修。" : ""}`;
  } else if (convergenceBlock) {
    baseMessage = convergenceBlock;
  } else {
    baseMessage = `验证完成。状态: ${finalStatus}。执行 advance 进入 deliver。`;
  }

  return {
    ok: true,
    status: finalStatus,
    attempt: v.attempts,
    consecutiveSame: v.consecutiveSame,
    shouldRetry,
    nextAction,
    message: baseMessage + (state._androidWarning ? "\n" + state._androidWarning : ""),
    ...(state._androidWarning ? { androidWarning: state._androidWarning } : {}),
    ...(convergenceBlock ? { convergenceBlock } : {}),
  };
}

// ── deliver ────────────────────────────────────────────────────────────────

function cmdDeliverCheck(state, runDir) {
  // Check 5 files
  const requiredFiles = [
    "assessment.md",
    "analysis.md",
    "validation-checklist.md",
    "validator-report.json",
    "validator-summary.md",
  ];
  const missing = requiredFiles.filter((f) => !fileExists(path.join(runDir, f)));

  if (missing.length > 0) {
    return fail(`交付前文件不完整。缺少: ${missing.join(", ")}`);
  }

  // Check book-source.json
  const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (!fileExists(bookSourcePath)) {
    return fail("book-source.json 不存在。");
  }

  let sourceJson;
  try {
    sourceJson = fs.readFileSync(bookSourcePath, "utf-8");
    JSON.parse(sourceJson);
  } catch (e) {
    return fail(`book-source.json 不是合法 JSON: ${e.message}`);
  }

  const v = state.phases.validate;
  const hasLoginFeatures = Object.values(state.loginFeatures).some((b) => b === true);
  let finalStatus;

  if (v.lastStatus === "passed" && !hasLoginFeatures) {
    finalStatus = "passed";
  } else if (v.lastStatus === "passed" && hasLoginFeatures) {
    finalStatus = "anonymous_candidate";
  } else if (v.lastStatus === "degraded") {
    finalStatus = "degraded";
  } else if (v.lastStatus === "needs_app_review") {
    finalStatus = "needs_app_review";
  } else if (v.lastStatus === "validator_limitation") {
    finalStatus = "validator_limitation";
  } else if (v.lastStatus === "failed") {
    finalStatus = "failed_unresolved";
  } else {
    // No validator run — should not happen if advance was used correctly
    finalStatus = "unvalidated";
  }

  const STATUS_MESSAGES = {
    passed: "已生成 book-source.json，validator 验证通过（全链路成功）。",
    anonymous_candidate: "已生成 book-source.json，匿名验证通过但站点存在登录态/WebView/Cookie 依赖，不能标可用，需登录态/App 复核。",
    degraded: "已生成 book-source.json，技术链路通过但阅读体验降级。可导入，但建议 App 端确认章节体验。",
    needs_app_review: "已生成 book-source.json，validator 检测到需 App 复核。",
    failed_unresolved: "已生成 book-source.json，同一错误连续 5 次未修复（收敛失败）。需人工检查。",
    validator_limitation: "已生成 book-source.json，validator 无法验证部分能力；预期需要 App/WebView 复核。当前不是 full pass，不能标可用。",
    unvalidated: "已生成 book-source.json，但 validator 未运行。状态不确定。",
  };

  state.phases.deliver.status = "completed";
  saveRunState(runDir, state);

  return {
    ok: true,
    finalStatus,
    nextAction: null,
    message: STATUS_MESSAGES[finalStatus] || STATUS_MESSAGES.unvalidated,
    loginFeatures: state.loginFeatures,
    loginFeatureFlags: hasLoginFeatures
      ? Object.entries(state.loginFeatures).filter(([, v]) => v).map(([k]) => k)
      : [],
    deliverable: path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json"),
  };
}

function cmdDeliver(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs deliver --run <run-dir>");

  const state = loadRunState(runDir);
  if (!state) return fail(`未找到 run-state.json: ${runDir}`);

  return cmdDeliverCheck(state, runDir);
}

// ── validator lifecycle ────────────────────────────────────────────────────

async function checkValidator() {
  try {
    const res = await fetch(`${VALIDATOR_URL}/api/sources`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function findValidatorPid() {
  try {
    if (process.platform === "win32") {
      const out = execSync('netstat -aon | findstr :1111 | findstr LISTENING', {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      if (!out) return null;
      const m = out.match(/(\d+)\s*$/m);
      return m ? parseInt(m[1]) : null;
    } else {
      const out = execSync("lsof -ti :1111", { encoding: "utf-8", timeout: 5000 }).trim();
      return out ? parseInt(out) : null;
    }
  } catch {
    return null;
  }
}

function getValidatorJar() {
  const jarPath = path.join(SKILL_ROOT, "validator", "app", "legado-source-validator.jar");
  if (!fs.existsSync(jarPath)) {
    // Try release layout
    const alt = path.join(SKILL_ROOT, "app", "legado-source-validator.jar");
    if (fs.existsSync(alt)) return alt;
    return null;
  }
  return jarPath;
}

async function cmdValidatorStart(args) {
  const running = await checkValidator();
  if (running) {
    const pid = findValidatorPid();
    return {
      ok: true,
      running: true,
      url: VALIDATOR_URL,
      pid,
      message: `Validator 已在运行 (PID: ${pid || "未知"}, ${VALIDATOR_URL})。复用现有服务。`,
    };
  }

  const jarPath = getValidatorJar();
  if (!jarPath) {
    return fail("找不到 legado-source-validator.jar。请确认 validator/app/ 目录存在。");
  }

  try {
    // Always detached (non-blocking) but ALWAYS show the window.
    // User must be able to see and manually close the validator window.
    const child = spawn("java", ["-jar", jarPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();

    // Wait briefly for startup
    await new Promise((r) => setTimeout(r, 3000));

    const up = await checkValidator();
    const pid = child.pid;

    return {
      ok: true,
      running: up,
      url: VALIDATOR_URL,
      pid,
      startedBySession: true,
      visibleWindow: true,
      message: up
        ? `Validator 已启动 (PID: ${pid}, ${VALIDATOR_URL})。窗口可见，关闭窗口或 Ctrl+C 停止。`
        : `Validator 进程已创建 (PID: ${pid}) 但尚未就绪，请等待几秒后重试。`,
      stopMethod: "关窗口 / 双击 stop.bat / taskkill /PID " + pid + " /F",
    };
  } catch (e) {
    return fail(`启动 validator 失败: ${e.message}`);
  }
}

async function cmdValidatorStop() {
  const pid = findValidatorPid();
  if (!pid) {
    return { ok: true, message: "未找到运行中的 validator (端口 1111)。" };
  }

  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
    } else {
      execSync(`kill ${pid}`, { timeout: 5000 });
    }
    return { ok: true, message: `Validator 已停止 (PID: ${pid})。` };
  } catch (e) {
    return fail(`停止 validator 失败: ${e.message}`);
  }
}

// ── main ───────────────────────────────────────────────────────────────────

function printUsage() {
  console.error(
    [
      "用法:",
      "  node scripts/bsg.mjs init <site-url> [--fast]",
      "  node scripts/bsg.mjs status --run <dir>",
      "  node scripts/bsg.mjs advance --run <dir>",
      "  node scripts/bsg.mjs check --run <dir>",
      "  node scripts/bsg.mjs set-login-features --run <dir> [--flags <json>]",
      "  node scripts/bsg.mjs record-validation --run <dir> --status <status> [--report <file>]",
      "  node scripts/bsg.mjs deliver --run <dir>",
      "  node scripts/bsg.mjs validator-start [--background]",
      "  node scripts/bsg.mjs validator-stop",
    ].join("\n")
  );
}

async function main(argv) {
  if (argv.length < 1) {
    printUsage();
    return 1;
  }

  const command = argv[0];
  const args = argv.slice(1);
  let result;

  switch (command) {
    case "init":
      result = cmdInit(args);
      break;
    case "status":
      result = cmdStatus(args);
      break;
    case "advance":
      result = cmdAdvance(args);
      break;
    case "check":
      result = cmdCheck(args);
      break;
    case "set-login-features":
      result = cmdSetLoginFeatures(args);
      break;
    case "record-validation":
      result = cmdRecordValidation(args);
      break;
    case "deliver":
      result = cmdDeliver(args);
      break;
    case "validator-start":
      result = await cmdValidatorStart(args);
      break;
    case "validator-stop":
      result = await cmdValidatorStop();
      break;
    default:
      result = fail(
        `未知命令: ${command}。可用: init, status, advance, check, set-login-features, record-validation, deliver, validator-start, validator-stop`
      );
  }

  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

// Always run main() directly — this script is the entry point, never imported.
process.exitCode = (await main(process.argv.slice(2)));
