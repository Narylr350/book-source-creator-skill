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
      message: "⚠️ 未找到 adb。Android Probe 不可用。运行 node scripts/bsg.mjs login，由脚本检测并安装 adb。",
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
        message: "未找到 adb。请确认是否要运行 node scripts/bsg.mjs login，由脚本检测并安装 adb。",
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
  return {
    ok: true,
    android,
    requiredUserAction: android.requiredUserAction,
  };
}

// ── probe cookie check ─────────────────────────────────────────────────────

export function checkProbeCookies() {
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
