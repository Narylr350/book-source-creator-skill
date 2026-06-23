import fs from "node:fs";
import path from "node:path";
import {
  fail, fileExists, fileSha256, printHint, sha256Text, saveRunState, setPendingUserAction,
} from "./state.mjs";
import {
  bookSourceHasWebView, factsSuggestWebView, loadAndValidateAssessment, validateCookieFileShape, runOfficialRuleCheck, writeRuleCheck,
} from "./facts.mjs";
import {
  diagnoseAndroid, checkAdb, checkProbeCookies, detectAuthFromAnalysis, hasProbeLoginEvidence,
} from "./environment.mjs";
import { cmdDeliverCheck } from "./deliver-check.mjs";
import { PHASE_ORDER, currentPhaseIndex, resetPhasesFrom } from "./phase-order.mjs";

export {
  checkEnvironment, parseAdbDevicesOutput, diagnoseAndroid, checkAdb,
  cmdAndroidStatus, checkProbeCookies, detectAuthFromAnalysis, hasProbeLoginEvidence,
} from "./environment.mjs";
export { cmdDeliverCheck } from "./deliver-check.mjs";
export { PHASE_ORDER, currentPhaseIndex, resetPhasesFrom } from "./phase-order.mjs";

// ── phase state machine ────────────────────────────────────────────────────

export const PHASE_READ_NEXT = {
  probe: ["references/probe-guide.md", "references/assessment-template.md"],
  assess: ["references/assessment-template.md"],
  analyze: ["references/analysis-workflow.md"],
  generate: [
    "references/official-rule-pack.json",
    "references/legado-json-structure.md",
    "references/legado-source-behavior.md",
  ],
  validate: ["references/validator-integration.md", "references/validation-policy.md"],
  deliver: ["references/outputs.md"],
};

export function phaseNextCommand(runDir, phase) {
  const commands = {
    probe: `node "<skill-dir>/scripts/bsg.mjs" advance --run ${runDir}`,
    assess: `node "<skill-dir>/scripts/bsg.mjs" record-assessment --run ${runDir}`,
    analyze: `node "<skill-dir>/scripts/bsg.mjs" advance --run ${runDir}`,
    generate: `node "<skill-dir>/scripts/bsg.mjs" advance --run ${runDir}`,
    validate: `node "<skill-dir>/scripts/bsg.mjs" validate --run ${runDir}`,
    deliver: `node "<skill-dir>/scripts/bsg.mjs" deliver --run ${runDir}`,
  };
  return commands[phase] || "";
}

function phaseHints(runDir, phase) {
  return {
    readNext: PHASE_READ_NEXT[phase] || [],
    nextCommand: phaseNextCommand(runDir, phase),
  };
}

export function startPhase(phase, state, runDir) {
  if (phase === "probe") {
    state.phases.probe.status = "in_progress";
    saveRunState(runDir, state);
    return {
      ok: true,
      nextAction: "probe_site",
      message: "匿名初探：用 HTTP fetch 或 Browser MCP 探索 search/detail/toc/content 四条链路。",
      requiredUserAction: null,
      ...phaseHints(runDir, "probe"),
    };
  }

  state.phases[phase].status = "in_progress";
  saveRunState(runDir, state);

  const actions = {
    assess:  { nextAction: "record_assessment", message: "写 assessment.md 后必须先运行 record-assessment。record-assessment 通过前不要展示评估摘要，也不要 advance。" },
    analyze: { nextAction: "write_analysis",   message: "按 search→detail→toc→content 顺序分析，写 analysis.md。完成后 advance。" },
    generate:{ nextAction: "generate_json",     message: "生成 book-source.json 到 outputs/<slug>/。完成后 advance。" },
    validate:{ nextAction: "run_validator",     message: "运行 bsg.mjs validate --run {dir}，让它写入 validator-report.json。完成后 record-validation。" },
    deliver: { nextAction: "deliver",           message: "运行 deliver 完成最终交付。" },
  };

  const a = actions[phase] || { nextAction: phase, message: `阶段: ${phase}` };
  return { ok: true, ...a, requiredUserAction: null, ...phaseHints(runDir, phase) };
}

export function completePhase(phase, state, runDir) {
  if (phase === "probe") {
    state.phases.probe.status = "completed";
    state.phases.probe.completedAt = new Date().toISOString();
    saveRunState(runDir, state);
    return moveToNext(phase, state, runDir);
  }

  if (phase === "assess") {
    if (state.phases.assess.recorded !== true) {
      const correctiveAction = "assessment.md 尚未通过 record-assessment 记录。先运行 record-assessment，通过前不要展示评估摘要，也不要 advance。";
      const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" record-assessment --run ${runDir}`;
      printHint(correctiveAction, nextCommand);
      return {
        ...fail("assessment.md 尚未通过 record-assessment 记录。先运行: node scripts/bsg.mjs record-assessment --run <run-dir>。通过前不要展示评估摘要。"),
        correctiveAction,
        nextCommand,
      };
    }

    const assessment = loadAndValidateAssessment(runDir, state);
    if (!assessment.ok) return fail(assessment.error);
    const assessmentSignals = assessment.signals;
    state.phases.assess.rating = assessment.rating;
    state.phases.assess.factsHash = fileSha256(path.join(runDir, "site-facts.json"));
    if (assessmentSignals.hasWebView) state.loginFeatures.hasWebView = true;
    if (assessmentSignals.hasLoginRiskLabel || assessmentSignals.protectedContent) state.loginFeatures.hasEnabledCookieJar = true;
    if (assessmentSignals.hasEncryptedContent) { state.loginFeatures.hasWebView = true; state.loginFeatures.hasWebJs = true; }

    if (state.phases.assess.rating === "不建议生成" && state.userDecisions?.ratingBlocked !== "continue") {
      const message = `评估评级为"不建议生成"，需要用户决定是否继续。`;
      const pending = setPendingUserAction(state, "rating_blocked", "rating_blocked", message, {
        blockingPhase: "assess",
        rating: state.phases.assess.rating,
      });
      saveRunState(runDir, state);
      return {
        ok: true,
        nextAction: "stop",
        requiredUserAction: "rating_blocked",
        message,
        blockingPhase: "assess",
        rating: state.phases.assess.rating,
        pendingUserAction: pending,
      };
    }

    if (
      assessmentSignals.hasEntryAntiBotRisk &&
      state.userDecisions?.entryRisk !== "accepted_skip" &&
      state.userDecisions?.entryRisk !== "android_ready" &&
      state.userDecisions?.entryRisk !== "android_unavailable"
    ) {
      const android = diagnoseAndroid();
      const message = [
        "搜索/入口链路存在验证码、Cloudflare 或反爬阻塞。",
        "",
        `当前 Android/adb 状态: ${android.state}。${android.message}`,
        "",
        "这类风险可能在桌面浏览器、HTTP validator、Android WebView/阅读 App 中表现不同。",
        "必须先确认是否用 Android 真机或模拟器复核入口链路，不能直接用排行榜/书库替代搜索并继续。",
        "",
        android.state === "device_ready"
          ? "已检测到 Android 真机或模拟器：运行 node scripts/bsg.mjs android --run <dir>，让 Android 单入口复核入口链路。"
          : "未检测到可用 Android 真机或模拟器：先问用户是否有真机或模拟器；有则连接/启动后运行 node scripts/bsg.mjs android --run <dir>。",
        "只有用户明确接受入口不完整并跳过 Android 复核时，才记录 continue_after_entry_risk。",
      ].join("\n");
      const pending = setPendingUserAction(state, "android_entry_review_needed", "entry_antibot_requires_android_decision", message, {
        blockingPhase: "assess",
        android,
        blockers: assessment.derived.blockers,
      });
      saveRunState(runDir, state);
      return {
        ok: true,
        nextAction: "stop",
        requiredUserAction: "android_entry_review_needed",
        reason: "entry_antibot_requires_android_decision",
        message,
        android,
        pendingUserAction: pending,
      };
    }

    if (state.loginFeatures.hasEnabledCookieJar || state.loginFeatures.hasAuthorization) {
      const android = diagnoseAndroid();
      const adbOk = android.state === "device_ready";

      if (!adbOk && state.userDecisions?.androidDevice !== "unavailable") {
        const message = [
          "站点需要登录态/Cookie/Authorization，但未检测到可用 Android 真机或模拟器。",
          "",
          `当前 Android/adb 状态: ${android.state}。${android.message}`,
          "",
          "为尽量还原阅读 App 行为，必须先确认是否有 Android 真机或模拟器可用于 Probe 登录和 App/WebView 验证。",
          "  • 如果有，请连接真机或启动模拟器并完成 adb 授权后，再运行 node scripts/bsg.mjs android --run <dir>。",
          "  • 如果没有可用 Android 真机或模拟器，让用户明确确认后运行 node scripts/bsg.mjs android --run <dir> --no-device；之后才允许降级为 Browser Cookie 登录路径。",
        ].join("\n");
        const pending = setPendingUserAction(state, "android_device_needed", "login_requires_android_decision", message, {
          blockingPhase: "assess",
          android,
          loginRequired: true,
        });
        saveRunState(runDir, state);
        return {
          ok: true,
          nextAction: "stop",
          requiredUserAction: "android_device_needed",
          message,
          blockingPhase: "assess",
          reason: "login_requires_android_decision",
          android,
          pendingUserAction: pending,
        };
      }

      if (state.userDecisions?.login === "no_account") {
        state.loginFeatures._loginDeclined = true;
        saveRunState(runDir, state);
      } else if (state.userDecisions?.login === "completed") {
        if (adbOk) {
          const probeCookies = checkProbeCookies(state.siteUrl);
          if (!probeCookies.ok || !hasProbeLoginEvidence(probeCookies.parsed)) {
            return fail("Android 真机或模拟器在线时，已完成登录状态必须来自 Probe /cookie-check。请重新运行登录流程，不要用 Browser Cookie 或口头确认绕过。");
          }
          state.loginFeatures._loginMethod = "probe";
        } else {
          const cookieFile = path.join(runDir, "cookies.json");
          const cookieShape = validateCookieFileShape(cookieFile);
          if (!cookieShape.ok) {
            return fail(`Browser Cookie 路径必须先保存有效 runs/<slug>/cookies.json 后才能记录登录完成: ${cookieShape.reason}`);
          }
          state.loginFeatures._loginMethod = "browser_mcp_cookies";
        }
        state.loginFeatures._loginVerified = true;
        saveRunState(runDir, state);
      } else {
        const message = [
          "站点需要登录态（enabledCookieJar / Authorization），但尚未完成登录。",
          "",
          adbOk
            ? "Android 真机或模拟器已在线，必须使用 Probe 原生登录："
            : "登录方式：",
          "",
          adbOk
            ? "步骤："
            : "",
          adbOk
            ? "1. 运行 node scripts/bsg.mjs android --run <dir>——由 Android 单入口启动 Probe 并打开登录页"
            : "",
          adbOk
            ? "2. 用户在手机/模拟器里输入账号密码并完成验证码/短信/扫码"
            : "",
          adbOk
            ? "3. 看到已登录状态后运行 node scripts/bsg.mjs android --run <dir> --login-completed"
            : "",
          adbOk
            ? "不要手工拼 adb、curl、login、validate 或 record-validation。"
            : "",
          adbOk
            ? "Browser MCP 登录不是当前默认路径；如需改用浏览器，必须先断开/声明 Android 真机或模拟器不可用，再按 Browser Cookie 路径继续。"
            : "Browser MCP 登录 — 打开登录页 → 完成登录 → browser_network_requests 提取 Cookie → 保存 runs/<slug>/cookies.json",
          "",
          "如果没有该站账号，回复「无账号」——书源标为 anonymous_candidate。",
        ].filter(Boolean).join("\n");
        const pending = setPendingUserAction(state, "login_required", "login_required", message, {
          blockingPhase: "assess",
          adbAvailable: adbOk,
          android,
        });
        saveRunState(runDir, state);
        return {
          ok: true,
          nextAction: "stop",
          requiredUserAction: "login_required",
          message,
          blockingPhase: "assess",
          reason: "login_required",
          adbAvailable: adbOk,
          android,
          pendingUserAction: pending,
        };
      }
    }

    if ((state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs || factsSuggestWebView(runDir) || bookSourceHasWebView(runDir, state)) && !checkAdb() && state.userDecisions?.androidDevice !== "unavailable") {
      const android = diagnoseAndroid();
      const message = [
        "评估发现站点需要 WebView/CSR 渲染正文，但未检测到可用 Android 真机或模拟器。",
        "",
        `当前 Android/adb 状态: ${android.state}。${android.message}`,
        "",
        "请确认：你是否有满足以下条件的 Android 真机或模拟器？",
        "  • Android 真机（已开启 USB 调试）或 Android 模拟器",
        "  • 真机通过 USB 数据线连接电脑；模拟器已启动并能被 adb 看到",
        "  • 电脑可运行 node scripts/bsg.mjs android --run <dir>（脚本会通过单入口处理 adb、Probe 和验证）",
        "",
        "如果有，请连接真机或启动模拟器并完成授权后，再运行 node scripts/bsg.mjs android --run <dir>。",
        "如果没有可用 Android 真机或模拟器，让用户明确确认后运行 node scripts/bsg.mjs android --run <dir> --no-device；后续正文验证由 record-validation 降级收敛，不能标 passed。",
      ].join("\n");
      const pending = setPendingUserAction(state, "android_device_needed", "webview_requires_android", message, {
        blockingPhase: "assess",
        android,
      });
      saveRunState(runDir, state);
      return {
        ok: true,
        nextAction: "stop",
        requiredUserAction: "android_device_needed",
        message,
        blockingPhase: "assess",
        reason: "webview_requires_android",
        android,
        pendingUserAction: pending,
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

    const officialRuleCheck = runOfficialRuleCheck(parsed, state);
    officialRuleCheck.sourceHash = sha256Text(sourceJson);
    writeRuleCheck(runDir, officialRuleCheck);
    if (officialRuleCheck.errors.length > 0) {
      return fail([
        "official-rule-pack 校验失败：",
        ...officialRuleCheck.errors.map((issue) => `- ${issue.ruleId}: ${issue.message}`),
      ].join("\n"));
    }

    const source = parsed[0];
    for (const key of ["header", "loginUrl", "exploreUrl", "bookSourceComment"]) {
      if (source[key] === "") {
        return fail(`book-source.json 中 "${key}" 为空字符串。可选字段应填有效值或删除。`);
      }
    }

    const missingSearch = [];
    if (!source.searchUrl || !String(source.searchUrl).trim()) missingSearch.push("searchUrl");
    for (const field of ["bookList", "name", "bookUrl"]) {
      const value = source.ruleSearch?.[field];
      if (!value || !String(value).trim()) missingSearch.push(`ruleSearch.${field}`);
    }
    if (missingSearch.length > 0) {
      return fail([
        "搜索入口不完整，不能进入 validate。",
        `缺失字段: ${missingSearch.join(", ")}`,
        "enabledExplore、排行榜、书库不能自动替代搜索。",
        "如果用户明确接受无搜索/入口不完整书源，必须先在 assess 阶段处理 entry risk 用户确认，并在 analysis.md 说明限制。",
      ].join("\n"));
    }

    const jsonStr = JSON.stringify(parsed);
    const hasWebView = jsonStr.includes('"webView":true') || jsonStr.includes("'webView':true");
    const hasWebJs = jsonStr.includes('"webJs"') || jsonStr.includes("'webJs'");
    if (hasWebView && !state.loginFeatures.hasWebView) state.loginFeatures.hasWebView = true;
    if (hasWebJs && !state.loginFeatures.hasWebJs) state.loginFeatures.hasWebJs = true;

    const structuralErrors = [];

    if ((state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs) && source.ruleToc?.chapterUrl) {
      const cu = source.ruleToc.chapterUrl;
      if (!cu.includes("webView") && !cu.includes("webview")) {
        structuralErrors.push(
          "ruleToc.chapterUrl 缺少 webView:true。CSR 站点必须把 webView 写在 chapterUrl 上（如 /book/{{$.id}},{\"webView\":true}），Legado 只在 chapterUrl 检查 webView 选项。"
        );
      }
    }

    const webViewFields = [];
    if (source.searchUrl && /webView|webview/i.test(source.searchUrl)) webViewFields.push("searchUrl");
    if (source.ruleBookInfo?.tocUrl && /webView|webview/i.test(source.ruleBookInfo.tocUrl)) webViewFields.push("ruleBookInfo.tocUrl");
    if (source.ruleSearch?.bookUrl && /webView|webview/i.test(source.ruleSearch.bookUrl)) webViewFields.push("ruleSearch.bookUrl");
    if (webViewFields.length > 0) {
      // noinspection JSUnresolvedReference
      structuralErrors.push(
        `webView:true 不应出现在 ${webViewFields.join(", ")} 上。WebView 只用于渲染 CSR 正文页面，JSON API 和静态 HTML 不需要 WebView。将 webView 移到 ruleToc.chapterUrl 上。`
      );
    }

    if ((state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs) && source.ruleContent?.webJs) {
      const wj = source.ruleContent.webJs;
      if (!/sleep|setTimeout|setInterval|retry|while\s*\(/.test(wj)) {
        structuralErrors.push(
          "ruleContent.webJs 缺少轮询等待逻辑（无 java.sleep / while / retry）。CSR 页面的 DOM 在 JS 执行后才渲染，webJs 必须循环等待元素出现。参考 examples/pattern-api-webview-auth/ 的 webJs 写法。"
        );
      }
    }

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
    delete state.phases.generate.repairContext;
    delete state.repairContext;
    saveRunState(runDir, state);
    return moveToNext(phase, state, runDir);
  }

  if (phase === "validate") {
    const correctiveAction = "advance 需要先完成 record-validation。运行 record-validation --status <状态> 记录验证结果后再 advance。";
    const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" record-validation --run ${runDir} --status <passed|failed|needs_app_review|validator_limitation|degraded>`;
    printHint(correctiveAction, nextCommand);
    return {
      ...fail("请先运行 record-validation 记录验证结果，再 advance 进入 deliver。"),
      correctiveAction,
      nextCommand,
    };
  }

  if (phase === "deliver") {
    return fail("当前已进入 deliver 阶段。请运行 deliver --run <run-dir> 完成交付；不要用 advance 代替 deliver。");
  }

  return fail(`未知阶段: ${phase}`);
}

export function moveToNext(fromPhase, state, runDir) {
  const nextIdx = PHASE_ORDER.indexOf(fromPhase) + 1;
  if (nextIdx >= PHASE_ORDER.length) {
    return {
      ok: true,
      message: "所有阶段已完成。运行 deliver。",
      nextAction: "deliver",
      ...phaseHints(runDir, "deliver"),
    };
  }
  const next = PHASE_ORDER[nextIdx];
  state.phases[next].status = "in_progress";
  saveRunState(runDir, state);

  let authReminder = null;
  if (next === "generate" || next === "validate") {
    const authInfo = detectAuthFromAnalysis(runDir);
    if (authInfo.found) {
      const missing = Object.entries(authInfo.flags)
        .filter(([k, v]) => v && !state.loginFeatures[k])
        .map(([k]) => k);
      if (missing.length > 0) {
        authReminder = `⚠️ analysis.md 提到 auth/登录特征但 loginFeatures 未设: ${missing.join(", ")}。请在生成书源前运行: node scripts/bsg.mjs set-login-features --run {dir}`;
      }
    }
  }

  let validateMessage = `运行 bsg.mjs validate --run "${runDir}" (第 ${(state.phases.validate.attempts || 0) + 1} 次)。完成后运行 record-validation。`;
  let validateWebViewInstruction = null;

  if (state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs) {
    validateWebViewInstruction = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "⚠️  WebView/CSR 正文 — 必须用 Android Probe",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "1. validator-start（窗口必须可见）",
      "2. node scripts/bsg.mjs android --run <dir>",
      "3. 按 android 命令返回的 requiredUserAction 或 nextCommand 继续",
      "4. Android 不可用时: 先让用户确认 --no-device，再由 record-validation 降级收敛",
      "",
      "禁止跳过 Android Probe 直接用 mode=http 标 passed！",
      "",
      "Android Probe 验证失败时的诊断顺序（不要直接说「已知限制」就跳过）：",
      "  a. 读 validator-report.json → steps[content].error 看具体错误",
      "  b. 超时 → 增加 webJs 等待时间（java.sleep(3000)）",
      "  c. 空内容 → webJs 选择器不对，用 Browser MCP snapshot 重新确认 DOM 结构",
      "  d. 401/403 → 需要 Cookie，提取并注入（见下方 Cookie 注入流程）",
      "  e. JS 报错 → 页面可能依赖特定 WebView API，检查兼容性",
      "  f. 以上都试过仍失败 → 保留真实报告，交给 record-validation 收敛",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");
    validateMessage = "🔴 WebView/CSR 正文 — 必须先尝试 Android Probe。\n" + validateWebViewInstruction;
  }

  const hasLoginFeatures = Object.values(state.loginFeatures).some((b) => b === true);
  if (hasLoginFeatures && state.loginFeatures.hasEnabledCookieJar) {
    const loggedInViaProbe = state.loginFeatures._loginMethod === "probe";
    const cookieFlow = [
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🔑 登录态验证 — 必须先注入 Cookie",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      loggedInViaProbe
        ? "用户已通过 Android Probe 登录 → validate 阶段必须用 mode=android，不要退回 HTTP+Cookie。"
        : "Android/Probe 不可用时，必须先让用户完成 Browser 登录并提取 Cookie 注入 validator，否则正文鉴权失败。",
      "",
      loggedInViaProbe
        ? "1. 运行 node scripts/bsg.mjs android --run <dir>"
        : "1. browser_network_requests 找到 API 请求头的 Cookie 或 Authorization",
      loggedInViaProbe
        ? "2. 按 android 命令返回的 requiredUserAction 或 nextCommand 继续"
        : "2. 保存为 runs/<slug>/cookies.json: {\"www.example.com\": \"full_cookie_string\"}",
      loggedInViaProbe
        ? "3. 不要退回 HTTP+Cookie 或手工拼 validate/record-validation"
        : "3. bsg.mjs validate 自动检测 cookies.json 并注入",
      "",
      "未注入 Cookie 的验证结果不能标 passed，只能标 anonymous_candidate。",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");
    validateMessage += cookieFlow;
  }

  const actions = {
    assess:  { nextAction: "record_assessment", message: "写 assessment.md 到 runs/<slug>/ 后运行 record-assessment。record-assessment 通过前不要展示评估摘要或 advance。" },
    analyze: { nextAction: "write_analysis",   message: "按 search→detail→toc→content 顺序分析 4 条链路。双样本。完成后 advance。" },
    generate:{
      nextAction: "generate_json",
      message: "生成 book-source.json 到 outputs/<slug>/。完成后 advance 会执行 official-rule-pack 校验并写 rule-check.json。若站点有登录/session/token/cookie 依赖，必须配置 enabledCookieJar + header。" + (authReminder ? "\n" + authReminder : ""),
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
    requiredUserAction: null,
    ...phaseHints(runDir, next),
  };
}
