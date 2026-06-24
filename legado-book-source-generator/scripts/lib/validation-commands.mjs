import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  fail, parseArg, fileExists, saveRunState, loadAndVerify,
  blockForPendingUserAction, printHint, setPendingUserAction, fileSha256,
} from "./state.mjs";
import {
  resetPhasesFrom, checkAdb,
  cmdDeliverCheck,
} from "./phase-engine.mjs";
import { diagnoseAndroid } from "./environment.mjs";
import {
  loadBookSource, validateBookSourceStructure, validateCookieFileShape,
  ensureAssessmentFactsFresh, ensureRuleCheckSourceFresh,
  reportHardRuleError, reportUsedAndroidWebView,
  reportUsedAndroidProbe, reportHasAndroidWebViewContentEvidence, reportHasLoginSessionEvidence,
  reportAcceptanceGateError, writeCapabilityMatrix, writeValidatorSummary,
} from "./facts.mjs";

function validateReportProvenance(reportPath, runDir, bookSourcePath) {
  if (!fileExists(reportPath)) {
    return { ok: false, error: "validator-report.json 不存在。必须先运行 validate-with-validator.mjs 并让它写入当前 run 目录。" };
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
  } catch (e) {
    return { ok: false, error: `validator-report.json 不是合法 JSON: ${e.message}` };
  }

  if (report._generatedBy !== "validate-with-validator.mjs") {
    return { ok: false, error: "validator-report.json 来源无效：必须由 validate-with-validator.mjs 生成，不能手写或用 node -e 拼接。" };
  }
  if (report._schemaVersion !== "1.0") {
    return { ok: false, error: "validator-report.json 缺少有效 _schemaVersion。请重新运行当前版本 validate-with-validator.mjs。" };
  }
  if (report._runDir && path.resolve(report._runDir) !== path.resolve(runDir)) {
    return { ok: false, error: "validator-report.json 的 _runDir 与当前 run 目录不匹配。请在当前 run 目录重新运行 validate-with-validator.mjs。" };
  }
  const currentSourceHash = fileSha256(bookSourcePath);
  if (!report._sourceHash || report._sourceHash !== currentSourceHash) {
    return { ok: false, error: "validator-report.json 的 _sourceHash 与当前 book-source.json 不匹配。请重新运行 validate-with-validator.mjs，不能复用旧报告。" };
  }
  return { ok: true, report };
}

function firstFailedStep(report) {
  return (report?.steps || []).find((step) => ["error", "failed", "blocked"].includes(step?.status)) || null;
}

function reportUsedAndroidMode(report) {
  if (report?.mode === "android") return true;
  return (report?.steps || []).some((step) => step?.mode === "android");
}

function isVipLockFailure(report) {
  const failedStep = firstFailedStep(report);
  if (!failedStep) return false;
  const text = [
    failedStep.errorCode,
    failedStep.error,
    failedStep.message,
    report?.reason,
  ].filter(Boolean).join(" ");
  return /CONTENT_IS_VIP_LOCK_PAGE|VIP|付费|订阅|会员|需要登录|需登录|paid|subscribe/i.test(text);
}

// 反爬触发检测：search 类端点被弹到人机验证 / Cloudflare / 验证码页。
// 这是 server-side 站点行为；任何客户端(curl/validator/Probe/浏览器)请求同一 IP 都计入累积。
// 自动重跑 validator / 换 mode / 换 keyword 都不能绕过，反而会累积成 IP 风控。
function isAntiBotTriggered(report) {
  if (!report) return false;
  const steps = report.steps || [];
  // 反爬类 errorCode：验证器把它们和 needsAppReview: true 一起标在 step 上。
  // search/toc/detail 命中任意一个都说明该链路被 server-side 反爬墙住，任何客户端重试都计入 IP 累积。
  const antiBotCodes = new Set(["APP_REVIEW_REQUIRED", "HTTP_BLOCKED", "SEARCH_EMPTY"]);
  for (const step of steps) {
    const code = step?.errorCode;
    const finalUrl = String(step?.response?.url || step?.request?.url || "");
    const hasVerifyUrl = /\/man_machine_verify|\/signup\/(login|man_machine)|challenges\.cloudflare\.com|turnstile/i.test(finalUrl);
    if (code === "APP_REVIEW_REQUIRED") return true;
    if (hasVerifyUrl) return true;
    // HTTP_BLOCKED + needsAppReview 通常是被反爬弹到 verify 页 (303/非200 跟随到验证页)
    if (code === "HTTP_BLOCKED" && step?.needsAppReview === true) return true;
    if (step?.needsAppReview === true) {
      const reason = String(step?.reviewReason || step?.error || step?.message || "");
      if (/man_machine|人机验证|安全验证|滑块验证|cloudflare|turnstile|just a moment/i.test(reason)) return true;
    }
  }
  return false;
}

// 按卡点指路：不同 blocker 该读不同文档段，不是永远指 validation-policy + validator-integration 这两篇。
// 弱模型只会读 readNext 列表的前 1-2 项，所以这里把最相关的放最前。
const READ_NEXT_FOR_BLOCKER = {
  anti_bot_triggered: ["references/failure-diagnosis.md", "references/policies.md"],
  content_vip_lock: ["references/validation-policy.md", "references/android-probe-guide.md"],
  hard_rule_error: ["references/official-rule-pack.json", "references/legado-json-structure.md"],
  csr_shell_detected: ["references/webview-behavior-matrix.md", "references/android-probe-guide.md"],
  android_probe_not_used: ["references/android-probe-guide.md", "references/validator-integration.md"],
  android_probe_cookie_not_used: ["references/android-probe-guide.md"],
  android_webview_not_used: ["references/android-probe-guide.md", "references/webview-behavior-matrix.md"],
  android_webview_content_not_verified: ["references/android-probe-guide.md", "references/failure-diagnosis.md"],
  android_device_disconnected: ["references/android-probe-guide.md"],
  android_device_needed: ["references/android-probe-guide.md", "references/policies.md"],
  android_final_authority_not_used: ["references/android-probe-guide.md", "references/validation-policy.md"],
  cookie_not_injected: ["references/android-probe-guide.md", "references/policies.md"],
  search_result_empty: ["references/analysis-workflow.md", "references/failure-diagnosis.md"],
  search_book_name_empty: ["references/legado-json-structure.md", "references/failure-diagnosis.md"],
  toc_chapter_count_too_low: ["references/analysis-workflow.md"],
  toc_trial_chapters_only: ["references/policies.md", "references/android-probe-guide.md"],
  content_length_too_short: ["references/failure-diagnosis.md"],
  content_repeated_noise: ["references/failure-diagnosis.md"],
  content_page_chrome: ["references/failure-diagnosis.md"],
};
function readNextForBlocker(blockedBy) {
  return READ_NEXT_FOR_BLOCKER[blockedBy] || ["references/validation-policy.md", "references/validator-integration.md"];
}

function validationErrorSignature(report, status) {
  const failedStep = firstFailedStep(report);
  if (!failedStep) return status;

  const phase = failedStep.phase || "unknown";
  const eCode = failedStep.errorCode || (failedStep.error || "unknown").slice(0, 40);
  const field = failedStep.failedField || "";
  const reqUrl = failedStep.request?.url || "";
  const reqUrlHash = reqUrl
    ? crypto.createHash("sha256").update(reqUrl).digest().toString("hex").slice(0, 12)
    : "no-url";
  let chapterUrlHash = "";
  if (phase === "content") {
    const contentSteps = (report.steps || []).filter((step) => step.phase === "content");
    if (contentSteps.length >= 2) {
      const url1 = contentSteps[0].request?.url || "";
      const url2 = contentSteps[1].request?.url || "";
      if (url1 !== url2) {
        chapterUrlHash = "|ch:" + crypto.createHash("sha256").update(url1 + url2).digest().toString("hex").slice(0, 8);
      }
    }
  }
  return `${phase}|${eCode}|${field}|${reqUrlHash}${chapterUrlHash}`;
}

function buildRepairContext(report, status, reason, sourceHash) {
  const failedStep = firstFailedStep(report);
  return {
    reason,
    validatorStatus: status,
    sourceHash,
    phase: failedStep?.phase || null,
    errorCode: failedStep?.errorCode || null,
    failedField: failedStep?.failedField || null,
    message: failedStep?.error || failedStep?.message || null,
    requestUrl: failedStep?.request?.url || null,
    recordedAt: new Date().toISOString(),
  };
}

function enterGenerateRepair(state, repairContext) {
  state.phases.generate.status = "in_progress";
  delete state.phases.generate.completedAt;
  state.phases.generate.repairContext = repairContext;

  state.phases.validate.status = "pending";
  delete state.phases.validate.completedAt;

  state.phases.deliver.status = "pending";
  delete state.phases.deliver.completedAt;

  state.repairContext = repairContext;
}

function androidProbeNotUsedBlock(runDir, state, message) {
  const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" android --run "${runDir}"`;
  const nextStep = `下一步默认运行: ${nextCommand}，按它返回的 requiredUserAction 或 nextCommand 继续；底层诊断只用于定位环境问题，最终仍要回到 android / record-validation 收敛。`;
  const correctiveAction = [
    "禁止 deliver，禁止改记 needs_app_review，禁止退回 HTTP 验证。",
    "当前书源含 webView:true 或 webJs，且检测到 Android 真机或模拟器；必须使用 Android Probe 产生验证证据。",
    nextStep,
  ].join("\n");
  return {
    ok: true,
    status: "blocked",
    blockedBy: "android_probe_not_used",
    readNext: readNextForBlocker("android_probe_not_used"),
    shouldRetry: true,
    nextAction: "setup_android_probe_and_retry",
    message: `${message}\n${correctiveAction}`,
    correctiveAction,
    forbiddenActions: ["deliver", "validate_http", "record_needs_app_review", "record_passed"],
    nextCommand,
  };
}

export function cmdRecordValidation(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" record-validation --run {dir} --status <status>");

  const statusIdx = args.indexOf("--status");
  if (statusIdx < 0) return fail("缺少 --status 参数 (passed|failed|needs_app_review|validator_limitation|degraded)");
  const status = args[statusIdx + 1];
  if (!status) return fail("--status 需要值");

  const validStatuses = ["passed", "failed", "needs_app_review", "validator_limitation", "degraded"];
  if (!validStatuses.includes(status)) {
    return fail(`无效状态: ${status}。可选值: ${validStatuses.join(", ")}`);
  }

  const { state, error } = loadAndVerify(runDir);
  if (error) {
    const correctiveAction = "指定的 --run 目录无效或 run-state.json 不可用。请确认 run 目录来自 bsg.mjs init 输出；如果还没有 run，请先运行 init。";
    const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" init <site-url> --cwd <工作目录>`;
    printHint(correctiveAction, nextCommand);
    return { ...fail(error), correctiveAction, nextCommand };
  }

  const pendingBlock = blockForPendingUserAction(state);
  if (pendingBlock) {
    return fail(`仍有待用户确认动作: ${pendingBlock.requiredUserAction}。请先运行 resolve-user-action。`);
  }

  const reportPathForMode = path.join(runDir, "validator-report.json");
  if (args.includes("--report")) {
    return fail("record-validation 不再接受 --report。必须运行 validate-with-validator.mjs，让脚本把 validator-report.json 写入当前 run 目录。");
  }

  const loadedSource = loadBookSource(runDir, state);
  if (!loadedSource.ok) return fail(loadedSource.error);
  const sourceStructureError = validateBookSourceStructure(loadedSource.sources);
  if (sourceStructureError) return fail(sourceStructureError);
  const factsFreshError = ensureAssessmentFactsFresh(state, runDir);
  if (factsFreshError) {
    resetPhasesFrom(state, "assess");
    saveRunState(runDir, state);
    const correctiveAction = "site-facts.json 发生变化，状态机已回退到 assess。重新运行 record-assessment 确认事实后再继续。";
    const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" record-assessment --run ${runDir}`;
    printHint(correctiveAction, nextCommand);
    return {
      ...fail(`${factsFreshError} 已将状态机回退到 assess，请重新运行 record-assessment。`),
      correctiveAction,
      nextCommand,
    };
  }
  const sourceFreshError = ensureRuleCheckSourceFresh(runDir, loadedSource.bookSourcePath);
  if (sourceFreshError) {
    enterGenerateRepair(state, {
      reason: "source_changed_during_validate",
      validatorStatus: "not_recorded",
      sourceHash: fileSha256(loadedSource.bookSourcePath),
      phase: null,
      errorCode: "SOURCE_CHANGED_AFTER_RULE_CHECK",
      failedField: "book-source.json",
      message: sourceFreshError,
      requestUrl: null,
      recordedAt: new Date().toISOString(),
    });
    saveRunState(runDir, state);
    const correctiveAction = "当前 validator-report.json 已不对应最新 book-source.json，不能复用旧报告继续记录或交付。已回到 generate / 规则审计语义；修正书源后重新通过 rule-check，再重跑 validator。";
    const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" run --run ${runDir}`;
    printHint(correctiveAction, nextCommand);
    return {
      ...fail(`${sourceFreshError} 已回到 generate / 规则审计语义，请重新通过 rule-check 后再验证。`),
      correctiveAction,
      nextCommand,
    };
  }
  const reportProvenance = validateReportProvenance(reportPathForMode, runDir, loadedSource.bookSourcePath);
  if (!reportProvenance.ok) return fail(reportProvenance.error);
  const report = reportProvenance.report;
  if (report.status && report.status !== status) {
    return fail(`--status ${status} 与 validator-report.json status ${report.status} 不一致。必须使用 validate 返回的 nextCommand 记录真实状态，不能把 failed 改写成 degraded / needs_app_review。`);
  }

  const v = state.phases.validate || (state.phases.validate = { status: "pending", attempts: 0, lastStatus: null, lastError: "", consecutiveSame: 0 });
  if (v.status === "pending") v.status = "in_progress";
  v.attempts = Number(v.attempts || 0) + 1;
  v.lastStatus = status;

  let hasLoginFeatures = Object.values(state.loginFeatures).some((b) => b === true);
  let shouldRetry = false;
  let finalStatus = null;
  let nextAction = "deliver";
  let cookieWarning = null;
  let androidWarning = null;
  let webViewAndroidUnavailable = false;
  let convergenceBlock = null;
  let hardRuleBlock = null;
  let warningBy = null;
  let validationWarning = null;

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
    enterGenerateRepair(state, buildRepairContext(report, status, "hard_rule_error", fileSha256(loadedSource.bookSourcePath)));
    saveRunState(runDir, state);
    writeCapabilityMatrix(runDir, reportPathForMode, "blocked:hard_rule_error");
    writeValidatorSummary(runDir, status, "blocked:hard_rule_error", reportPathForMode);
    const correctiveAction = "validator 报告包含明确规则错误。已回到 generate / 规则审计语义；修正书源规则后重新通过 rule-check，再重跑 validator。不要把规则错误标成 needs_app_review 或 validator_limitation。";
    const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" run --run ${runDir}`;
    printHint(correctiveAction, nextCommand);
    return {
      ok: true,
      status: "blocked",
      blockedBy: "hard_rule_error",
      readNext: readNextForBlocker("hard_rule_error"),
      shouldRetry: true,
      nextAction: "repair_in_generate",
      repairContext: state.repairContext,
      message: hardRuleBlock,
      correctiveAction,
      nextCommand,
    };
  }

  if (["passed", "needs_app_review", "validator_limitation", "degraded"].includes(status)) {
    const acceptanceError = reportAcceptanceGateError(reportPathForMode);
    const confirmedSmallToc = (acceptanceError?.blockedBy === "toc_chapter_count_too_low" || acceptanceError?.blockedBy === "toc_trial_chapters_only")
      && state.userDecisions?.tocChapterCount === "confirmed_small_sample";
    if (acceptanceError && !confirmedSmallToc) {
      v.attempts -= 1;
      v.lastStatus = "failed";
      const finalBlocked = `blocked:${acceptanceError.phase}:${acceptanceError.blockedBy}`;
      const isShortTocFamily = acceptanceError.blockedBy === "toc_chapter_count_too_low"
        || acceptanceError.blockedBy === "toc_trial_chapters_only";
      const guidance = acceptanceError.blockedBy === "toc_chapter_count_too_low"
        ? "如果这是新书、短篇或样本书导致的短目录，请让用户确认样本语义后运行 resolve-user-action --action toc_chapter_count_confirmed；否则修 ruleToc 后重跑 validator。"
        : acceptanceError.blockedBy === "toc_trial_chapters_only"
        ? "这是站点匿名试读策略（目录里有 signup/login?redirect=），不是 ruleToc 抓得少。让用户在浏览器/Probe 登录后从主页正常导航到目录页，让 cookie 落到 CookieStore 后重跑 validator；如果用户接受按试读交付（仅前几章可读），运行 resolve-user-action --action toc_chapter_count_confirmed。"
        : "这类问题不能改写成可交付结论，也不能靠经验修完直接交付；必须修规则并重新运行 validator。";
      const message = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⛔ validator 成功结论缺少阅读语义证据",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        acceptanceError.message,
        guidance,
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");
      let pending = null;
      if (isShortTocFamily) {
        pending = setPendingUserAction(state, "toc_sample_review", acceptanceError.blockedBy, message, {
          blockingPhase: "validate",
          blockedBy: acceptanceError.blockedBy,
        });
      }
      if (!pending) {
        enterGenerateRepair(state, {
          reason: acceptanceError.blockedBy,
          validatorStatus: status,
          sourceHash: fileSha256(loadedSource.bookSourcePath),
          phase: acceptanceError.phase,
          errorCode: acceptanceError.blockedBy,
          failedField: null,
          message: acceptanceError.message,
          requestUrl: null,
          recordedAt: new Date().toISOString(),
        });
      }
      saveRunState(runDir, state);
      writeCapabilityMatrix(runDir, reportPathForMode, finalBlocked);
      writeValidatorSummary(runDir, status, finalBlocked, reportPathForMode);
      const correctiveAction = acceptanceError.blockedBy === "toc_chapter_count_too_low"
        ? "validator 报告的目录样本过短。先确认这是目标书本身章节少，还是 ruleToc 只提取到部分章节；确认短目录合理后用 resolve-user-action 记录，否则修 ruleToc 并重跑。"
        : acceptanceError.blockedBy === "toc_trial_chapters_only"
        ? "目录响应里有 signup/login?redirect= 引导链接，是站点匿名试读策略。不要修 ruleToc，让用户登录后重测，或由用户确认按试读交付。"
        : "validator 报告包含成功状态但缺少阅读语义证据。已回到 generate / 规则审计语义；修正对应规则后重新通过 rule-check，再重跑 validator。不要改写成可交付结论。";
      const nextCommand = isShortTocFamily
        ? `node "<skill-dir>/scripts/bsg.mjs" resolve-user-action --run ${runDir} --action toc_chapter_count_confirmed`
        : `node "<skill-dir>/scripts/bsg.mjs" run --run ${runDir}`;
      printHint(correctiveAction, nextCommand);
      return {
        ok: true,
        status: "blocked",
        blockedBy: acceptanceError.blockedBy,
        shouldRetry: true,
        nextAction: pending ? "resolve_user_action" : "repair_in_generate",
        repairContext: state.repairContext || null,
        message,
        requiredUserAction: pending ? "toc_sample_review" : undefined,
        pendingUserAction: pending,
        correctiveAction,
        nextCommand,
      };
    }
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
                readNext: readNextForBlocker("csr_shell_detected"),
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

  if (state.loginFeatures._loginMethod === "probe" && !reportUsedAndroidProbe(reportPathForMode)) {
    if (checkAdb()) {
      androidWarning = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⛔ Probe 登录后未用 Android 验证",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "本轮登录态来自 Android Probe，但 validator-report.json 没有 androidProbeUsed=true 或 androidBackend=probe_webview 证据。",
        "仅有 mode=android 或 PC HTTP Cookie 请求不能代表阅读 App/WebView 行为。",
        "不要重新登录。立即执行: node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir>。",
        "android 单入口会从 Android Probe Cookie 检查读取目标域 Cookie 并注入 validator。",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");
    } else if (state.adbDetected) {
      androidWarning = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⚠️  Probe 登录后 Android 真机或模拟器已断开",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "本轮登录态来自 Android Probe，但现在 adb 找不到真机或模拟器，不能退回 HTTP+Cookie 验证。",
        "请重新连接真机并确认 USB 调试授权，或启动模拟器并确认 adb devices 可见。",
        "然后运行: node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir>。",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");
    } else {
      androidWarning = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⛔ Probe 登录后未用 Android 验证",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "run-state 记录登录态来自 Android Probe，但 validator-report.json 没有 Android Probe 证据。",
        "当前未检测到可用 Android 真机或模拟器，不能把 Probe 登录后的验证退回 HTTP 或直接交付。",
        "请连接真机或启动模拟器后重新运行 Android mode 验证。",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");
    }
  }

  if (state.loginFeatures._loginMethod === "probe" && reportUsedAndroidProbe(reportPathForMode) && !reportHasLoginSessionEvidence(reportPathForMode)) {
    v.attempts -= 1;
    saveRunState(runDir, state);
    writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_probe_cookie_not_used");
    writeValidatorSummary(runDir, status, "blocked:android_probe_cookie_not_used", reportPathForMode);
    return {
      ok: true,
      status: "blocked",
      blockedBy: "android_probe_cookie_not_used",
      readNext: readNextForBlocker("android_probe_cookie_not_used"),
      shouldRetry: true,
      nextAction: "rerun_android_validation_with_probe_cookie",
      message: [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⛔ Probe 登录态没有进入 validator 报告",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "本轮登录已记录为 Android Probe，但 validator-report.json 仍是匿名会话：未看到非 anonymous sessionMode，也未看到 Cookie/Authorization 请求头。",
        "这说明只是完成了手机/模拟器登录动作，验证请求没有使用该登录态。请运行 node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir> 重新走 Android 验证。",
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
        const androidWasUsed = reportUsedAndroidProbe(reportPathForMode);
        const androidWebViewWasUsed = reportUsedAndroidWebView(reportPathForMode);
        const androidWebViewContentVerified = reportHasAndroidWebViewContentEvidence(reportPathForMode);

        if (adbOk && !androidWasUsed) {
          androidWarning = [
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "⛔ WebView 未验证 — Android 真机或模拟器已连接但未使用",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "adb 检测到真机或模拟器，但 validator-report.json 没有 Android Probe 证据。",
            "立即执行: node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir>。",
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
        } else if (androidWasUsed && androidWebViewWasUsed && !androidWebViewContentVerified) {
          androidWarning = [
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "⛔ Android WebView 没有正文提取证据",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "validator-report.json 有 Android WebView 渲染证据，但 content 阶段没有 ruleContent 提取出的正文 preview / evidence.contentPreview / contentLength。",
            "这只能证明页面在手机/模拟器 WebView 打开过，不能证明阅读 App 能提取正文。",
            "请用 Android Probe 重新验证正文页，确认 ruleContent.content / webJs 在 WebView DOM 上能提取到正文；失败时按 CONTENT_SELECTOR_EMPTY / WEBJS_RETURN_EMPTY / CONTENT_TOO_SHORT 回修。",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          ].join("\n");
        } else if (state.adbDetected) {
          androidWarning = [
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "⚠️  Android 真机或模拟器已断开 — 请重新连接",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "init 时检测到 Android 真机或模拟器，但现在 adb 找不到。",
            "可能原因：手机息屏后 USB 断开、adb 授权过期、数据线松动，或模拟器已关闭。",
            "请重新连接真机并确认 USB 调试授权，或启动模拟器并确认 adb devices 可见。",
            "然后运行: node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir>。",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          ].join("\n");
        } else {
          webViewAndroidUnavailable = true;
          androidWarning = [
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "⚠️  WebView 正文 — Android Probe 不可用",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "无可用 Android 真机或模拟器，WebView 正文无法在本机验证。",
            "书源状态会由 record-validation 降级收敛；需在 Legado App 内实测正文，不能标 full pass。",
            "如果用户后续连接真机或启动模拟器，可用 node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir> 重新验证。",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          ].join("\n");
        }
        saveRunState(runDir, state);
      }
    } catch { /* ignore */ }
  }

  // 反爬熔断：必须放在 Android 拦截前。Android 同样会触发 server-side verify，跑 Android 不能"绕过"。
  // 让 agent 反复换 mode/keyword 重试 = 累积同一 IP 访问 → IP 级风控倒计时。
  if (isAntiBotTriggered(report) && (status === "failed" || status === "needs_app_review")) {
    warningBy = "anti_bot_triggered";
    finalStatus = "needs_app_review";
    v.lastStatus = finalStatus;
    v.status = "completed";
    v.consecutiveSame = 0;
    v.lastError = "";
    v.recordedAt = new Date().toISOString();
    validationWarning = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "⚠️  站点反爬触发 — 停止自动重试",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "validator 报告显示链路被站点弹到人机验证 / Cloudflare / 验证码页。这是 server-side 站点行为，不是规则错误。",
      "**任何客户端(curl / validator / Probe / 浏览器)请求都计入同一 IP 累积，反复重试会触发 IP 级风控。**",
      "已收敛为 needs_app_review。正路：",
      "1. 让用户在浏览器或 Probe 里手动访问主页并过一次人机验证，让 session 持续有效。",
      "2. 然后让用户从主页正常导航到目标链路，让 cookie 落到 CookieStore。",
      "3. session 桥接好后再用 validator 一次性走完链路。",
      "",
      "禁止：自动重跑 validator、换 mode 重试(http/browser/android)、换 keyword 重试、跑 android single-entry 期望\"绕过\"——Android 端同样会被 server-side verify。",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");
    saveRunState(runDir, state);
    writeCapabilityMatrix(runDir, reportPathForMode, "needs_app_review");
    writeValidatorSummary(runDir, status, finalStatus, reportPathForMode);
    return {
      ok: true,
      status: finalStatus,
      warningBy,
      warning: validationWarning,
      message: validationWarning,
      nextCommand: `node "<skill-dir>/scripts/bsg.mjs" deliver --run ${runDir}`,
      readNext: readNextForBlocker("anti_bot_triggered"),
      forbiddenActions: ["rerun_validator", "switch_mode_retry", "switch_keyword_retry", "android_single_entry_retry"],
    };
  }

  if (androidWarning) {
    const actuallyUsedAndroid = reportUsedAndroidProbe(reportPathForMode);
    if (!actuallyUsedAndroid) {
      if (checkAdb()) {
        v.attempts -= 1;
        saveRunState(runDir, state);
        writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_probe_not_used");
        return androidProbeNotUsedBlock(runDir, state, androidWarning);
      }
      if (state.adbDetected) {
        v.attempts -= 1;
        saveRunState(runDir, state);
        writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_device_disconnected");
        return { ok: true, status: "blocked", blockedBy: "android_device_disconnected", shouldRetry: true, nextAction: "reconnect_device_and_retry", message: androidWarning };
      }
      if (state.loginFeatures._loginMethod === "probe") {
        v.attempts -= 1;
        saveRunState(runDir, state);
        writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_probe_not_used");
        writeValidatorSummary(runDir, status, "blocked:android_probe_not_used", reportPathForMode);
        const correctiveAction = "run-state 记录登录来自 Android Probe，但 validator-report.json 没有 Android Probe 证据。必须重新运行 Android Probe 验证，不能退回 HTTP 或直接交付。";
        const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" android --run "${runDir}"`;
        printHint(correctiveAction, nextCommand);
        return {
          ok: true,
          status: "blocked",
          blockedBy: "android_probe_not_used",
          readNext: readNextForBlocker("android_probe_not_used"),
          shouldRetry: true,
          nextAction: "rerun_android_validation_with_probe",
          message: androidWarning,
          correctiveAction,
          nextCommand,
        };
      }
    } else if (!reportUsedAndroidWebView(reportPathForMode) && (state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs)) {
      v.attempts -= 1;
      saveRunState(runDir, state);
      writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_webview_not_used");
      writeValidatorSummary(runDir, status, "blocked:android_webview_not_used", reportPathForMode);
      const correctiveAction = "生成源含 webView:true 但无 Android WebView 渲染证据。必须通过 android 单入口重新验证，并确认报告中有 rendered.html、screenshot 或 webViewHtmlPreview。不能标 passed。";
      const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" android --run "${runDir}"`;
      printHint(correctiveAction, nextCommand);
      return {
        ok: true,
        status: "blocked",
        blockedBy: "android_webview_not_used",
        readNext: readNextForBlocker("android_webview_not_used"),
        shouldRetry: true,
        nextAction: "rerun_android_webview_validation",
        message: androidWarning,
        correctiveAction,
        nextCommand,
      };
    } else if (!reportHasAndroidWebViewContentEvidence(reportPathForMode) && !isVipLockFailure(report) && (state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs)) {
      v.attempts -= 1;
      saveRunState(runDir, state);
      writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_webview_content_not_verified");
      writeValidatorSummary(runDir, status, "blocked:android_webview_content_not_verified", reportPathForMode);
      const correctiveAction = "Android WebView 已渲染但没有正文提取证据。必须修正 ruleContent.content / webJs 并重新用 Android Probe 验证，直到 content preview 或 contentLength 证明正文被提取。不能标 passed。";
      const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" android --run "${runDir}"`;
      printHint(correctiveAction, nextCommand);
      return {
        ok: true,
        status: "blocked",
        blockedBy: "android_webview_content_not_verified",
        readNext: readNextForBlocker("android_webview_content_not_verified"),
        shouldRetry: true,
        nextAction: "fix_android_webview_content_extraction",
        message: androidWarning,
        correctiveAction,
        nextCommand,
      };
    }
  }
  if (androidWarning) {
    state._androidWarning = androidWarning;
  }

  const probeCookieAlreadyInjected = state.loginFeatures._loginMethod === "probe"
    && reportUsedAndroidProbe(reportPathForMode)
    && reportHasLoginSessionEvidence(reportPathForMode);
  if (state.loginFeatures.hasEnabledCookieJar && (status === "failed" || status === "needs_app_review") && !probeCookieAlreadyInjected) {
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
        "3. 重新验证: node \"<skill-dir>/scripts/bsg.mjs\" validate --run runs/<slug>（自动检测 cookies.json）",
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
      readNext: readNextForBlocker("cookie_not_injected"),
      shouldRetry: true,
      nextAction: "inject_cookies_and_retry",
      message: cookieWarning,
    };
  }

  if (status === "needs_app_review" && state.userDecisions?.androidDevice !== "unavailable" && !reportUsedAndroidProbe(reportPathForMode)) {
    const android = diagnoseAndroid();
    const message = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "⛔ needs_app_review 需要先确认 Android/App 复核条件",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "本轮验证结论是 needs_app_review，但 validator-report.json 没有 Android Probe 证据。",
      `当前 Android/adb 状态: ${android.state}。${android.message}`,
      "",
      android.state === "device_ready"
        ? "已检测到 Android 真机或模拟器：请优先用 node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir> 重新进行 Android 验证，不要直接交付 needs_app_review。"
        : "未检测到可用 Android 真机或模拟器：必须先问用户是否有 Android 真机/模拟器可用于 App 复核。",
      "",
      "如果用户确认没有可用 Android 真机或模拟器，运行 node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir> --no-device 后再记录 needs_app_review。",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");
    const pending = setPendingUserAction(state, "android_device_needed", "needs_app_review_requires_android_decision", message, {
      blockingPhase: "validate",
      android,
      validatorStatus: status,
    });
    v.attempts -= 1;
    saveRunState(runDir, state);
    writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_device_needed");
    return {
      ok: true,
      status: "blocked",
      blockedBy: "android_device_needed",
      readNext: readNextForBlocker("android_device_needed"),
      shouldRetry: true,
      nextAction: "confirm_android_device_availability",
      requiredUserAction: "android_device_needed",
      message,
      pendingUserAction: pending,
    };
  }

  if (status === "passed" && state.userDecisions?.androidDevice !== "unavailable" && !reportUsedAndroidMode(report)) {
    const android = diagnoseAndroid();
    const message = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "⛔ Android 交付事实未确认",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "validator-report.json 不是 Android mode 结果。PC HTTP/Browser 只能辅助写规则，不能作为最终可用结论。",
      `当前 Android/adb 状态: ${android.state}。${android.message}`,
      "",
      android.state === "device_ready"
        ? "已检测到 Android 真机或模拟器：运行 node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir>，以 Android 结果作为最终裁判。"
        : "未检测到可用 Android 真机或模拟器：请先询问用户是否有真机或模拟器；有则连接/启动后运行 node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir>。",
      "如果用户明确没有可用 Android 真机或模拟器，运行 node \"<skill-dir>/scripts/bsg.mjs\" android --run <dir> --no-device 后再降级记录；不要宣称 full pass。",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");
    const pending = setPendingUserAction(state, "android_device_needed", "android_final_authority_required", message, {
      blockingPhase: "validate",
      android,
      validatorStatus: status,
      reportMode: report?.mode || null,
    });
    v.attempts -= 1;
    saveRunState(runDir, state);
    writeCapabilityMatrix(runDir, reportPathForMode, "blocked:android_final_authority_not_used");
    writeValidatorSummary(runDir, status, "blocked:android_final_authority_not_used", reportPathForMode);
    return {
      ok: true,
      status: "blocked",
      blockedBy: "android_final_authority_not_used",
      readNext: readNextForBlocker("android_final_authority_not_used"),
      shouldRetry: true,
      nextAction: "confirm_android_device_availability",
      requiredUserAction: "android_device_needed",
      message,
      pendingUserAction: pending,
      correctiveAction: "最终交付结论必须优先来自 Android。先运行 Android 单入口；没有设备时必须由用户明确确认后降级。",
      nextCommand: `node "<skill-dir>/scripts/bsg.mjs" android --run "${runDir}"`,
    };
  }

  if (status === "passed" && webViewAndroidUnavailable && (state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs)) {
    finalStatus = "validator_limitation";
    v.lastStatus = finalStatus;
    v.status = "completed";
    v.consecutiveSame = 0;
  } else if (status === "passed" && !hasLoginFeatures) {
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
  } else if (status === "failed") {
    if (isVipLockFailure(report)) {
      warningBy = "content_vip_lock";
      finalStatus = "needs_app_review";
      v.lastStatus = finalStatus;
      v.status = "completed";
      v.consecutiveSame = 0;
      validationWarning = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⚠️  正文命中登录/付费边界",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "validator-report.json 显示正文页是 VIP/付费/需登录边界。这可能只是账号没有订阅/付费权限，不应强制阻塞交付。",
        "已收敛为 needs_app_review：可以继续 deliver，但 capability-matrix 会保留 content:vip 警告，不能宣称 full pass 或 VIP 已支持。",
        "如果用户提供具备权限的账号，可通过 Android 单入口重新验证以提高覆盖；否则按免费/非 VIP 能力交付。",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");
    } else {
      const errorSig = validationErrorSignature(report, status);

      if (errorSig === v.lastError) {
        v.consecutiveSame = (v.consecutiveSame || 0) + 1;
      } else {
        v.consecutiveSame = 1;
      }
      v.lastError = errorSig;

      if (v.consecutiveSame >= 5) {
        finalStatus = "failed_unresolved";
        v.status = "completed";
        convergenceBlock = `同一错误连续 ${v.consecutiveSame} 次未修复 (${errorSig.slice(0, 120)})，判定为死循环。停止自动回修，需人工介入。`;
      } else {
        shouldRetry = true;
        finalStatus = "failed";
        nextAction = "repair_in_generate";
        enterGenerateRepair(state, buildRepairContext(report, status, "validator_failed", fileSha256(loadedSource.bookSourcePath)));
      }
    }
  } else if (status === "needs_app_review") {
    finalStatus = "needs_app_review";
    v.status = "completed";
  } else if (status === "validator_limitation") {
    finalStatus = "validator_limitation";
    v.status = "completed";
  }

  v.recordedAt = new Date().toISOString();
  writeCapabilityMatrix(runDir, reportPathForMode, finalStatus);
  writeValidatorSummary(runDir, status, finalStatus, reportPathForMode);
  saveRunState(runDir, state);

  let baseMessage;
  if (shouldRetry) {
    baseMessage = `验证失败 (第 ${v.attempts} 次${v.consecutiveSame > 1 ? `，同一错误第 ${v.consecutiveSame} 次` : ""})。已回到 generate / 规则审计语义；请根据 validator-report.json / repairContext 回修 book-source.json，修完重新通过 rule-check，再重跑 validator。${v.consecutiveSame >= 2 ? "⚠️ 已连续 " + v.consecutiveSame + " 次相同错误，再失败将停止自动修。" : ""}`;
  } else if (convergenceBlock) {
    baseMessage = convergenceBlock;
  } else if (validationWarning) {
    baseMessage = `${validationWarning}\n验证完成。状态: ${finalStatus}。可直接运行 deliver 做最终审计。`;
  } else {
    baseMessage = `验证完成。状态: ${finalStatus}。可直接运行 deliver 做最终审计。`;
  }

  return {
    ok: true,
    status: finalStatus,
    attempt: v.attempts,
    consecutiveSame: v.consecutiveSame,
    shouldRetry,
    nextAction,
    repairContext: state.repairContext || null,
    ...(shouldRetry
      ? { nextCommand: `node "<skill-dir>/scripts/bsg.mjs" run --run ${runDir}` }
      : { nextCommand: `node "<skill-dir>/scripts/bsg.mjs" deliver --run ${runDir}` }),
    message: baseMessage + (state._androidWarning ? "\n" + state._androidWarning : ""),
    ...(warningBy ? { warningBy } : {}),
    ...(validationWarning ? { warning: validationWarning } : {}),
    ...(state._androidWarning ? { androidWarning: state._androidWarning } : {}),
    ...(convergenceBlock ? { convergenceBlock } : {}),
  };
}

export function cmdDeliver(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" deliver --run <run-dir>");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  return cmdDeliverCheck(state, runDir);
}
