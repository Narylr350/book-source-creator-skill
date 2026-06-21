import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = path.resolve(__dirname, "..", "..");
// noinspection JSUnresolvedReference
export const VALIDATOR_URL = process.env.VALIDATOR_URL || "http://localhost:1111";
export const OFFICIAL_RULE_PACK_PATH = path.join(SKILL_ROOT, "references", "official-rule-pack.json");
export const LINK_PHASES = ["search", "detail", "toc", "content"];

// ── pure utils ─────────────────────────────────────────────────────────────

export function fail(message) {
  return { ok: false, error: message };
}

export function fileExists(filePath) {
  try { fs.statSync(filePath); return true; } catch { return false; }
}

export function parseArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  return args[idx + 1] || null;
}

export function readJsonFile(filePath, fallback = null) {
  if (!fileExists(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function fileSha256(filePath) {
  if (!fileExists(filePath)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function emptyLinks() {
  return Object.fromEntries(LINK_PHASES.map((phase) => [
    phase,
    { status: "unknown", blocker: null, render: null, evidenceIds: [] },
  ]));
}

export function normalizeLinkStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (["success", "ok", "passed", "pass"].includes(value)) return "success";
  if (["blocked", "block", "captcha", "login_required"].includes(value)) return "blocked";
  if (["failed", "fail", "error"].includes(value)) return "failed";
  return value || "unknown";
}

export function getEvidenceIds(facts) {
  const ids = new Set();
  for (const item of facts?.evidence || []) {
    if (item?.id) ids.add(item.id);
  }
  for (const phase of LINK_PHASES) {
    for (const id of facts?.links?.[phase]?.evidenceIds || []) ids.add(id);
  }
  return ids;
}

// ── run-state I/O ──────────────────────────────────────────────────────────

export function isInSkillInstallDir(cwd) {
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

export function loadRunState(runDir) {
  const p = path.join(runDir, "run-state.json");
  if (!fileExists(p)) return null;
  const raw = fs.readFileSync(p, "utf-8");
  const state = JSON.parse(raw);
  if (state._signature) {
    const expected = signState(state);
    if (state._signature !== expected) {
      return { _tampered: true };
    }
  }
  return state;
}

export function saveRunState(runDir, state) {
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

export function freshRunState(siteUrl, siteSlug, mode, workingDir) {
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
      adbDetected: false,
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

export function ensureRunArtifacts(runDir, state) {
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

export function loadAndVerify(runDir) {
  const state = loadRunState(runDir);
  if (!state) return { state: null, error: `未找到 run-state.json: ${runDir}` };
  if (state._tampered) {
    return { state: null, error: "⛔ run-state.json 被手动编辑过。所有修改必须通过 bsg.mjs 命令。删除 runs/<slug>/ 重新 init。" };
  }
  ensureRunArtifacts(runDir, state);
  return { state, error: null };
}

// ── pending user actions ───────────────────────────────────────────────────

export function getPendingUserAction(state) {
  return state.pendingUserAction && state.pendingUserAction.resolved !== true
    ? state.pendingUserAction
    : null;
}

export function setPendingUserAction(state, type, reason, message, details = {}) {
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

export function pendingUserActionResponse(action) {
  return {
    ok: true,
    nextAction: "stop",
    requiredUserAction: action.type,
    message: action.message,
    reason: action.reason,
    pendingUserAction: action,
  };
}

export function blockForPendingUserAction(state) {
  const action = getPendingUserAction(state);
  if (!action) return null;
  return pendingUserActionResponse(action);
}

export function printHint(correctiveAction, nextCommand) {
  if (!correctiveAction && !nextCommand) return;
  const parts = ["## 下一步", ""];
  if (correctiveAction) parts.push(correctiveAction, "");
  if (nextCommand) parts.push(`运行：${nextCommand}`);
  process.stderr.write(parts.join("\n") + "\n");
}
