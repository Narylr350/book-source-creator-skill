import { loadBookSource } from "./facts.mjs";
import { PHASE_ORDER } from "./phase-order.mjs";
import { fail, fileSha256, loadAndVerify, parseArg, writeJsonFile } from "./state.mjs";

function activePhase(state) {
  const active = PHASE_ORDER.find((name) => state.phases[name]?.status === "in_progress");
  if (active) return active;
  return PHASE_ORDER.find((name) => state.phases[name]?.status !== "completed") || "done";
}

function firstSource(loaded) {
  return loaded.sources[0] || null;
}

function getPathValue(obj, fieldPath) {
  return fieldPath.split(".").reduce((cur, part) => cur?.[part], obj);
}

function setPathValue(obj, fieldPath, value) {
  const parts = fieldPath.split(".").filter(Boolean);
  if (parts.length < 2) throw new Error("字段路径必须类似 ruleContent.content");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (cur[part] == null) cur[part] = {};
    if (typeof cur[part] !== "object" || Array.isArray(cur[part])) {
      throw new Error(`字段路径不可写: ${fieldPath}`);
    }
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

function containsWebViewOption(value) {
  if (typeof value === "string") return /["']?webView["']?\s*:\s*true/i.test(value);
  if (Array.isArray(value)) return value.some(containsWebViewOption);
  if (value && typeof value === "object") return Object.values(value).some(containsWebViewOption);
  return false;
}

function parseValue(raw) {
  if (raw == null) return "";
  const trimmed = String(raw).trim();
  if (["true", "false", "null"].includes(trimmed) || /^[\[{"]/.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed)) {
    try { return JSON.parse(trimmed); } catch { return raw; }
  }
  return raw;
}

function inspectSource(source) {
  const fields = {
    bookSourceUrl: source.bookSourceUrl,
    searchUrl: source.searchUrl,
    loginUrl: source.loginUrl,
    enabledCookieJar: source.enabledCookieJar,
    header: source.header,
    "ruleToc.chapterUrl": getPathValue(source, "ruleToc.chapterUrl"),
    "ruleContent.content": getPathValue(source, "ruleContent.content"),
    "ruleContent.webJs": getPathValue(source, "ruleContent.webJs"),
  };
  return {
    hasWebView: containsWebViewOption(source),
    hasWebJs: !!fields["ruleContent.webJs"],
    hasLoginUrl: !!source.loginUrl,
    hasEnabledCookieJar: source.enabledCookieJar === true,
    hasAuthorization: String(source.header || "").includes("Authorization"),
    fields,
  };
}

export function cmdSource(args) {
  const subcommand = args[0];
  const runDir = parseArg(args, "--run");
  if (!subcommand || !runDir) return fail("用法: node scripts/bsg.mjs source inspect|set --run {dir}");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);
  const loaded = loadBookSource(runDir, state);
  if (!loaded.ok) return fail(loaded.error);
  const source = firstSource(loaded);
  if (!source) return fail("book-source.json 中没有书源对象。");

  const phase = activePhase(state);
  if (subcommand === "inspect") {
    const info = inspectSource(source);
    return {
      ok: true,
      phase,
      bookSourcePath: loaded.bookSourcePath,
      sourceHash: fileSha256(loaded.bookSourcePath),
      summary: {
        hasWebView: info.hasWebView,
        hasWebJs: info.hasWebJs,
        hasLoginUrl: info.hasLoginUrl,
        hasEnabledCookieJar: info.hasEnabledCookieJar,
        hasAuthorization: info.hasAuthorization,
      },
      fields: info.fields,
    };
  }

  if (subcommand === "set") {
    if (phase !== "generate") {
      return fail("source set 只能在 generate 阶段使用。validate 阶段不能修改 book-source.json。");
    }
    const fieldPath = parseArg(args, "--path");
    const rawValue = parseArg(args, "--value");
    if (!fieldPath || rawValue == null) {
      return fail("用法: node scripts/bsg.mjs source set --run {dir} --path ruleContent.content --value <value>");
    }
    try {
      setPathValue(source, fieldPath, parseValue(rawValue));
    } catch (e) {
      return fail(e.message);
    }
    writeJsonFile(loaded.bookSourcePath, loaded.parsed);
    return {
      ok: true,
      phase,
      bookSourcePath: loaded.bookSourcePath,
      sourceHash: fileSha256(loaded.bookSourcePath),
      changedField: fieldPath,
      value: getPathValue(source, fieldPath),
      nextCommand: `node scripts/bsg.mjs check --run ${runDir}`,
    };
  }

  return fail(`未知 source 子命令: ${subcommand}。可用: inspect, set`);
}
