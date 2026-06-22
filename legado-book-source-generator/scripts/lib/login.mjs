import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { SKILL_ROOT, fileExists, parseArg, fail } from "./state.mjs";

function findAdb() {
  try {
    execSync("adb version", { encoding: "utf-8", timeout: 3000 });
    return "adb";
  } catch {}

  const bundled = path.join(SKILL_ROOT, "validator", "tools", "platform-tools", "adb.exe");
  if (fileExists(bundled)) return bundled;

  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const sdkAdb = path.join(localAppData, "Android", "Sdk", "platform-tools", "adb.exe");
      if (fileExists(sdkAdb)) return sdkAdb;
    }
  } catch {}

  return null;
}

function downloadAdb() {
  const installDir = path.join(SKILL_ROOT, "validator", "tools", "platform-tools");
  const adbExe = path.join(installDir, "adb.exe");
  if (fileExists(adbExe)) return adbExe;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adb-dl-"));
  try {
    const zipPath = path.join(tmpDir, "platform-tools.zip");

    const urls = [
      "https://dl.google.com/android/repository/platform-tools-latest-windows.zip",
      "https://mirrors.cloud.tencent.com/AndroidSDK/repository/platform-tools-latest-windows.zip",
    ];

    let downloaded = false;
    for (const url of urls) {
      try {
        execSync(
          `powershell -NoProfile -Command "$p=Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}' -TimeoutSec 120; Write-Host OK"`,
          { encoding: "utf-8", timeout: 130000 }
        );
        downloaded = true;
        break;
      } catch {}
    }

    if (!downloaded) return null;

    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`,
      { encoding: "utf-8", timeout: 30000 }
    );

    const extractedAdb = path.join(tmpDir, "platform-tools", "adb.exe");
    if (!fileExists(extractedAdb)) return null;

    fs.mkdirSync(installDir, { recursive: true });
    for (const f of fs.readdirSync(path.join(tmpDir, "platform-tools"))) {
      fs.copyFileSync(path.join(tmpDir, "platform-tools", f), path.join(installDir, f));
    }

    return adbExe;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function getDeviceSerial(adb) {
  const out = execSync(`"${adb}" devices`, { encoding: "utf-8", timeout: 5000 });
  const lines = out.split(/\r?\n/).filter((l) => l.includes("\tdevice"));
  if (lines.length === 0) return null;
  return lines[0].split("\t")[0];
}

function waitForPing(_adb, _serial, retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      const out = execSync("curl -s http://127.0.0.1:18888/ping", { encoding: "utf-8", timeout: 3000 });
      if (out.includes("ok") || out.includes("pong")) return true;
    } catch {}
    execSync("ping -n 2 127.0.0.1 >nul", { shell: "cmd.exe", timeout: 2000 });
  }
  return false;
}

export function cmdLogin(args) {
  const runDir = parseArg(args, "--run");
  let targetUrl = parseArg(args, "--url");
  const clearCookies = !args.includes("--keep-cookies");
  if (!targetUrl && runDir) {
    try {
      const statePath = path.join(runDir, "run-state.json");
      const factsPath = path.join(runDir, "site-facts.json");
      if (fileExists(factsPath)) {
        const facts = JSON.parse(fs.readFileSync(factsPath, "utf-8"));
        targetUrl = facts.loginFeatures?.loginUrl || null;
      }
      if (!targetUrl && fileExists(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
        targetUrl = state.siteUrl || null;
      }
    } catch {}
  }

  let adb = findAdb();
  if (!adb) {
    adb = downloadAdb();
  }
  if (!adb) {
    return fail(
      "未找到 adb。请下载 Android SDK Platform-Tools:\n" +
      "  https://developer.android.com/studio/releases/platform-tools\n" +
      "解压后把 adb.exe 所在目录加到 PATH，或放在 validator/tools/platform-tools/ 下。"
    );
  }

  const serial = getDeviceSerial(adb);
  if (!serial) {
    return fail("未检测到 Android 设备。请连接真机（开启 USB 调试）或启动模拟器。");
  }

  const apkPath = path.join(SKILL_ROOT, "validator", "android-probe.apk");
  if (!fileExists(apkPath)) {
    return fail(`Probe APK 不存在: ${apkPath}`);
  }

  try {
    execSync(`"${adb}" -s ${serial} install -r "${apkPath}"`, { encoding: "utf-8", timeout: 30000 });
  } catch (e) {
    return fail(`安装 Probe APK 失败: ${e.stderr || e.message}`);
  }

  try {
    execSync(`"${adb}" -s ${serial} forward --remove tcp:18888`, { stdio: "ignore", timeout: 3000 });
  } catch {}

  execSync(`"${adb}" -s ${serial} shell am start -n io.legado.probe/.WebViewProbeActivity`, {
    encoding: "utf-8", timeout: 5000,
  });

  execSync(`"${adb}" -s ${serial} forward tcp:18888 tcp:18888`, {
    encoding: "utf-8", timeout: 5000,
  });

  if (!waitForPing(adb, serial)) {
    return fail("Probe 未响应 http://127.0.0.1:18888/ping。请解锁手机、确认已连接，或重试。");
  }

  let cookieClearMessage = "保留现有 Probe WebView Cookie（--keep-cookies）。";
  if (clearCookies) {
    try {
      const out = execSync("curl -s -X POST http://127.0.0.1:18888/cookie-clear", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const parsed = JSON.parse(out);
      if (parsed.ok !== true) {
        return fail(`Probe Cookie 清理失败: ${parsed.error || parsed.message || "未知错误"}`);
      }
      cookieClearMessage = "已清理 Probe WebView Cookie，登录从干净会话开始。";
    } catch (e) {
      return fail(`Probe Cookie 清理失败: ${e.message || e}`);
    }
  }

  if (targetUrl) {
    const tmpBody = path.join(os.tmpdir(), `probe-login-${Date.now()}.json`);
    try {
      fs.writeFileSync(tmpBody, JSON.stringify({ url: targetUrl }), "utf-8");
      const out = execSync(`curl -s -X POST http://127.0.0.1:18888/login -H "Content-Type: application/json" -d @${tmpBody}`, {
        encoding: "utf-8", timeout: 5000,
      });
      const parsed = JSON.parse(out);
      if (parsed.ok !== true) {
        return fail(`Probe 登录页面推送失败: ${parsed.error || parsed.message || "未知错误"}`);
      }
    } catch (e) {
      return fail(`Probe 登录页面推送失败: ${e.message || e}`);
    }
    finally { try { fs.unlinkSync(tmpBody); } catch {} }
  }

  const lines = [
    `Android Probe 已就绪 (设备: ${serial}, 端口 18888)`,
    cookieClearMessage,
  ];
  if (targetUrl) {
    lines.push(`登录页面已推送至手机: ${targetUrl}`);
  } else {
    lines.push("用法: 重新运行并指定登录 URL:");
    lines.push("  node scripts/bsg.mjs android --run <dir> --setup");
    lines.push("或通过 run 目录自动获取:");
    lines.push("  node scripts/bsg.mjs android --run <dir>");
  }
  lines.push("请在手机上完成登录（输入账号密码 + 验证码）。");
  if (runDir) {
    lines.push("登录完成后运行:");
    lines.push(`  node scripts/bsg.mjs android --run "${runDir}" --login-completed`);
  }

  return {
    ok: true,
    nextAction: "login_on_device",
    message: lines.join("\n"),
  };
}
