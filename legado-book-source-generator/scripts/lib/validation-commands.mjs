import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  fail, parseArg, fileExists, saveRunState, loadAndVerify,
  blockForPendingUserAction,
} from "./state.mjs";
import {
  PHASE_ORDER, currentPhaseIndex, resetPhasesFrom, checkAdb,
  cmdDeliverCheck,
} from "./phase-engine.mjs";
import {
  loadBookSource, validateBookSourceStructure, validateCookieFileShape,
  ensureAssessmentFactsFresh, ensureRuleCheckSourceFresh,
  reportHardRuleError, reportUsedAndroidMode, reportUsedAndroidWebView,
  reportHasLoginSessionEvidence, writeCapabilityMatrix, writeValidatorSummary,
} from "./facts.mjs";

export function cmdRecordValidation(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs record-validation --run {dir} --status <status> [--report <file>]");

  const statusIdx = args.indexOf("--status");
  if (statusIdx < 0) return fail("缺少 --status 参数 (passed|failed|needs_app_review|validator_limitation|degraded)");
  const status = args[statusIdx + 1];
  if (!status) return fail("--status 需要值");

  const validStatuses = ["passed", "failed", "needs_app_review", "validator_limitation", "degraded"];
  if (!validStatuses.includes(status)) {
    return fail(`无效状态: ${status}。可选值: ${validStatuses.join(", ")}`);
  }

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const pendingBlock = blockForPendingUserAction(state);
  if (pendingBlock) {
    return fail(`仍有待用户确认动作: ${pendingBlock.requiredUserAction}。请先运行 resolve-user-action。`);
  }

  const current = PHASE_ORDER[currentPhaseIndex(state)];
  if (current !== "validate" || state.phases.validate.status !== "in_progress") {
    return fail("record-validation 只能在 validate 阶段 in_progress 时运行。请先按状态机完成 assess/analyze/generate 并进入 validate。");
  }

  const reportArg = parseArg(args, "--report");
  const reportPathForMode = path.join(runDir, "validator-report.json");
  if (reportArg) {
    const reportSrc = path.resolve(reportArg);
    if (!fileExists(reportSrc)) {
      return fail(`--report 指定的 validator-report.json 不存在: ${reportSrc}`);
    }
    try {
      JSON.parse(fs.readFileSync(reportSrc, "utf-8"));
      if (path.resolve(reportSrc) !== path.resolve(reportPathForMode)) {
        fs.copyFileSync(reportSrc, reportPathForMode);
      }
    } catch (e) {
      return fail(`validator-report.json 不是合法 JSON: ${e.message}`);
    }
  }

  const loadedSource = loadBookSource(runDir, state);
  if (!loadedSource.ok) return fail(loadedSource.error);
  const sourceStructureError = validateBookSourceStructure(loadedSource.sources);
  if (sourceStructureError) return fail(sourceStructureError);
  const factsFreshError = ensureAssessmentFactsFresh(state, runDir);
  if (factsFreshError) {
    resetPhasesFrom(state, "assess");
    saveRunState(runDir, state);
    return fail(`${factsFreshError} 已将状态机回退到 assess，请重新运行 record-assessment。`);
  }
  const sourceFreshError = ensureRuleCheckSourceFresh(runDir, loadedSource.bookSourcePath);
  if (sourceFreshError) {
    resetPhasesFrom(state, "generate");
    saveRunState(runDir, state);
    return fail(`${sourceFreshError} 已将状态机回退到 generate，请重新运行 advance 完成规则校验。`);
  }

  const v = state.phases.validate;
  v.attempts += 1;
  v.lastStatus = status;

  let hasLoginFeatures = Object.values(state.loginFeatures).some((b) => b === true);
  let shouldRetry = false;
  let finalStatus = null;
  let nextAction = "deliver";
  let cookieWarning = null;
  let androidWarning = null;
  let convergenceBlock = null;
  let hardRuleBlock = null;

  if (["passed", "needs_app_review", "validator_limitation", "degraded"].includes(status)) {
    const hardRuleError = reportHardRuleError(reportPathForMode);
    if (hardRuleError) {
      hardRuleBlock = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⛔ validator 报告包含明确规则错误",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        hardRuleError,
        "请修正书源规则并重新验证，不要把规则错误标成 needs_app_review 或 validator_limitation。",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");
    }
  }

  if (hardRuleBlock) {
    v.attempts -= 1;
    v.lastStatus = "failed";
    saveRunState(runDir, state);
    writeCapabilityMatrix(runDir, reportPathForMode, "blocked:hard_rule_error");
    writeValidatorSummary(runDir, status, "blocked:hard_rule_error", reportPathForMode);
    return {
      ok: true,
      status: "blocked",
      blockedBy: "hard_rule_error",
      shouldRetry: true,
      nextAction: "fix_rules_and_retry",
      message: hardRuleBlock,
    };
  }

  if (status === "passed") {
    if (fileExists(reportPathForMode)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPathForMode, "utf-8"));
        const contentSteps = (report.steps || []).filter((s) => s.phase === "content");
        const csrShellByCode = contentSteps.some((s) => s.errorCode === "CONTENT_IS_CSR_SHELL");
        const preview = report.summary?.contentPreview || "";
        const csrShells = [
          "import.meta.url", "__nuxt", "__vite", "vite_is_modern",
          "window.__NUXT__", "<div id=\"__nuxt\"></div>", "<div id=\"app\"></div>",
          "id=\"__next\"", "_next/static", "webpackJsonp",
        ];
        const csrShellByString = csrShells.some((s) => preview.includes(s));

        if (csrShellByCode || csrShellByString) {
          const bookSourcePath2 = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
          if (fileExists(bookSourcePath2)) {
            try {
              const bs = JSON.parse(fs.readFileSync(bookSourcePath2, "utf-8"));
              const source = Array.isArray(bs) ? bs[0] : bs;
              const jsonStr = JSON.stringify(source);
              const hasWVonChapter = /chapterUrl[^}]*"webView"\s*:\s*true/i.test(jsonStr);
              const hasWVonContent = source.ruleContent?.webView === true;
              const detectionSource = csrShellByCode
                ? "validator errorCode: CONTENT_IS_CSR_SHELL"
                : `contentPreview 包含 ${csrShells.filter((s) => preview.includes(s)).join(" / ")}（字符串 fallback）`;
              const csrWarning = [
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
                "⛔ 假阳性检测 — content 返回了 CSR 空壳",
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
                `检测方式: ${detectionSource}，这是前端框架 JS 壳，不是正文。`,
                hasWVonChapter
                  ? "✅ chapterUrl 已配 webView:true。可能是 Android Probe 超时，检查 webJs 是否需要轮询等待。"
                  : hasWVonContent
                    ? "⚠️  ruleContent 有 webView 但 chapterUrl 没有！Legado 只有 chapterUrl 上的 webView 才会触发 WebView 加载。修复 chapterUrl 加上 ,{\"webView\":true}。"
                    : "❌ 书源未配置 WebView。CSR 页面需要 webView:true 在 chapterUrl 上，并在 webJs 中用轮询等待 DOM 渲染。",
                "修完后重新验证，不要标 passed。",
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
              ].join("\n");
              v.attempts -= 1;
              v.lastStatus = "failed";
              state.loginFeatures.hasWebView = true;
              saveRunState(runDir, state);
              writeCapabilityMatrix(runDir, reportPathForMode, "blocked:csr_shell_detected");
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

  if (state.loginFeatures._loginMethod === "probe" && !reportUsedAndroidMode(reportPathForMode)) {
    if (checkAdb()) {
      androidWarning = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⛔ Probe 登录后未用 Android 验证",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "本轮登录态来自 Android Probe，但 validator-report.json 不是 mode=android。",
        "这会把手机端登录环境降级成 HTTP+Cookie 验证，不能代表阅读 App/WebView 行为。",
        "立即执行: validator/setup-android-probe.bat → validate-with-validator.mjs ... android → record-validation。",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");
    } else if (state.adbDetected) {
      androidWarning = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⚠️  Probe 登录后 Android 设备已断开",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "本轮登录态来自 Android Probe，但现在 adb 找不到设备，不能退回 HTTP+Cookie 验证。",
        "请重新插拔 USB 并在手机上确认 USB 调试授权。",
        "然后运行: validator/setup-android-probe.bat → validate-with-validator.mjs ... android → record-validation。",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");
    }
  }

  if (state.loginFeatures._loginMethod === "probe" && reportUsedAndroidMode(reportPathForMode) && !reportHasLoginSessionEvidence(reportPathForMode)) {
    v.attempts -= 1;
    saveRunState(runDir, state);
    writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_probe_cookie_not_used");
    writeValidatorSummary(runDir, status, "blocked:android_probe_cookie_not_used", reportPathForMode);
    return {
      ok: true,
      status: "blocked",
      blockedBy: "android_probe_cookie_not_used",
      shouldRetry: true,
      nextAction: "rerun_android_validation_with_probe_cookie",
      message: [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⛔ Probe 登录态没有进入 validator 报告",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "本轮登录已记录为 Android Probe，但 validator-report.json 仍是匿名会话：未看到非 anonymous sessionMode，也未看到 Cookie/Authorization 请求头。",
        "这说明只是完成了手机登录动作，验证请求没有使用该登录态。请确认 /cookie-check 有 Cookie 后，重新用 Android mode 验证。",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n"),
    };
  }

  const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (fileExists(bookSourcePath)) {
    try {
      const bs = JSON.parse(fs.readFileSync(bookSourcePath, "utf-8"));
      const source = Array.isArray(bs) ? bs[0] : bs;
      const jsonStr = JSON.stringify(source);
      const hasWV = /\\?["']webView\\?["']\s*:\s*true/.test(jsonStr);
      const hasWJ = source.ruleContent?.webJs;
      if (hasWV || hasWJ) {
        state.loginFeatures.hasWebView = hasWV;
        state.loginFeatures.hasWebJs = !!hasWJ;
        hasLoginFeatures = Object.values(state.loginFeatures).some((b) => b === true);
        const adbOk = checkAdb();
        const androidWasUsed = reportUsedAndroidMode(reportPathForMode);
        const androidWebViewWasUsed = reportUsedAndroidWebView(reportPathForMode);

        if (adbOk && !androidWasUsed) {
          androidWarning = [
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "⛔ WebView 未验证 — Android 设备已连接但未使用",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "adb 检测到设备，但你用了 mode=http 验证 WebView 正文。",
            "立即执行: validator/setup-android-probe.bat → 重新验证 → record-validation。",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          ].join("\n");
        } else if (androidWasUsed && !androidWebViewWasUsed) {
          androidWarning = [
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "⛔ Android mode 没有实际 WebView 渲染证据",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "validator-report.json 标了 mode=android，但 content 阶段没有 response.rendered.html / screenshot.png / webViewHtmlPreview / webViewScreenshotBase64。",
            "这只能说明 Probe/Android 通道被调用过，不能证明阅读 App WebView 渲染过正文。",
            "重新用 Android Probe 验证正文页，并开启 debugDir 产物；如果站点是纯 SSR 且不需要 WebView，应移除 webView:true / webJs 后重跑。",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          ].join("\n");
        } else if (state.adbDetected) {
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

  if (androidWarning) {
    const actuallyUsedAndroid = reportUsedAndroidMode(reportPathForMode);
    if (!actuallyUsedAndroid) {
      if (checkAdb()) {
        v.attempts -= 1;
        saveRunState(runDir, state);
        writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_probe_not_used");
        return { ok: true, status: "blocked", blockedBy: "android_probe_not_used", shouldRetry: true, nextAction: "setup_android_probe_and_retry", message: androidWarning };
      }
      if (state.adbDetected) {
        v.attempts -= 1;
        saveRunState(runDir, state);
        writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_device_disconnected");
        return { ok: true, status: "blocked", blockedBy: "android_device_disconnected", shouldRetry: true, nextAction: "reconnect_device_and_retry", message: androidWarning };
      }
    } else if (!reportUsedAndroidWebView(reportPathForMode) && (state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs)) {
      v.attempts -= 1;
      saveRunState(runDir, state);
      writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_webview_not_used");
      writeValidatorSummary(runDir, status, "blocked:android_webview_not_used", reportPathForMode);
      return { ok: true, status: "blocked", blockedBy: "android_webview_not_used", shouldRetry: true, nextAction: "rerun_android_webview_validation", message: androidWarning };
    }
  }
  if (androidWarning) {
    state._androidWarning = androidWarning;
  }

  if (state.loginFeatures.hasEnabledCookieJar && (status === "failed" || status === "needs_app_review")) {
    const cookieFile = path.join(runDir, "cookies.json");
    const cookieShape = validateCookieFileShape(cookieFile);
    if (!cookieShape.ok) {
      cookieWarning = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⛔ Cookie 未注入 — 拒绝通过",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        cookieShape.reason === "missing"
          ? "enabledCookieJar=true 但 runs/<slug>/cookies.json 不存在。"
          : cookieShape.reason,
        "Android/Probe 不可用时，必须先让用户完成 Browser 登录并提取 Cookie 注入 validator：",
        "1. browser_network_requests 找 API 请求的 Cookie/Authorization header",
        "2. 保存 {\"www.example.com\": \"cookie_string\"} 到 runs/<slug>/cookies.json",
        "3. 重新验证: validate-with-validator.mjs ... --cookie=runs/<slug>/cookies.json",
        "4. 再次运行 record-validation",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");
    }
  }

  if (cookieWarning) {
    v.attempts -= 1;
    saveRunState(runDir, state);
    writeCapabilityMatrix(runDir, reportPathForMode, "blocked:cookie_not_injected");
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
    let errorSig = status;
    if (fileExists(reportPathForMode)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPathForMode, "utf-8"));
        const failedStep = (report.steps || []).find((s) => s.status === "error");
        if (failedStep) {
          const phase = failedStep.phase || "unknown";
          const eCode = failedStep.errorCode || (failedStep.error || "unknown").slice(0, 40);
          const field = failedStep.failedField || "";
          const reqUrl = failedStep.request?.url || "";
          const reqUrlHash = reqUrl
            ? crypto.createHash("sha256").update(reqUrl).digest().toString("hex").slice(0, 12)
            : "no-url";
          let chapterUrlHash = "";
          if (phase === "content") {
            const contentSteps = (report.steps || []).filter((s) => s.phase === "content");
            if (contentSteps.length >= 2) {
              const url1 = contentSteps[0].request?.url || "";
              const url2 = contentSteps[1].request?.url || "";
              if (url1 !== url2) {
                chapterUrlHash = "|ch:" + crypto.createHash("sha256").update(url1 + url2).digest().toString("hex").slice(0, 8);
              }
            }
          }
          errorSig = `${phase}|${eCode}|${field}|${reqUrlHash}${chapterUrlHash}`;
        }
      } catch { /* keep raw status as sig */ }
    }

    if (errorSig === v.lastError) {
      v.consecutiveSame = (v.consecutiveSame || 0) + 1;
    } else {
      v.consecutiveSame = 1;
    }
    v.lastError = errorSig;

    if (v.consecutiveSame >= 5) {
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

  v.recordedAt = new Date().toISOString();
  writeCapabilityMatrix(runDir, reportPathForMode, finalStatus);
  writeValidatorSummary(runDir, status, finalStatus, reportPathForMode);
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

export function cmdDeliver(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs deliver --run <run-dir>");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  return cmdDeliverCheck(state, runDir);
}
