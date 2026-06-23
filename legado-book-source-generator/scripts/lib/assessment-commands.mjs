import fs from "node:fs";
import path from "node:path";
import {
  fail, parseArg, fileExists, fileSha256, saveRunState,
  loadAndVerify, getPendingUserAction, printHint,
} from "./state.mjs";
import {
  PHASE_ORDER, currentPhaseIndex, diagnoseAndroid,
  detectAuthFromAnalysis, checkProbeCookies, hasProbeLoginEvidence,
  summarizeProbeCookieCheck,
} from "./phase-engine.mjs";
import {
  loadAndValidateAssessment, validateCookieFileShape,
} from "./facts.mjs";

export function cmdRecordAssessment(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" record-assessment --run {dir}");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const current = PHASE_ORDER[currentPhaseIndex(state)];
  if (current !== "assess" || state.phases.assess.status !== "in_progress") {
    const correctiveAction = `record-assessment 需要 assessment.md 和 site-facts.json 已到可记录状态。当前阶段是 ${current}（${state.phases[current]?.status || "unknown"}）。请先运行 status 查看缺什么，或运行 run 进入下一步。`;
    const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" status --run ${runDir}`;
    printHint(correctiveAction, nextCommand);
    return { ...fail(correctiveAction), correctiveAction, nextCommand };
  }

  const assessment = loadAndValidateAssessment(runDir, state);
  if (!assessment.ok) return fail(assessment.error);

  state.phases.assess.rating = assessment.rating;
  state.phases.assess.recorded = true;
  state.phases.assess.recordedAt = new Date().toISOString();
  state.phases.assess.factsHash = fileSha256(path.join(runDir, "site-facts.json"));
  saveRunState(runDir, state);

  return {
    ok: true,
    nextAction: "run",
    rating: assessment.rating,
    summary: {
      riskLabels: assessment.derived.riskLabels,
      overallStatus: assessment.derived.overallStatus,
      fullPass: assessment.derived.fullPass,
      blockers: assessment.derived.blockers,
      requiredActions: assessment.derived.requiredActions,
    },
    signals: {
      protectedContent: assessment.signals.protectedContent,
      hasLoginRiskLabel: assessment.signals.hasLoginRiskLabel,
      hasPaymentRisk: assessment.signals.hasPaymentRisk,
      hasWebView: assessment.signals.hasWebView,
      hasEncryptedContent: assessment.signals.hasEncryptedContent,
      hasEntryAntiBotRisk: assessment.signals.hasEntryAntiBotRisk,
    },
    message: "assessment.md 已通过一致性检查并记录。现在运行 run；如返回 requiredUserAction，先让用户确认。",
    nextCommand: `node "<skill-dir>/scripts/bsg.mjs" run --run ${runDir}`,
  };
}

export function cmdCheck(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" check --run <run-dir>");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const results = [];

  results.push({
    rule: "SKILL_DIR_CHECK",
    passed: !state.isSkillInstallDir,
    message: state.isSkillInstallDir
      ? "❌ 工作目录在 skill 安装目录内，禁止输出。"
      : "✅ 工作目录不是 skill 安装目录。",
  });

  const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (!fileExists(bookSourcePath)) {
    results.push({ rule: "SOURCE_EXISTS", passed: false, message: "❌ book-source.json 不存在。" });
    return { ok: true, checks: results, allPassed: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(bookSourcePath, "utf-8"));
  } catch {
    results.push({ rule: "SOURCE_EXISTS", passed: false, message: "❌ book-source.json 不是合法 JSON。" });
    return { ok: true, checks: results, allPassed: false };
  }

  results.push({
    rule: "ARRAY_WRAPPER",
    passed: Array.isArray(parsed) && parsed.length > 0,
    message: Array.isArray(parsed)
      ? "✅ book-source.json 是 JSON 数组。"
      : "❌ book-source.json 必须是 JSON 数组 [{...}]。",
  });

  const source = Array.isArray(parsed) ? parsed[0] : parsed;

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

  const tocRule = source.ruleToc;
  const hasChapterUrl = tocRule && typeof tocRule.chapterUrl === "string" && tocRule.chapterUrl.trim().length > 0;
  results.push({
    rule: "CHAPTER_URL",
    passed: hasChapterUrl,
    message: hasChapterUrl
      ? "✅ ruleToc.chapterUrl 已填写。"
      : "❌ ruleToc.chapterUrl 为空。多章节时必须能生成稳定可区分的章节 URL。",
  });

  if (state.phases.assess.status === "completed") {
    const requiredFiles = [
      "assessment.md",
      "analysis.md",
      "validation-checklist.md",
      "site-facts.json",
      "capability-matrix.json",
      "rule-check.json",
      "lesson-check.json",
      "validator-report.json",
      "validator-summary.md",
    ];
    const missing = requiredFiles.filter((f) => !fileExists(path.join(runDir, f)));
    results.push({
      rule: "RUN_ARTIFACTS",
      passed: missing.length === 0,
      message: missing.length > 0
        ? `❌ 缺少文件: ${missing.join(", ")}`
        : "✅ runs/ 必要文件齐全。",
    });
  }

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

  const exploreEnabled = source.enabledExplore === true || (source.exploreUrl && source.exploreUrl.trim().length > 0);
  results.push({
    rule: "EXPLORE_DISABLED",
    passed: !exploreEnabled,
    message: exploreEnabled
      ? "⚠️ 已启用发现页。除非用户明确要求，否则应禁用。"
      : "✅ 发现页未启用。",
  });

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

export function cmdSetLoginFeatures(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" set-login-features --run {dir} [--flags <json>]");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const flagsIdx = args.indexOf("--flags");
  if (flagsIdx >= 0) {
    try {
      const flags = JSON.parse(args[flagsIdx + 1]);
      Object.assign(state.loginFeatures, flags);
    } catch {
      return fail("--flags 必须是有效 JSON。");
    }
  }

  if (flagsIdx < 0) {
    const authInfo = detectAuthFromAnalysis(runDir);
    if (authInfo.found) {
      Object.assign(state.loginFeatures, authInfo.flags);
    }
  }

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

export function cmdResolveUserAction(args) {
  const runDir = parseArg(args, "--run");
  const action = parseArg(args, "--action");
  if (!runDir || !action) {
    return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" resolve-user-action --run {dir} --action <android_device_ready|android_device_unavailable|continue_after_entry_risk|login_completed|no_account|continue_after_rating_block|toc_chapter_count_confirmed>");
  }

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const pending = getPendingUserAction(state);
  if (!pending) return fail("当前没有待用户确认的动作。");

  const validActions = {
    android_device_needed: ["android_device_ready", "android_device_unavailable"],
    android_entry_review_needed: ["android_device_ready", "android_device_unavailable", "continue_after_entry_risk"],
    login_required: ["login_completed", "no_account"],
    rating_blocked: ["continue_after_rating_block"],
    toc_sample_review: ["toc_chapter_count_confirmed"],
  };
  const allowed = validActions[pending.type] || [];
  if (!allowed.includes(action)) {
    return fail(`当前待处理动作为 ${pending.type}，不能用 ${action} 解除。可选: ${allowed.join(", ")}`);
  }

  state.userDecisions = state.userDecisions || {};
  let probeCookieEvidence = null;
  if (action === "android_device_unavailable") {
    const android = diagnoseAndroid();
    if (android.state === "device_ready") {
      return fail("已检测到 Android 真机或模拟器在线，不能记录 android_device_unavailable。若用户要使用设备，请运行 resolve-user-action --action android_device_ready。");
    }
    state.userDecisions.androidDevice = "unavailable";
    if (pending.type === "android_entry_review_needed") state.userDecisions.entryRisk = "android_unavailable";
  } else if (action === "android_device_ready") {
    const android = diagnoseAndroid();
    if (android.state !== "device_ready") {
      return fail(`Android 真机或模拟器尚未可用: ${android.state}。${android.message}`);
    }
    state.userDecisions.androidDevice = "ready";
    if (pending.type === "android_entry_review_needed") state.userDecisions.entryRisk = "android_ready";
  } else if (action === "no_account") {
    state.userDecisions.login = "no_account";
    state.loginFeatures._loginDeclined = true;
  } else if (action === "login_completed") {
    const pendingAndroid = pending.details?.android;
    const android = diagnoseAndroid();
    const adbOnline = pending.details?.adbAvailable === true || pendingAndroid?.state === "device_ready" || android.state === "device_ready";
    if (adbOnline) {
      const probeCookies = checkProbeCookies(state.siteUrl);
      probeCookieEvidence = summarizeProbeCookieCheck(state.siteUrl, probeCookies);
      if (!probeCookies.ok) {
        return {
          ...fail("Android 真机或模拟器在线时，login_completed 必须先通过 Probe Cookie 检查。请运行 node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir> 打开手机/模拟器登录页，登录完成后再运行 node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir> --login-completed。"),
          probeCookieEvidence,
        };
      }
      if (!hasProbeLoginEvidence(probeCookies.parsed)) {
        return {
          ...fail("Probe /cookie-check 只证明目标域存在 Cookie，不能证明已登录账号态。login_completed 需要 Probe 返回 authenticated/loggedIn/isLoggedIn=true、非 anonymous sessionMode，或 user/account 证据；否则请选择 no_account 或继续在手机/模拟器完成登录后重试。"),
          probeCookieEvidence,
        };
      }
      state.loginFeatures._loginMethod = "probe";
    } else {
      const cookieShape = validateCookieFileShape(path.join(runDir, "cookies.json"));
      if (!cookieShape.ok) {
        return fail(`Browser Cookie 路径必须先保存有效 runs/<slug>/cookies.json 后才能记录 login_completed: ${cookieShape.reason}`);
      }
      state.loginFeatures._loginMethod = "browser_mcp_cookies";
    }
    state.userDecisions.login = "completed";
    state.loginFeatures._loginVerified = true;
  } else if (action === "continue_after_rating_block") {
    state.userDecisions.ratingBlocked = "continue";
  } else if (action === "continue_after_entry_risk") {
    const android = diagnoseAndroid();
    if (android.state === "device_ready") {
      return fail("已检测到 Android 真机或模拟器在线，不能跳过入口链路 Android 复核。请运行 resolve-user-action --action android_device_ready。");
    }
    state.userDecisions.entryRisk = "accepted_skip";
  } else if (action === "toc_chapter_count_confirmed") {
    state.userDecisions.tocChapterCount = "confirmed_small_sample";
  }

  state.userActionHistory = state.userActionHistory || [];
  state.userActionHistory.push({
    type: pending.type,
    reason: pending.reason,
    action,
    resolvedAt: new Date().toISOString(),
  });
  state.pendingUserAction = null;
  saveRunState(runDir, state);

  return {
    ok: true,
    resolved: pending.type,
    action,
    nextAction: "run",
    message: `已记录用户选择: ${action}。继续运行 run。`,
    ...(probeCookieEvidence ? { probeCookieEvidence } : {}),
  };
}
