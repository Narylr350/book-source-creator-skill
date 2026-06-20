#!/usr/bin/env node
/* eslint-env node */
/* global AbortSignal */
/**
 * @typedef {typeof import("node:process")} NodeProcess
 * @typedef {typeof import("node:crypto")} NodeCrypto
 * @typedef {typeof import("node:fs")} NodeFs
 * @typedef {typeof import("node:path")} NodePath
 * @typedef {typeof import("node:child_process")} NodeChildProcess
 */

/**
 * bsg.mjs ― Legado 书源生成工作流状态机
 *
 * 用法:
 *   node scripts/bsg.mjs init <url> [--fast]
 *   node scripts/bsg.mjs status --run <dir>
 *   node scripts/bsg.mjs advance --run <dir>
 *   node scripts/bsg.mjs check --run <dir>
 *   node scripts/bsg.mjs record-assessment --run <dir>
 *   node scripts/bsg.mjs set-login-features --run <dir> [--flags <json>]
 *   node scripts/bsg.mjs record-validation --run <dir> --status <status> [--report <file>]
 *   node scripts/bsg.mjs deliver --run <dir>
 *   node scripts/bsg.mjs validator-start [--background]
 *   node scripts/bsg.mjs validator-stop
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deriveSiteSlug } from "./lib/slug.mjs";
import { initializeRunBundle } from "./lib/output-bundle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");
// noinspection JSUnresolvedReference
const VALIDATOR_URL = process.env.VALIDATOR_URL || "http://localhost:1111";
const OFFICIAL_RULE_PACK_PATH = path.join(SKILL_ROOT, "references", "official-rule-pack.json");
const LINK_PHASES = ["search", "detail", "toc", "content"];

// ── helpers ────────────────────────────────────────────────────────────────

function isInSkillInstallDir(cwd) {
  const norm = (p) => path.resolve(p).toLowerCase();
  const dir = norm(cwd);
  const blocked = [
    norm(path.join(SKILL_ROOT)),
    norm(path.join(process.env["HOME"] || "", ".claude", "skills")),
    norm(path.join(process.env["HOME"] || "", ".codex", "skills")),
    norm(path.join(process.env["HOME"] || "", ".agents", "skills")),
  ];
  return blocked.some((b) => dir === b || dir.startsWith(b + path.sep));
}


function signState(state) {
  const { _signature, ...clean } = state;
  const json = JSON.stringify(clean, null, 2);
// noinspection JSCheckFunctionSignatures
  return crypto.createHash("sha256").update(json).digest().toString("hex").slice(0, 16);
}

function loadRunState(runDir) {
  const p = path.join(runDir, "run-state.json");
  if (!fileExists(p)) return null;
  const raw = fs.readFileSync(p, "utf-8");
  const state = JSON.parse(raw);
  if (state._signature) {
    const expected = signState(state);
    if (state._signature !== expected) {
      // State was manually edited — reject
      return { _tampered: true };
    }
  }
  return state;
}

function saveRunState(runDir, state) {
  state.updatedAt = new Date().toISOString();
  delete state._tampered;
  const unsigned = { ...state };
  delete unsigned._signature;
  unsigned._signature = signState(unsigned);
  fs.writeFileSync(
    path.join(runDir, "run-state.json"),
    JSON.stringify(unsigned, null, 2),
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
    pendingUserAction: null,
    userDecisions: {
      androidDevice: null,
      login: null,
    },
    userActionHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function fail(message) {
  return { ok: false, error: message };
}

function loadAndVerify(runDir) {
  const state = loadRunState(runDir);
  if (!state) return { state: null, error: `未找到 run-state.json: ${runDir}` };
  if (state._tampered) {
    return { state: null, error: "⛔ run-state.json 被手动编辑过。所有修改必须通过 bsg.mjs 命令。删除 runs/<slug>/ 重新 init。" };
  }
  ensureRunArtifacts(runDir, state);
  return { state, error: null };
}

function fileExists(filePath) {
  try { fs.statSync(filePath); return true; } catch { return false; }
}

function parseArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  return args[idx + 1] || null;
}

function getPendingUserAction(state) {
  return state.pendingUserAction && state.pendingUserAction.resolved !== true
    ? state.pendingUserAction
    : null;
}

function setPendingUserAction(state, type, reason, message, details = {}) {
  const existing = getPendingUserAction(state);
  if (existing && existing.type === type && existing.reason === reason) return existing;
  state.pendingUserAction = {
    type,
    reason,
    message,
    details,
    resolved: false,
    createdAt: new Date().toISOString(),
  };
  return state.pendingUserAction;
}

function pendingUserActionResponse(action) {
  return {
    ok: true,
    nextAction: "stop",
    requiredUserAction: action.type,
    message: action.message,
    reason: action.reason,
    pendingUserAction: action,
  };
}

function blockForPendingUserAction(state) {
  const action = getPendingUserAction(state);
  if (!action) return null;
  return pendingUserActionResponse(action);
}

function validateCookieFileShape(cookieFile) {
  if (!fileExists(cookieFile)) {
    return { ok: false, reason: "missing" };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cookieFile, "utf-8"));
  } catch (e) {
    return { ok: false, reason: `cookies.json 不是合法 JSON: ${e.message}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "cookies.json 必须是对象。" };
  }

  if (typeof parsed.domain === "string" && typeof parsed.cookie === "string") {
    if (!parsed.domain.includes(".") || !parsed.cookie.includes("=")) {
      return { ok: false, reason: "cookies.json 的 {domain,cookie} 格式无效。" };
    }
    return { ok: true, format: "domain_cookie" };
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    return { ok: false, reason: "cookies.json 为空。" };
  }
  if (entries.length === 1 && entries[0][0] === "domain" && typeof entries[0][1] === "string" && entries[0][1].includes("=")) {
    return {
      ok: false,
      reason: "cookies.json 写成了 {\"domain\":\"cookie_string\"}，缺少真实域名键。",
    };
  }
  for (const [domain, value] of entries) {
    if (!domain.includes(".") || typeof value !== "string" || !value.includes("=")) {
      return {
        ok: false,
        reason: "cookies.json 应为 {\"www.example.com\":\"a=b; c=d\"}，或 {\"domain\":\"www.example.com\",\"cookie\":\"a=b; c=d\"}。",
      };
    }
  }
  return { ok: true, format: "domain_map" };
}

function reportUsedAndroidMode(reportPath) {
  if (!fileExists(reportPath)) return false;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    if (report.mode === "android") return true;
    return (report.steps || []).some((s) => s.mode === "android");
  } catch {
    return false;
  }
}

function reportUsedAndroidWebView(reportPath) {
  if (!fileExists(reportPath)) return false;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    return (report.steps || []).some((step) => {
      if (step?.mode !== "android") return false;
      if (step.phase !== "content") return false;
      if (step.webViewHtmlPreview || step.webViewScreenshotBase64) return true;
      const artifacts = step.debugArtifacts || {};
      return Boolean(artifacts["response.rendered.html"] || artifacts["screenshot.png"]);
    });
  } catch {
    return false;
  }
}

function reportHasLoginSessionEvidence(reportPath) {
  if (!fileExists(reportPath)) return false;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    if (report.sessionMode && report.sessionMode !== "anonymous") return true;
    return (report.steps || []).some((step) => {
      if (step.sessionMode && step.sessionMode !== "anonymous") return true;
      const headers = step.request?.headers || {};
      return Boolean(headers.Cookie || headers.cookie || headers.Authorization || headers.authorization);
    });
  } catch {
    return false;
  }
}

function reportHardRuleError(reportPath) {
  if (!fileExists(reportPath)) return null;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    for (const step of report.steps || []) {
      const phase = step?.phase || "";
      const requestUrl = step?.request?.url || "";
      const extracted = step?.extracted || {};
      if (phase === "toc" && step.status === "error" && /\/chapter-list\/?(?:[?#]|$)/.test(requestUrl)) {
        return "目录请求变成 /chapter-list/，这是 tocUrl/book id 规则错误，不是 App 复核或 validator 限制。";
      }
      if (phase === "detail" && /\/chapter-list\/?(?:[?#]|$)/.test(extracted.tocUrl || "")) {
        return "详情阶段提取到的 tocUrl 缺少 book id，应修 ruleBookInfo.tocUrl，不应标 needs_app_review。";
      }
      if (phase === "detail" && step.status === "success") {
        const missing = [];
        if (Object.prototype.hasOwnProperty.call(extracted, "coverUrl") && !extracted.coverUrl) missing.push("coverUrl");
        if (Object.prototype.hasOwnProperty.call(extracted, "intro") && !extracted.intro) missing.push("intro");
        if (missing.length > 0) {
          return `详情阶段 ${missing.join(", ")} 为空，这是选择器或字段名错误，不应包装成 App 复核。`;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function writeValidatorSummary(runDir, status, finalStatus, reportPath) {
  const lines = [
    "# 验证摘要",
    "",
    `- 记录状态: ${status}`,
    `- 最终状态: ${finalStatus}`,
  ];
  if (reportPath && fileExists(reportPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      if (report.phases) lines.push(`- 阶段状态: ${JSON.stringify(report.phases)}`);
      if (report.summary?.error) lines.push(`- 主要错误: ${report.summary.error}`);
      lines.push(`- Android mode: ${reportUsedAndroidMode(reportPath) ? "有" : "无"}`);
      lines.push(`- Android WebView 渲染证据: ${reportUsedAndroidWebView(reportPath) ? "有" : "无"}`);
    } catch (e) {
      lines.push(`- 报告读取失败: ${e.message}`);
    }
  }
  lines.push("", "此文件由 record-validation 生成，不手写。");
  fs.writeFileSync(path.join(runDir, "validator-summary.md"), lines.join("\n") + "\n", "utf-8");
}

function loadBookSource(runDir, state) {
  const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (!fileExists(bookSourcePath)) {
    return { ok: false, error: `book-source.json 不存在: ${bookSourcePath}。` };
  }
  try {
    const sourceJson = fs.readFileSync(bookSourcePath, "utf-8");
    const parsed = JSON.parse(sourceJson);
    const sources = Array.isArray(parsed) ? parsed : [parsed];
    return { ok: true, bookSourcePath, sourceJson, parsed, sources };
  } catch (e) {
    return { ok: false, error: `book-source.json 不是合法 JSON: ${e.message}` };
  }
}

function validateBookSourceStructure(sources) {
  for (const source of sources) {
    if (source?.ruleBookInfo && Object.prototype.hasOwnProperty.call(source.ruleBookInfo, "summary")) {
      return "ruleBookInfo.summary 不是阅读详情简介字段；应使用 ruleBookInfo.intro。";
    }
  }
  return null;
}

function readJsonFile(filePath, fallback = null) {
  if (!fileExists(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function emptyLinks() {
  return Object.fromEntries(LINK_PHASES.map((phase) => [
    phase,
    { status: "unknown", blocker: null, render: null, evidenceIds: [] },
  ]));
}

function normalizeLinkStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (["success", "ok", "passed", "pass"].includes(value)) return "success";
  if (["blocked", "block", "captcha", "login_required"].includes(value)) return "blocked";
  if (["failed", "fail", "error"].includes(value)) return "failed";
  return value || "unknown";
}

function getEvidenceIds(facts) {
  const ids = new Set();
  for (const item of facts?.evidence || []) {
    if (item?.id) ids.add(item.id);
  }
  for (const phase of LINK_PHASES) {
    for (const id of facts?.links?.[phase]?.evidenceIds || []) ids.add(id);
  }
  return ids;
}

function ensureRunArtifacts(runDir, state) {
  const siteFactsPath = path.join(runDir, "site-facts.json");
  if (!fileExists(siteFactsPath)) {
    writeJsonFile(siteFactsPath, {
      version: "1.0",
      siteUrl: state.siteUrl,
      links: emptyLinks(),
      evidence: [],
    });
  }
  const capabilityPath = path.join(runDir, "capability-matrix.json");
  if (!fileExists(capabilityPath)) {
    writeJsonFile(capabilityPath, {
      version: "1.0",
      status: "pending",
      links: emptyLinks(),
      overall: { status: "pending", fullPass: false, blockers: [] },
    });
  }
  const ruleCheckPath = path.join(runDir, "rule-check.json");
  if (!fileExists(ruleCheckPath)) {
    writeJsonFile(ruleCheckPath, {
      version: "1.0",
      status: "pending",
      source: "official-rule-pack",
      errors: [],
      warnings: [],
      checkedRuleIds: [],
    });
  }
  const lessonCheckPath = path.join(runDir, "lesson-check.json");
  if (!fileExists(lessonCheckPath)) {
    writeJsonFile(lessonCheckPath, {
      version: "1.0",
      status: "pending",
      triggeredLessons: [],
      answers: [],
    });
  }
}

function loadSiteFacts(runDir) {
  const factsPath = path.join(runDir, "site-facts.json");
  const facts = readJsonFile(factsPath);
  if (!facts || typeof facts !== "object") {
    return { ok: false, error: "site-facts.json 不存在或不是合法 JSON。Probe 后必须先记录四链路事实。" };
  }
  const missing = [];
  const invalid = [];
  for (const phase of LINK_PHASES) {
    const link = facts.links?.[phase];
    if (!link || !link.status || link.status === "unknown") {
      missing.push(phase);
      continue;
    }
    const normalizedStatus = normalizeLinkStatus(link.status);
    if (!["success", "blocked", "failed"].includes(normalizedStatus)) {
      invalid.push(`${phase}:${link.status}`);
      continue;
    }
    link.status = normalizedStatus;
  }
  if (missing.length > 0) {
    return { ok: false, error: `site-facts.json 四链路事实不完整，缺少明确状态: ${missing.join(", ")}。` };
  }
  if (invalid.length > 0) {
    return { ok: false, error: `site-facts.json 链路 status 必须是 success/blocked/failed（ok/pass/error 可自动归一化）。无效值: ${invalid.join(", ")}。` };
  }
  return { ok: true, facts };
}

function riskFromBlocker(blocker) {
  if (!blocker) return null;
  if (/captcha|cloudflare|turnstile|anti_bot|blocked/i.test(blocker)) return "有反爬风险";
  if (/login|cookie|auth|vip|paid|subscribe|payment/i.test(blocker)) return "需登录态";
  if (/webview|csr|android/i.test(blocker)) return "WebView 依赖";
  if (/encrypt|crypto/i.test(blocker)) return "加密正文";
  return null;
}

function risksFromRender(render) {
  const value = String(render || "");
  const risks = [];
  if (/webview|csr/i.test(value)) risks.push("WebView 依赖");
  if (/encrypt|crypto|cipher/i.test(value)) risks.push("加密正文");
  return risks;
}

function deriveAssessmentFromFacts(facts) {
  const links = facts.links || {};
  const risks = new Set();
  const blockers = [];
  const statuses = LINK_PHASES.map((phase) => {
    const link = links[phase] || { status: "unknown" };
    const status = normalizeLinkStatus(link.status);
    link.status = status;
    const risk = riskFromBlocker(link.blocker);
    if (risk) risks.add(risk);
    for (const renderRisk of risksFromRender(link.render)) risks.add(renderRisk);
    if (link.blocker) blockers.push(`${phase}:${link.blocker}`);
    return status;
  });

  const successCount = statuses.filter((s) => s === "success").length;
  const allSuccess = successCount === LINK_PHASES.length;
  const rating = successCount > 0 ? "可生成" : "不建议生成";
  const overallStatus = allSuccess ? "full_pass_candidate" : successCount > 0 ? "partial_candidate" : "blocked";
  const fullPass = allSuccess && blockers.length === 0;
  const riskLabels = risks.size > 0 ? Array.from(risks).join(" / ") : "无风险";
  const loginDemand = risks.has("需登录态") ? "部分需要" : "否";
  const requiredActions = [];
  if (risks.has("需登录态")) requiredActions.push("login_required");
  if (risks.has("WebView 依赖")) requiredActions.push("android_device_needed");

  return {
    rating,
    riskLabels,
    loginDemand,
    overallStatus,
    fullPass,
    blockers,
    requiredActions,
    signals: {
      protectedContent: risks.has("需登录态"),
      hasLoginRiskLabel: risks.has("需登录态"),
      hasPaymentRisk: blockers.some((b) => /vip|paid|subscribe|payment/i.test(b)),
      hasWebView: risks.has("WebView 依赖"),
      hasEncryptedContent: risks.has("加密正文"),
    },
  };
}

function renderAssessmentAutoSummary(state, facts, derived) {
  const lines = [
    `- 站点 URL: ${facts.siteUrl || state.siteUrl}`,
    `- 评级: ${derived.rating}`,
    `- 风险标签: ${derived.riskLabels}`,
    `- 总体状态: ${derived.overallStatus}`,
    `- full pass: ${derived.fullPass ? "是" : "否"}`,
    `- 搜索链路: ${facts.links.search.status}${facts.links.search.blocker ? ` (${facts.links.search.blocker})` : ""}`,
    `- 详情链路: ${facts.links.detail.status}${facts.links.detail.blocker ? ` (${facts.links.detail.blocker})` : ""}`,
    `- 目录链路: ${facts.links.toc.status}${facts.links.toc.blocker ? ` (${facts.links.toc.blocker})` : ""}`,
    `- 正文链路: ${facts.links.content.status}${facts.links.content.render ? ` (${facts.links.content.render})` : ""}${facts.links.content.blocker ? ` (${facts.links.content.blocker})` : ""}`,
    `- 登录需求: ${derived.loginDemand}`,
    `- 登录/Android/WebView: ${derived.requiredActions.length > 0 ? derived.requiredActions.join(", ") : "无"}`,
    `- 阻塞原因: ${derived.blockers.length > 0 ? derived.blockers.join(", ") : "无"}`,
    `- 待确认动作: ${derived.requiredActions.length > 0 ? derived.requiredActions.join(", ") : "无"}`,
  ];
  const hash = crypto.createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
  return [
    "<!-- AUTO:BEGIN summary -->",
    `<!-- AUTO:HASH ${hash} -->`,
    ...lines,
    "<!-- AUTO:END summary -->",
  ].join("\n");
}

function getAutoSummaryBlock(content) {
  const match = content.match(/<!-- AUTO:BEGIN summary -->([\s\S]*?)<!-- AUTO:END summary -->/);
  if (!match) return null;
  return match[0];
}

function validateAssessmentAutoBlock(content) {
  const block = getAutoSummaryBlock(content);
  if (!block) return null;
  const hashMatch = block.match(/<!-- AUTO:HASH ([a-f0-9]{16}|pending) -->/);
  if (!hashMatch || hashMatch[1] === "pending") return null;
  const body = block
    .split(/\r?\n/)
    .filter((line) => !/AUTO:BEGIN|AUTO:END|AUTO:HASH/.test(line))
    .join("\n");
  const expected = crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
  return expected === hashMatch[1] ? null : "assessment.md 自动结论区被手动修改。请重新运行 record-assessment 生成 AUTO 区块，不要手写结论。";
}

function replaceAssessmentAutoSummary(content, autoSummary) {
  if (getAutoSummaryBlock(content)) {
    return content.replace(/<!-- AUTO:BEGIN summary -->[\s\S]*?<!-- AUTO:END summary -->/, autoSummary);
  }
  return [
    "# 网站可生成性评估",
    "",
    autoSummary,
    "",
    "## 证据说明",
    "",
    "## 分析备注",
    "",
    content.trim(),
    "",
  ].join("\n");
}

function validateEvidenceNotes(content, facts) {
  const section = content.match(/## 证据说明([\s\S]*?)(?:\n## |\s*$)/);
  if (!section) return null;
  const evidenceIds = getEvidenceIds(facts);
  const badLines = section[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("<!--") && !line.startsWith("#"))
    .filter((line) => {
      const match = line.match(/evidence:([A-Za-z0-9_.:-]+)/);
      return !match || !evidenceIds.has(match[1]);
    });
  if (badLines.length === 0) return null;
  return `证据说明必须引用有效 evidence id（格式 evidence:<id>）。问题行: ${badLines.slice(0, 3).join(" | ")}`;
}

function loadOfficialRulePack() {
  const pack = readJsonFile(OFFICIAL_RULE_PACK_PATH);
  return pack?.rules || [];
}

function isJsonOrJsRule(value) {
  return typeof value === "string" && (
    value.startsWith("$.") ||
    value.startsWith("@json:") ||
    value.startsWith("<js>") ||
    value.startsWith("@js:") ||
    value.includes("{{")
  );
}

function runOfficialRuleCheck(sources, state) {
  const rules = loadOfficialRulePack();
  const errors = [];
  const warnings = [];
  const checkedRuleIds = [];
  const addIssue = (rule, detail) => {
    const issue = {
      ruleId: rule.id,
      severity: rule.severity,
      message: detail || rule.message,
      sourceKind: rule.sourceKind,
      sourceUrl: rule.sourceUrl,
    };
    if (rule.severity === "warning") warnings.push(issue);
    else errors.push(issue);
  };

  for (const rule of rules) {
    checkedRuleIds.push(rule.id);
    for (const source of sources) {
      const jsonStr = JSON.stringify(source);
      if (rule.checkKind === "forbidField") {
        const [groupName, fieldName] = rule.target.split(".");
        if (source?.[groupName] && Object.prototype.hasOwnProperty.call(source[groupName], fieldName)) {
          addIssue(rule);
        }
      } else if (rule.checkKind === "forbidSearchUrlToken") {
        if (rule.tokens.some((token) => source.searchUrl?.includes(token))) {
          addIssue(rule);
        }
      } else if (rule.checkKind === "forbidSelectorTokens") {
        const token = rule.tokens.find((item) => jsonStr.includes(item));
        if (token) addIssue(rule, `${rule.message} 检测到: ${token}`);
      } else if (rule.checkKind === "cookieLoginShape") {
        if (state.loginFeatures.hasEnabledCookieJar || state.loginFeatures.hasAuthorization || source.enabledCookieJar) {
          if (!source.enabledCookieJar) addIssue(rule, "需要登录态的站点必须设置 enabledCookieJar: true。");
          if (!source.loginUrl) addIssue(rule, "enabledCookieJar 已启用但缺少 loginUrl。");
          if (!source.header || !String(source.header).includes("java.getCookie")) {
            addIssue(rule, "enabledCookieJar 已启用但 header 未使用 java.getCookie 注入 Cookie。");
          }
        }
      } else if (rule.checkKind === "webViewScope") {
        const fields = [];
        if (source.searchUrl && /webView|webview/i.test(source.searchUrl)) fields.push("searchUrl");
        if (source.ruleBookInfo?.tocUrl && /webView|webview/i.test(source.ruleBookInfo.tocUrl)) fields.push("ruleBookInfo.tocUrl");
        if (source.ruleSearch?.bookUrl && /webView|webview/i.test(source.ruleSearch.bookUrl)) fields.push("ruleSearch.bookUrl");
        if (fields.length > 0) addIssue(rule, `${rule.message} 问题字段: ${fields.join(", ")}`);
      } else if (rule.checkKind === "textFieldsNeedAction") {
        for (const group of [source.ruleSearch, source.ruleBookInfo, source.ruleToc]) {
          if (!group || typeof group !== "object") continue;
          for (const field of rule.fields || []) {
            const val = group[field];
            if (typeof val === "string" && val.length > 0 && !val.includes("@") && !isJsonOrJsRule(val)) {
              addIssue(rule, `${field}: "${val}" — ${rule.message}`);
              break;
            }
          }
        }
      } else if (rule.checkKind === "urlFieldsNeedHref") {
        for (const group of [source.ruleSearch, source.ruleToc, source.ruleBookInfo]) {
          if (!group || typeof group !== "object") continue;
          for (const field of rule.fields || []) {
            const val = group[field];
            if (
              typeof val === "string" &&
              val.length > 0 &&
              !val.includes("@href") &&
              !val.includes("@js") &&
              !isJsonOrJsRule(val) &&
              !val.startsWith("http") &&
              !val.startsWith("/") &&
              !val.startsWith("##")
            ) {
              addIssue(rule, `${field}: "${val}" — ${rule.message}`);
              break;
            }
          }
        }
      } else if (rule.checkKind === "webJsShouldReturn") {
        if (source.ruleContent?.webJs) {
          const webJs = String(source.ruleContent.webJs);
          if (!/return|while\s*\(|sleep|document\.querySelector|querySelector/.test(webJs)) {
            addIssue(rule);
          }
        }
      }
    }
  }

  return {
    version: "1.0",
    status: errors.length > 0 ? "failed" : "passed",
    source: "official-rule-pack",
    errors,
    warnings,
    checkedRuleIds,
  };
}

function writeRuleCheck(runDir, ruleCheck) {
  writeJsonFile(path.join(runDir, "rule-check.json"), ruleCheck);
}

function detectStepBlocker(step) {
  const text = [
    step?.error || "",
    step?.errorCode || "",
    step?.response?.bodyPreview || "",
    step?.response?.title || "",
  ].join("\n");
  if (/captcha|验证码|极验|geetest/i.test(text)) return "captcha";
  if (/cloudflare|turnstile|challenge/i.test(text)) return "cloudflare";
  if (/login|登录|401|403|unauthorized|COOKIE_REQUIRED/i.test(text)) return "login";
  if (/vip|付费|订阅|paid|subscribe/i.test(text)) return "vip";
  if (/CONTENT_IS_CSR_SHELL|__nuxt|__next|webpack|vite/i.test(text)) return "csr";
  if (/ANDROID_PROBE_UNAVAILABLE/i.test(text)) return "android_unavailable";
  return step?.status === "error" ? "rule_or_network_error" : null;
}

function stepRenderKind(step) {
  if (!step) return null;
  if (step.webViewHtmlPreview || step.webViewScreenshotBase64) return "webview";
  const artifacts = step.debugArtifacts || {};
  if (artifacts["response.rendered.html"] || artifacts["screenshot.png"]) return "webview";
  if (step.response?.bodyPreview) return "ssr_or_http";
  return null;
}

function buildCapabilityMatrix(report, finalStatus) {
  const steps = report?.steps || [];
  const links = {};
  const blockers = [];
  for (const phase of LINK_PHASES) {
    const phaseSteps = steps.filter((step) => step.phase === phase);
    const failed = phaseSteps.find((step) => step.status === "error");
    const success = phaseSteps.find((step) => step.status === "success");
    const step = failed || success || null;
    const blocker = detectStepBlocker(step);
    if (blocker) blockers.push(`${phase}:${blocker}`);
    links[phase] = {
      status: success && !failed ? "success" : failed ? "blocked" : "unknown",
      blocker,
      render: phase === "content" ? stepRenderKind(step) : null,
      evidenceIds: step ? [`validator:${phase}`] : [],
    };
  }
  const allSuccess = LINK_PHASES.every((phase) => links[phase].status === "success");
  const anySuccess = LINK_PHASES.some((phase) => links[phase].status === "success");
  const overallStatus = allSuccess && finalStatus === "passed"
    ? "full_pass"
    : anySuccess
      ? "partial_candidate"
      : finalStatus || "blocked";
  return {
    version: "1.0",
    status: finalStatus || "unknown",
    links,
    overall: {
      status: overallStatus,
      fullPass: overallStatus === "full_pass",
      blockers,
    },
  };
}

function writeCapabilityMatrix(runDir, reportPath, finalStatus) {
  const report = readJsonFile(reportPath, {});
  const matrix = buildCapabilityMatrix(report, finalStatus);
  writeJsonFile(path.join(runDir, "capability-matrix.json"), matrix);
  return matrix;
}

function checkProbeCookies() {
  try {
    const raw = process.env.BSG_TEST_PROBE_COOKIE_CHECK != null
      ? process.env.BSG_TEST_PROBE_COOKIE_CHECK
      : execSync("curl -s http://localhost:18888/cookie-check 2>&1", { encoding: "utf-8", timeout: 3000 });
    const parsed = JSON.parse(raw);
    return { ok: parsed.hasCookies === true, parsed };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function loadAndValidateAssessment(runDir, state) {
  const assessPath = path.join(runDir, "assessment.md");
  if (!fileExists(assessPath)) {
    return { ok: false, error: "assessment.md 不存在，请先完成评估。" };
  }

  const content = fs.readFileSync(assessPath, "utf-8");
  const autoError = validateAssessmentAutoBlock(content);
  if (autoError) return { ok: false, error: autoError };

  const factsResult = loadSiteFacts(runDir);
  if (!factsResult.ok) return factsResult;
  const facts = factsResult.facts;
  const evidenceError = validateEvidenceNotes(content, facts);
  if (evidenceError) return { ok: false, error: evidenceError };
  const derived = deriveAssessmentFromFacts(facts);

  const userChoiceMatch = content.match(/用户选择[：:]\s*([^\n\r]+)/);
  if (userChoiceMatch) {
    const choice = userChoiceMatch[1].trim();
    const isPlaceholder = choice.includes("/") || choice.includes("或") || choice.includes("待") || choice === "";
    if (!isPlaceholder) {
      const loginDecision = state.userDecisions?.login;
      const saysNoLogin = /不登录|无账号|匿名/.test(choice);
      const saysLogin = /登录分析|已登录|登录完成/.test(choice) && !saysNoLogin;
      if (saysNoLogin && loginDecision !== "no_account") {
        return { ok: false, error: "assessment.md 写了用户选择为不登录/无账号，但 run-state.json 没有 resolve-user-action --action no_account 记录。不要编用户选择。" };
      }
      if (saysLogin && loginDecision !== "completed") {
        return { ok: false, error: "assessment.md 写了用户选择为登录/已登录，但 run-state.json 没有 resolve-user-action --action login_completed 记录。不要编用户选择。" };
      }
    }
  }

  const autoSummary = renderAssessmentAutoSummary(state, facts, derived);
  const updatedContent = replaceAssessmentAutoSummary(content, autoSummary);
  fs.writeFileSync(assessPath, updatedContent, "utf-8");

  return {
    ok: true,
    rating: derived.rating,
    signals: derived.signals,
    content: updatedContent,
    facts,
    derived,
  };
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
    const javaOk = javaMatch ? parseInt(javaMatch[1], 10) >= 17 : false;
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
    const adbMatch = adbOut.match(/Android Debug Bridge version (\S+)/);
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
      message: "⚠️ 未找到 adb。Android Probe 不可用。运行 validator/setup-android-probe.bat，由脚本检测并安装 adb。",
    });
  }

  const allOk = results.every((r) => r.ok || r.tool === "adb"); // adb is optional
  return { results, allOk };
}

// ── init ───────────────────────────────────────────────────────────────────

function cmdInit(args) {
  if (args.length < 1) {
    return fail("用法: node scripts/bsg.mjs init <site-url> [--fast] [--cwd {dir}]");
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
    return fail(/* noinspection HttpUrlsUsage */
      "站点 URL 必须以 http:// 或 https:// 开头");
  }

  const inSkillDir = isInSkillInstallDir(cwd);
  const env = checkEnvironment();

  const siteSlug = deriveSiteSlug(siteUrl);
  const runsRoot = path.join(cwd, "runs");
  const runDir = initializeRunBundle(runsRoot, siteUrl);

  const state = freshRunState(siteUrl, siteSlug, fastMode ? "fast" : "full", cwd);
  state.adbDetected = checkAdb();
  saveRunState(runDir, state);
  ensureRunArtifacts(runDir, state);

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

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

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
    nextAction = next === "assess" ? "record_assessment"
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
    pendingUserAction: getPendingUserAction(state),
    userDecisions: state.userDecisions || {},
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

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const pendingBlock = blockForPendingUserAction(state);
  if (pendingBlock) return pendingBlock;

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
    assess:  { nextAction: "record_assessment", message: "写 assessment.md 后必须先运行 record-assessment。record-assessment 通过前不要展示评估摘要，也不要 advance。" },
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
    if (state.phases.assess.recorded !== true) {
      return fail("assessment.md 尚未通过 record-assessment 记录。先运行: node scripts/bsg.mjs record-assessment --run <run-dir>。通过前不要展示评估摘要。");
    }

    // Auto-detect and validate risk labels
    const assessment = loadAndValidateAssessment(runDir, state);
    if (!assessment.ok) return fail(assessment.error);
    const assessmentSignals = assessment.signals;
    state.phases.assess.rating = assessment.rating;
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

    // Login-required sites must pass through an explicit user decision.
    if (state.loginFeatures.hasEnabledCookieJar || state.loginFeatures.hasAuthorization) {
      const android = diagnoseAndroid();
      const adbOk = android.state === "device_ready";

      if (state.userDecisions?.login === "no_account") {
        state.loginFeatures._loginDeclined = true;
        saveRunState(runDir, state);
      } else if (state.userDecisions?.login === "completed") {
        if (adbOk) {
          const probeCookies = checkProbeCookies();
          if (!probeCookies.ok) {
            return fail("Android 设备在线时，已完成登录状态必须来自 Probe /cookie-check。请重新运行登录流程，不要用 Browser Cookie 或口头确认绕过。");
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
            ? "Android 设备已在线，必须使用 Probe 原生登录："
            : "登录方式：",
          "",
          adbOk
            ? "方式1（推荐）：Probe 原生登录 — POST http://localhost:18888/login 打开手机网页登录页 → 用户在手机上输入账号密码并完成验证码/短信/扫码 → 看到已登录状态后回复 → /cookie-check 确认"
            : "",
          adbOk
            ? "Browser MCP 登录不是当前默认路径；如需改用浏览器，必须先断开/声明 Android 不可用，再按 Browser Cookie 路径继续。"
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
    } // close outer login-features if

    // WebView/CSR detected during probe/assess → check Android device now
    if ((state.loginFeatures.hasWebView || state.loginFeatures.hasWebJs) && !checkAdb() && state.userDecisions?.androidDevice !== "unavailable") {
      const android = diagnoseAndroid();
      const message = [
        "评估发现站点需要 WebView/CSR 渲染正文，但未检测到可用 Android 设备。",
        "",
        `当前 Android/adb 状态: ${android.state}。${android.message}`,
        "",
        "请确认：你是否有满足以下条件的设备？",
        "  • Android 真机（已开启 USB 调试）或 Android 模拟器",
        "  • 电脑通过 USB 数据线连接手机",
        "  • 电脑可运行 validator/setup-android-probe.bat（脚本会检测并安装 adb）",
        "",
        "如果有，请连接设备并完成授权后，再运行 resolve-user-action --action android_device_ready。",
        "如果没有 Android 设备，运行 resolve-user-action --action android_device_unavailable；后续正文验证只能标 needs_app_review / validator_limitation，不能标 passed。",
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
    writeRuleCheck(runDir, officialRuleCheck);
    if (officialRuleCheck.errors.length > 0) {
      return fail([
        "official-rule-pack 校验失败：",
        ...officialRuleCheck.errors.map((issue) => `- ${issue.ruleId}: ${issue.message}`),
      ].join("\n"));
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
// noinspection JSUnresolvedReference
      structuralErrors.push(
        `webView:true 不应出现在 ${webViewFields.join(", ")} 上。WebView 只用于渲染 CSR 正文页面，JSON API 和静态 HTML 不需要 WebView。将 webView 移到 ruleToc.chapterUrl 上。`
      );
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
        authReminder = `⚠️ analysis.md 提到 auth/登录特征但 loginFeatures 未设: ${missing.join(", ")}。请在生成书源前运行: node scripts/bsg.mjs set-login-features --run {dir}`;
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
      "2. validator/setup-android-probe.bat（单入口：检测 adb、安装 APK、启动 Probe、检查 /ping）",
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
        ? "1. 确认 validator/setup-android-probe.bat 已启动并通过 /ping"
        : "1. browser_network_requests 找到 API 请求头的 Cookie 或 Authorization",
      loggedInViaProbe
        ? "2. 运行 validate-with-validator.mjs ... android"
        : "2. 保存为 runs/<slug>/cookies.json: {\"www.example.com\": \"full_cookie_string\"}",
      loggedInViaProbe
        ? "3. 保存 validator-report.json 后运行 record-validation"
        : "3. 传给 validator: --cookie=runs/<slug>/cookies.json",
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
    ...(a.csrWebViewHint ? { csrWebViewHint: a.csrWebViewHint } : {}),
    requiredUserAction: null,
  };
}

// ── adb / Android ───────────────────────────────────────────────────────────

function parseAdbDevicesOutput(out) {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const deviceLines = lines.filter((l) => !l.startsWith("List of devices"));
  const devices = deviceLines.map((line) => {
    const parts = line.split(/\s+/);
    return { serial: parts[0] || "", state: parts[1] || "unknown", raw: line };
  }).filter((d) => d.serial);

  if (devices.some((d) => d.state === "device")) {
    return {
      state: "device_ready",
      devices,
      message: "adb 已检测到在线 Android 设备。",
      requiredUserAction: null,
    };
  }
  if (devices.some((d) => d.state === "unauthorized")) {
    return {
      state: "unauthorized",
      devices,
      message: "Android 设备未授权。请在手机上确认 USB 调试授权。",
      requiredUserAction: "authorize_usb_debugging",
    };
  }
  if (devices.some((d) => d.state === "offline")) {
    return {
      state: "offline",
      devices,
      message: "Android 设备处于 offline。请重插 USB、解锁手机，必要时重启 adb。",
      requiredUserAction: "reconnect_android_device",
    };
  }
  return {
    state: "no_device",
    devices,
    message: "未检测到 Android 真机或模拟器。",
    requiredUserAction: "confirm_android_device_available",
  };
}

function diagnoseAndroid() {
  if (process.env.BSG_TEST_ADB_DEVICES_OUTPUT != null) {
    return {
      adbFound: true,
      adbPath: "test-env",
      ...parseAdbDevicesOutput(process.env.BSG_TEST_ADB_DEVICES_OUTPUT),
    };
  }
  if (process.env.BSG_TEST_ADB_ERROR) {
    return {
      adbFound: true,
      adbPath: "test-env",
      state: "protocol_error",
      devices: [],
      message: process.env.BSG_TEST_ADB_ERROR,
      requiredUserAction: "reconnect_android_device",
    };
  }

  try {
    const out = execSync("adb devices", { encoding: "utf-8", timeout: 5000 });
    return { adbFound: true, adbPath: "adb", ...parseAdbDevicesOutput(out) };
  } catch (e) {
    const message = String(e.stderr || e.stdout || e.message || "");
    if (/not recognized|not found|ENOENT/i.test(message)) {
      return {
        adbFound: false,
        adbPath: null,
        state: "adb_missing",
        devices: [],
        message: "未找到 adb。请确认是否要运行 validator/setup-android-probe.bat，由脚本检测并安装 adb。",
        requiredUserAction: "install_adb",
      };
    }
    return {
      adbFound: true,
      adbPath: "adb",
      state: "protocol_error",
      devices: [],
      message: message || "adb devices 执行失败。",
      requiredUserAction: "reconnect_android_device",
    };
  }
}

function checkAdb() {
  return diagnoseAndroid().state === "device_ready";
}

function cmdAndroidStatus() {
  const android = diagnoseAndroid();
  return {
    ok: true,
    android,
    requiredUserAction: android.requiredUserAction,
  };
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

// ── record-assessment ──────────────────────────────────────────────────────

function cmdRecordAssessment(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs record-assessment --run {dir}");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const current = PHASE_ORDER[currentPhaseIndex(state)];
  if (current !== "assess" || state.phases.assess.status !== "in_progress") {
    return fail("record-assessment 只能在 assess 阶段 in_progress 时运行。请按 init/advance 状态机推进。");
  }

  const assessment = loadAndValidateAssessment(runDir, state);
  if (!assessment.ok) return fail(assessment.error);

  state.phases.assess.rating = assessment.rating;
  state.phases.assess.recorded = true;
  state.phases.assess.recordedAt = new Date().toISOString();
  saveRunState(runDir, state);

  return {
    ok: true,
    nextAction: "advance",
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
    },
    message: "assessment.md 已通过一致性检查并记录。现在运行 advance；如返回 requiredUserAction，先让用户确认。",
  };
}

function cmdCheck(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs check --run <run-dir>");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

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

  // Rule 5: run artifact integrity (only check if we're past generate)
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
  if (!runDir) return fail("用法: node scripts/bsg.mjs set-login-features --run {dir} [--flags <json>]");

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

  // Auto-detect from analysis.md if no explicit flags
  if (flagsIdx < 0) {
    const authInfo = detectAuthFromAnalysis(runDir);
    if (authInfo.found) {
      Object.assign(state.loginFeatures, authInfo.flags);
    }
// noinspection JSUnresolvedReference
  }

  // Also try to detect from existing book-source.json
  const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
// noinspection JSUnresolvedReference
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

// ── resolve-user-action ────────────────────────────────────────────────────

function cmdResolveUserAction(args) {
  const runDir = parseArg(args, "--run");
  const action = parseArg(args, "--action");
  if (!runDir || !action) {
    return fail("用法: node scripts/bsg.mjs resolve-user-action --run {dir} --action <android_device_ready|android_device_unavailable|login_completed|no_account|continue_after_rating_block>");
  }

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const pending = getPendingUserAction(state);
  if (!pending) return fail("当前没有待用户确认的动作。");

  const validActions = {
    android_device_needed: ["android_device_ready", "android_device_unavailable"],
    login_required: ["login_completed", "no_account"],
    rating_blocked: ["continue_after_rating_block"],
  };
  const allowed = validActions[pending.type] || [];
  if (!allowed.includes(action)) {
    return fail(`当前待处理动作为 ${pending.type}，不能用 ${action} 解除。可选: ${allowed.join(", ")}`);
  }

  state.userDecisions = state.userDecisions || {};
  if (action === "android_device_unavailable") {
    state.userDecisions.androidDevice = "unavailable";
  } else if (action === "android_device_ready") {
    const android = diagnoseAndroid();
    if (android.state !== "device_ready") {
      return fail(`Android 设备尚未可用: ${android.state}。${android.message}`);
    }
    state.userDecisions.androidDevice = "ready";
  } else if (action === "no_account") {
    state.userDecisions.login = "no_account";
    state.loginFeatures._loginDeclined = true;
  } else if (action === "login_completed") {
    const pendingAndroid = pending.details?.android;
    const android = diagnoseAndroid();
    const adbOnline = pending.details?.adbAvailable === true || pendingAndroid?.state === "device_ready" || android.state === "device_ready";
    if (adbOnline) {
      const probeCookies = checkProbeCookies();
      if (!probeCookies.ok) {
        return fail("Android 设备在线时，login_completed 必须先通过 Probe /cookie-check 确认 Cookie。请运行 validator/setup-android-probe.bat，手机登录完成后再重试。");
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
  }

  state.userActionHistory = state.userActionHistory || [];
  state.userActionHistory.push({
    type: pending.type,
    reason: pending.reason,
    action,
    resolvedAt: new Date().toISOString(),
  });
  state.pendingUserAction = { ...pending, resolved: true, action, resolvedAt: new Date().toISOString() };
  saveRunState(runDir, state);

  return {
    ok: true,
    resolved: pending.type,
    action,
    nextAction: "advance",
    message: `已记录用户选择: ${action}。继续运行 advance。`,
  };
}

// ── record-validation ──────────────────────────────────────────────────────

function cmdRecordValidation(args) {
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

  // Check: content "success" but is actually CSR shell → fake pass
  if (status === "passed") {
    const reportPath = reportPathForMode;
    if (fileExists(reportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
        const contentSteps = (report.steps || []).filter((s) => s.phase === "content");

        // P11: 优先使用 errorCode 检测 CSR 空壳
        const csrShellByCode = contentSteps.some((s) => s.errorCode === "CONTENT_IS_CSR_SHELL");
        // 保留字符串 fallback（兼容旧 validator）
        const preview = report.summary?.contentPreview || "";
        const csrShells = [
          "import.meta.url", "__nuxt", "__vite", "vite_is_modern",
          "window.__NUXT__", "<div id=\"__nuxt\"></div>", "<div id=\"app\"></div>",
          "id=\"__next\"", "_next/static", "webpackJsonp",
        ];
        const csrShellByString = csrShells.some((s) => preview.includes(s));

        if (csrShellByCode || csrShellByString) {
          // Override: this is a CSR shell, not real content
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
              // Override: reject this passed status
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
// noinspection JSUnresolvedReference
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

  // Check: book source has webView/webJs → verify via Android Probe
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
        // Check if Android mode was actually used (not HTTP fallback)
        let androidWasUsed = reportUsedAndroidMode(reportPathForMode);
        const androidWebViewWasUsed = reportUsedAndroidWebView(reportPathForMode);

        if (adbOk && !androidWasUsed) {
          // Device connected but AI didn't use it → BLOCK
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

  // Only block if android was NOT used (AI forgot). If android was used but failed, that's genuine.
  if (androidWarning) {
    const actuallyUsedAndroid = (() => {
      const rp = path.join(runDir, "validator-report.json");
      return reportUsedAndroidMode(rp);
    })();
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
  // Never had device → warning only, allow continue
  if (androidWarning) {
    state._androidWarning = androidWarning;
  }

  // Check: enabledCookieJar set but no cookies.json → likely forgot to inject
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
    // Block: don't record this as a real validation result
    v.attempts -= 1; // don't count this attempt
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
    // Convergence detection: use structured errorCode signature (P11)
    let errorSig = status;
    const reportPath = path.join(runDir, "validator-report.json");
    if (fileExists(reportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
        // Find the first failed step for convergence signature
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
          // For content phase, also include chapter URL in signature
          if (phase === "content") {
            // Try to find content steps with different chapter URLs
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

// ── deliver ────────────────────────────────────────────────────────────────

function cmdDeliverCheck(state, runDir) {
  const pending = getPendingUserAction(state);
  if (pending) {
    return fail(`仍有待用户确认动作: ${pending.type}。请先运行 resolve-user-action。`);
  }

  // Check 5 files
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
    return fail(`交付前文件不完整。缺少: ${missing.join(", ")}${summaryHint ? " " + summaryHint : ""}`);
  }

  const summaryText = fs.readFileSync(path.join(runDir, "validator-summary.md"), "utf-8");
  if (!summaryText.includes("此文件由 record-validation 生成")) {
    return fail("validator-summary.md 不是 record-validation 生成的摘要。请重新运行 record-validation，不要手写 summary。");
  }

  // Check book-source.json
  const loadedSource = loadBookSource(runDir, state);
  if (!loadedSource.ok) return fail(loadedSource.error);
  const sourceStructureError = validateBookSourceStructure(loadedSource.sources);
  if (sourceStructureError) return fail(sourceStructureError);

  const v = state.phases.validate;
  const hasLoginFeatures = Object.values(state.loginFeatures).some((b) => b === true);
  let finalStatus;
  if (!v.lastStatus) {
    return fail("缺少验证状态。必须先运行 record-validation 记录真实 validator 结果，不能仅创建 validator-report.json。");
  }

  const ruleCheck = readJsonFile(path.join(runDir, "rule-check.json"));
  if (!ruleCheck || ruleCheck.status !== "passed") {
    return fail("rule-check.json 未通过。必须先完成 generate 阶段的 official-rule-pack 校验，不能跳过规则审计。");
  }

  const matrix = readJsonFile(path.join(runDir, "capability-matrix.json"));
  if (!matrix || !matrix.overall || matrix.status === "pending") {
    return fail("capability-matrix.json 未由 record-validation 生成有效能力矩阵。请重新运行 record-validation。");
  }

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
    needs_app_review: "已生成 book-source.json，validator 检测到需 App 复核。",
    failed_unresolved: "已生成 book-source.json，同一错误连续 5 次未修复（收敛失败）。需人工检查。",
    validator_limitation: "已生成 book-source.json，validator 无法验证部分能力；预期需要 App/WebView 复核。当前不是 full pass，不能标可用。",
  };

  state.phases.deliver.status = "completed";
  saveRunState(runDir, state);

  // Check if validator is still running — remind to stop
  const pidFile = path.join(SKILL_ROOT, ".validator-pid");
  let cleanupReminder = null;
  if (fileExists(pidFile)) {
    const vPid = fs.readFileSync(pidFile, "utf-8").trim();
    cleanupReminder = `⚠ 别忘了关 validator: node scripts/bsg.mjs validator-stop (PID: ${vPid})`;
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

function cmdDeliver(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs deliver --run <run-dir>");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

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
  // Primary: read saved PID from .validator-pid file (set by validator-start)
  try {
    const pidFile = path.join(SKILL_ROOT, ".validator-pid");
    if (fileExists(pidFile)) {
      const savedPid = parseInt(fs.readFileSync(pidFile, "utf-8").trim());
      // Verify the process still exists
      try {
        // noinspection JSDeprecatedSymbols
        if (process.platform === "win32") {
          execSync(`tasklist /FI "PID eq ${savedPid}" /NH`, { encoding: "utf-8", timeout: 3000 });
          return savedPid;
        } else {
          execSync(`kill -0 ${savedPid}`, { timeout: 3000 });
          return savedPid;
        }
      } catch {
        // Process no longer exists, clean up stale file
        fs.unlinkSync(pidFile);
      }
    }
  } catch { /* fall through to netstat */ }

  // Fallback: scan port 1111 via netstat
  try {
    // noinspection JSDeprecatedSymbols
        if (process.platform === "win32") {
      const out = execSync('netstat -aon | findstr :1111 | findstr LISTENING', {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      if (!out) return null;
      const m = out.match(/(\d+)\s*$/m);
      return m ? parseInt(m[1], 10) : null;
    } else {
      const out = execSync("lsof -ti :1111", { encoding: "utf-8", timeout: 5000 }).trim();
      return out ? parseInt(out, 10) : null;
    }
  } catch {
    return null;
  }
}

function getValidatorJar() {
  const jarPath = path.join(SKILL_ROOT, "validator", "app", "legado-source-validator.jar");
  if (!fileExists(jarPath)) {
    // Try release layout
    const alt = path.join(SKILL_ROOT, "app", "legado-source-validator.jar");
    if (fileExists(alt)) return alt;
    return null;
  }
  return jarPath;
}

async function cmdValidatorStart(_args) {
  const running = await checkValidator();
  if (running) {
    const pid = findValidatorPid();
    // Save PID even when reusing existing process
    if (pid) {
      const pidFile = path.join(SKILL_ROOT, ".validator-pid");
      fs.writeFileSync(pidFile, String(pid), "utf-8");
    }
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

    // Save PID to a global file (not run-specific) so validator-stop always works
    const pidFile = path.join(SKILL_ROOT, ".validator-pid");
    fs.writeFileSync(pidFile, String(pid), "utf-8");

    return {
      ok: true,
      running: up,
      url: VALIDATOR_URL,
      pid,
      startedBySession: true,
      visibleWindow: true,
      message: up
        ? `Validator 已启动 (PID: ${pid}, ${VALIDATOR_URL})。窗口可见，用完后运行 validator-stop 关闭。`
        : `Validator 进程已创建 (PID: ${pid}) 但尚未就绪，请等待几秒后重试。`,
      stopReminder: "完成后运行: node scripts/bsg.mjs validator-stop",
    };
  } catch (e) {
    return fail(`启动 validator 失败: ${e.message}`);
  }
}

async function cmdValidatorStop() {
  const pid = findValidatorPid();

  // Clean up PID file regardless
  const pidFile = path.join(SKILL_ROOT, ".validator-pid");
  try { if (fileExists(pidFile)) fs.unlinkSync(pidFile); } catch { /* ignore */ }

  if (!pid) {
    return { ok: true, message: "未找到运行中的 validator (端口 1111)。" };
  }

  try {
    // noinspection JSDeprecatedSymbols
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
      "  node scripts/bsg.mjs status --run {dir}",
      "  node scripts/bsg.mjs advance --run {dir}",
      "  node scripts/bsg.mjs check --run {dir}",
      "  node scripts/bsg.mjs record-assessment --run {dir}",
      "  node scripts/bsg.mjs set-login-features --run {dir} [--flags <json>]",
      "  node scripts/bsg.mjs resolve-user-action --run {dir} --action <action>",
      "  node scripts/bsg.mjs record-validation --run {dir} --status <status> [--report <file>]",
      "  node scripts/bsg.mjs deliver --run {dir}",
      "  node scripts/bsg.mjs android-status",
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
    case "record-assessment":
      result = cmdRecordAssessment(args);
      break;
    case "set-login-features":
      result = cmdSetLoginFeatures(args);
      break;
    case "resolve-user-action":
      result = cmdResolveUserAction(args);
      break;
    case "android-status":
      result = cmdAndroidStatus();
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
        `未知命令: ${command}。可用: init, status, advance, check, record-assessment, set-login-features, resolve-user-action, android-status, record-validation, deliver, validator-start, validator-stop`
      );
  }

  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

// Always run main() directly — this script is the entry point, never imported.
process.exitCode = (await main(process.argv.slice(2)));
