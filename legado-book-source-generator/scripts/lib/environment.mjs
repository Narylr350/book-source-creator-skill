import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileExists } from "./state.mjs";

// ── environment check ──────────────────────────────────────────────────────

export function checkEnvironment() {
  const results = [];

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
        message: "⚠️ 未找到 adb。Android Probe 不可用。运行 node \"<skill-dir>/scripts/bsg.mjs\" android --run <run-dir> 走 Android 单入口。",
    });
  }

  const allOk = results.every((r) => r.ok || r.tool === "adb");
  return { results, allOk };
}

// ── android / adb ──────────────────────────────────────────────────────────

export function parseAdbDevicesOutput(out) {
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
      message: "adb 已检测到在线 Android 真机或模拟器。",
      requiredUserAction: null,
    };
  }
  if (devices.some((d) => d.state === "unauthorized")) {
    return {
      state: "unauthorized",
      devices,
      message: "Android 真机或模拟器未授权。真机请确认 USB 调试授权；模拟器请确认 adb 连接状态。",
      requiredUserAction: "authorize_usb_debugging",
    };
  }
  if (devices.some((d) => d.state === "offline")) {
    return {
      state: "offline",
      devices,
      message: "Android 真机或模拟器处于 offline。真机请重插 USB、解锁手机；模拟器请重启模拟器或 adb。",
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

export function diagnoseAndroid() {
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
        message: "未找到 adb。请使用 node \"<skill-dir>/scripts/bsg.mjs\" android --run <run-dir> 走 Android 单入口。",
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

export function checkAdb() {
  return diagnoseAndroid().state === "device_ready";
}

export function cmdAndroidStatus() {
  const android = diagnoseAndroid();
  const probe = android.state === "device_ready" ? diagnoseProbe() : {
    state: "skipped",
    message: "Android 真机或模拟器未就绪，未检查 Probe。",
    requiredAction: android.requiredUserAction,
  };
  return {
    ok: true,
    android,
    probe,
    requiredUserAction: android.requiredUserAction,
  };
}

export function diagnoseProbe() {
  if (process.env.BSG_TEST_PROBE_INFO != null) {
    try {
      const info = JSON.parse(process.env.BSG_TEST_PROBE_INFO);
      return {
        state: "ready",
        ping: true,
        info,
        api: info.api || [],
        message: "Android Probe 已响应。",
        requiredAction: null,
      };
    } catch (e) {
      return {
        state: "invalid_response",
        ping: false,
        error: e.message,
        message: "Android Probe 测试响应不是合法 JSON。",
        requiredAction: "run_login",
      };
    }
  }
  if (process.env.BSG_TEST_PROBE_ERROR != null) {
    return {
      state: "not_ready",
      ping: false,
      error: process.env.BSG_TEST_PROBE_ERROR,
        message: "Android Probe 未响应 localhost:18888。运行 node \"<skill-dir>/scripts/bsg.mjs\" android --run <run-dir> 作为单入口启动 Probe。",
      requiredAction: "run_login",
    };
  }

  try {
    const ping = execSync("curl -s --max-time 3 http://127.0.0.1:18888/ping 2>&1", { encoding: "utf-8", timeout: 4000 }).trim();
    if (ping !== "pong") {
      return {
        state: "not_ready",
        ping: false,
        error: ping || "empty ping response",
        message: "Android Probe ping 未返回 pong。运行 node \"<skill-dir>/scripts/bsg.mjs\" android --run <run-dir> 作为单入口启动 Probe。",
        requiredAction: "run_login",
      };
    }
    const rawInfo = execSync("curl -s --max-time 3 http://127.0.0.1:18888/info 2>&1", { encoding: "utf-8", timeout: 4000 });
    const info = JSON.parse(rawInfo);
    return {
      state: "ready",
      ping: true,
      info,
      api: info.api || [],
      message: "Android Probe 已响应。",
      requiredAction: null,
    };
  } catch (e) {
    return {
      state: "not_ready",
      ping: false,
      error: String(e.message || e),
      message: "Android Probe 未响应 localhost:18888。运行 node \"<skill-dir>/scripts/bsg.mjs\" android --run <run-dir> 作为单入口启动 Probe。",
      requiredAction: "run_login",
    };
  }
}

// ── probe cookie check ─────────────────────────────────────────────────────

export function targetDomainFromSiteUrl(siteUrl) {
  const raw = String(siteUrl || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {}
  try {
    return new URL(`https://${raw}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function buildProbeCookieCheckUrl(siteUrl) {
  const domain = targetDomainFromSiteUrl(siteUrl);
  if (!domain) throw new Error("Probe cookie-check requires a target domain");
  return `http://localhost:18888/cookie-check?domain=${encodeURIComponent(domain)}`;
}

export function probeCookieCheckDomains(siteUrl) {
  const domain = targetDomainFromSiteUrl(siteUrl);
  if (!domain) return [];
  const domains = [domain];
  const base = domain.startsWith("www.") ? domain.slice(4) : domain;
  for (const candidate of [`wap.${base}`, `m.${base}`, base]) {
    if (!domains.includes(candidate)) domains.push(candidate);
  }
  return domains;
}

function probeCookieCheckUrlForDomain(domain) {
  return `http://localhost:18888/cookie-check?domain=${encodeURIComponent(domain)}`;
}

export function cookieNamesFromString(cookieString) {
  return String(cookieString || "")
    .split(";")
    .map((part) => part.split("=")[0]?.trim().toLowerCase())
    .filter(Boolean);
}

function cookieStringHasLoginEvidence(cookieString) {
  return cookieNamesFromString(cookieString)
    .some((name) => /(^|[_-])(login|auth|token|user|uid|reader|member|account)([_-]|$)/.test(name || ""));
}

export function hasProbeLoginEvidence(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.authenticated === true || parsed.loggedIn === true || parsed.isLoggedIn === true) return true;
  if (parsed.hasLoginEvidence === true) return true;
  if (typeof parsed.sessionMode === "string" && parsed.sessionMode && parsed.sessionMode !== "anonymous") return true;
  if (typeof parsed.user === "string" && parsed.user.trim()) return true;
  if (parsed.user && typeof parsed.user === "object" && Object.keys(parsed.user).length > 0) return true;
  if (typeof parsed.account === "string" && parsed.account.trim()) return true;
  if (parsed.account && typeof parsed.account === "object" && Object.keys(parsed.account).length > 0) return true;
  return cookieStringHasLoginEvidence(parsed.cookies || parsed.cookie || "");
}

export function probeCookieResultDomain(parsed, fallbackSiteUrl = "") {
  for (const value of [parsed?.url, parsed?.domain]) {
    const domain = targetDomainFromSiteUrl(value || "");
    if (domain) return domain;
  }
  return targetDomainFromSiteUrl(fallbackSiteUrl);
}

export function probeCookieResultNames(parsed) {
  if (Array.isArray(parsed?.cookieNames)) {
    return parsed.cookieNames.map((name) => String(name).trim()).filter(Boolean);
  }
  return cookieNamesFromString(parsed?.cookies || parsed?.cookie || "");
}

export function summarizeProbeCookieCheck(siteUrl, result) {
  const parsed = result?.parsed || {};
  return {
    selectedDomain: probeCookieResultDomain(parsed, siteUrl),
    selectedUrl: parsed.url || null,
    checkedDomains: result?.checkedDomains || probeCookieCheckDomains(siteUrl),
    hasCookies: parsed.hasCookies === true,
    hasLoginEvidence: hasProbeLoginEvidence(parsed),
    cookieNames: probeCookieResultNames(parsed),
  };
}

export function selectBestProbeCookieResult(siteUrl, results) {
  const candidates = probeCookieCheckDomains(siteUrl);
  let firstCookieResult = null;
  let firstResult = null;
  for (const result of results) {
    if (!result) continue;
    if (!firstResult) firstResult = result;
    const parsed = result.parsed || {};
    const checkedDomain = targetDomainFromSiteUrl(parsed.url || parsed.domain || "");
    if (checkedDomain && !candidates.includes(checkedDomain)) continue;
    if (hasProbeLoginEvidence(parsed)) return result;
    if (!firstCookieResult && parsed.hasCookies === true) firstCookieResult = result;
  }
  return firstCookieResult || firstResult || { ok: false, error: "Probe cookie-check returned no result" };
}

export function checkProbeCookies(siteUrl) {
  try {
    const domains = probeCookieCheckDomains(siteUrl);
    if (domains.length === 0) return { ok: false, error: "Probe cookie-check requires a target domain" };
    if (process.env.BSG_TEST_PROBE_COOKIE_CHECK != null) {
      const parsed = JSON.parse(process.env.BSG_TEST_PROBE_COOKIE_CHECK);
      return { ok: parsed.hasCookies === true, parsed, checkedDomains: domains };
    }
    const results = domains.map((domain) => {
      try {
        const raw = execSync(`curl -s "${probeCookieCheckUrlForDomain(domain)}" 2>&1`, { encoding: "utf-8", timeout: 3000 });
        const parsed = JSON.parse(raw);
        return { ok: parsed.hasCookies === true, parsed };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    });
    const best = selectBestProbeCookieResult(siteUrl, results);
    return { ...best, ok: best.parsed?.hasCookies === true, checkedDomains: domains };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// ── auth detection from analysis ───────────────────────────────────────────

export function detectAuthFromAnalysis(runDir) {
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
