import fs from "node:fs";
import path from "node:path";
import {
  SKILL_ROOT, fail, fileExists, readJsonFile, saveRunState,
  getPendingUserAction, printHint,
} from "./state.mjs";
import { resetPhasesFrom } from "./phase-order.mjs";
import {
  loadBookSource, validateBookSourceStructure, ensureAssessmentFactsFresh,
  ensureRuleCheckSourceFresh,
} from "./facts.mjs";

// deliver 失败的统一尾注：本 skill 的 validator 复现了阅读书源规则引擎的核心语义，
// deliver 没通过 = 用户拿到此书源大概率用不了 = 必然返工。
// 不能用"写总结/写表格"绕过交付门，必须修到 deliver 通过或停在 needs_app_review。
const DELIVER_FAIL_TAIL = '\n\n⚠️ deliver 没通过 = 用户拿到此书源大概率用不了 = 必然返工。本 skill 的 validator 复现了阅读书源规则引擎的核心语义，不存在“validator 过不了但阅读能用”的中间地带。修到 deliver 通过，或停在 needs_app_review/validator_limitation 让用户知道限制。不要写总结表格替代交付。';
function deliverFail(message) {
  return fail(message + DELIVER_FAIL_TAIL);
}

// ── deliver check ──────────────────────────────────────────────────────────

export function cmdDeliverCheck(state, runDir) {
  const pending = getPendingUserAction(state);
  if (pending) {
    return deliverFail(`仍有待用户确认动作: ${pending.type}。请先运行 resolve-user-action。`);
  }

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

  if (missing.length > 0) {
    const summaryHint = missing.includes("validator-summary.md")
      ? "validator-summary.md 必须由 record-validation 生成；不要手写补文件。"
      : "";
    return deliverFail(`交付前文件不完整。缺少: ${missing.join(", ")}${summaryHint ? " " + summaryHint : ""}`);
  }

  const summaryText = fs.readFileSync(path.join(runDir, "validator-summary.md"), "utf-8");
  if (!summaryText.includes("此文件由 record-validation 生成")) {
    return deliverFail("validator-summary.md 不是 record-validation 生成的摘要。请重新运行 record-validation，不要手写 summary。");
  }

  const loadedSource = loadBookSource(runDir, state);
  if (!loadedSource.ok) return deliverFail(loadedSource.error);
  const sourceStructureError = validateBookSourceStructure(loadedSource.sources);
  if (sourceStructureError) return deliverFail(sourceStructureError);

  const bsSource = loadedSource.sources[0];
  if (bsSource) {
    const jsonStr = JSON.stringify(bsSource);
    if (bsSource.loginUrl) state.loginFeatures.hasLoginUrl = true;
    if (bsSource.enabledCookieJar === true) state.loginFeatures.hasEnabledCookieJar = true;
    if (bsSource.header && String(bsSource.header).includes("Authorization")) state.loginFeatures.hasAuthorization = true;
    if (jsonStr.includes('"webView":true') || jsonStr.includes("'webView':true")) state.loginFeatures.hasWebView = true;
    if (bsSource.ruleContent?.webJs) state.loginFeatures.hasWebJs = true;
    saveRunState(runDir, state);
  }
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
    resetPhasesFrom(state, "generate");
    saveRunState(runDir, state);
    const correctiveAction = "当前 validator-report.json 已不对应最新 book-source.json，不能复用旧报告交付。已回到 generate / 规则审计语义；修正书源后重新通过 rule-check，再重跑 validator。";
    const nextCommand = `node "<skill-dir>/scripts/bsg.mjs" run --run ${runDir}`;
    printHint(correctiveAction, nextCommand);
    return {
      ...fail(`${sourceFreshError} 已回到 generate / 规则审计语义，请重新通过 rule-check 后再验证。`),
      correctiveAction,
      nextCommand,
    };
  }

  const v = state.phases.validate;
  const hasLoginFeatures = Object.values(state.loginFeatures).some((b) => b === true);
  if (!v.lastStatus) {
    return deliverFail("缺少验证状态。必须先运行 record-validation 记录真实 validator 结果，不能仅创建 validator-report.json。");
  }
  if (v.status !== "completed") {
    return deliverFail("验证未完成。上次 record-validation 返回 blocked/重试动作时不能交付，请按 blockedBy 修复后重新记录验证。");
  }

  const ruleCheck = readJsonFile(path.join(runDir, "rule-check.json"));
  if (!ruleCheck || ruleCheck.status !== "passed") {
    return deliverFail("rule-check.json 未通过。必须先完成 official-rule-pack 校验，不能跳过规则审计。");
  }

  const matrix = readJsonFile(path.join(runDir, "capability-matrix.json"));
  if (!matrix || !matrix.overall || matrix.status === "pending") {
    return deliverFail("capability-matrix.json 未由 record-validation 生成有效能力矩阵。请重新运行 record-validation。");
  }
  const matrixStatus = matrix.overall?.status || matrix.status;
  if (typeof matrixStatus === "string" && matrixStatus.startsWith("blocked")) {
    return deliverFail(`capability-matrix.json 仍为阻塞状态: ${matrixStatus}。不能把 blocked 验证结果改写成可交付结论。`);
  }

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
  }

  const STATUS_MESSAGES = {
    passed: "已生成 book-source.json，validator 验证通过（全链路成功）。",
    anonymous_candidate: "已生成 book-source.json，匿名验证通过但站点存在登录态/WebView/Cookie 依赖，不能标可用，需登录态/App 复核。",
    degraded: "已生成 book-source.json，技术链路通过但阅读体验降级。可导入，但建议 App 端确认章节体验。",
    needs_app_review: "已生成 book-source.json，record-validation 收敛为需人工/App 复核。",
    failed_unresolved: "已生成 book-source.json，同一错误连续 5 次未修复（收敛失败）。需人工检查。",
    validator_limitation: "已生成 book-source.json，validator 无法验证部分能力；预期需要 App/WebView 复核。当前不是 full pass，不能标可用。",
  };

  state.phases.deliver.status = "completed";
  saveRunState(runDir, state);

  const pidFile = path.join(SKILL_ROOT, ".validator-pid");
  let cleanupReminder = null;
  if (fileExists(pidFile)) {
    const vPid = fs.readFileSync(pidFile, "utf-8").trim();
    cleanupReminder = `⚠ 别忘了关 validator: node "<skill-dir>/scripts/bsg.mjs" validator-stop (PID: ${vPid})`;
  }

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
    capability: matrix.overall,
    ...(cleanupReminder ? { cleanupReminder } : {}),
  };
}
