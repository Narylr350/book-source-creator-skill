import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  fail, parseArg, fileExists, loadAndVerify, saveRunState,
  getPendingUserAction, setPendingUserAction, pendingUserActionResponse,
} from "./state.mjs";
import { diagnoseAndroid, diagnoseProbe } from "./environment.mjs";
import { cmdLogin } from "./login.mjs";
import { cmdValidate } from "./validate-runner.mjs";
import { cmdRecordValidation } from "./validation-commands.mjs";
import { cmdResolveUserAction } from "./assessment-commands.mjs";

function androidCommand(runDir, extra = "") {
  return `node "<skill-dir>/scripts/bsg.mjs" android --run "${runDir}"${extra}`;
}

function currentSourceHash(state) {
  const sourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (!fileExists(sourcePath)) return null;
  return createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
}

function reportForRun(runDir, state) {
  const reportPath = path.join(runDir, "validator-report.json");
  if (!fileExists(reportPath)) return null;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    if (report?._generatedBy !== "validate-with-validator.mjs" || report.status === "skipped") return null;
    if (report.mode !== "android") return null;
    const sourceHash = currentSourceHash(state);
    if (sourceHash && report._sourceHash && report._sourceHash !== sourceHash) return null;
    return report;
  } catch {
    return null;
  }
}

function recordAndroidReady(state, pending) {
  state.userDecisions = state.userDecisions || {};
  state.userDecisions.androidDevice = "ready";
  if (pending.type === "android_entry_review_needed") {
    state.userDecisions.entryRisk = "android_ready";
  }
  state.userActionHistory = state.userActionHistory || [];
  state.userActionHistory.push({
    type: pending.type,
    reason: pending.reason,
    action: "android_device_ready",
    resolvedAt: new Date().toISOString(),
    via: "android",
  });
  state.pendingUserAction = null;
}

export function cmdAndroid(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" android --run <run-dir> [--setup]");

  if (args.includes("--no-device")) {
    const resolved = cmdResolveUserAction(["--run", runDir, "--action", "android_device_unavailable"]);
    return {
      ...resolved,
      via: "android:no-device",
      nextCommand: `node "<skill-dir>/scripts/bsg.mjs" run --run "${runDir}"`,
    };
  }

  if (args.includes("--login-completed")) {
    const resolved = cmdResolveUserAction(["--run", runDir, "--action", "login_completed"]);
    return {
      ...resolved,
      via: "android:login-completed",
      nextCommand: androidCommand(runDir),
    };
  }

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const android = diagnoseAndroid();
  const pending = getPendingUserAction(state);
  if (pending) {
    if (["android_device_needed", "android_entry_review_needed"].includes(pending.type)) {
      if (android.state === "device_ready") {
        recordAndroidReady(state, pending);
        saveRunState(runDir, state);
      } else {
        return {
          ...pendingUserActionResponse(pending),
          android,
          nextCommand: androidCommand(runDir),
          fallbackCommand: androidCommand(runDir, " --no-device"),
        };
      }
    } else if (pending.type === "login_required") {
      if (!args.includes("--setup")) {
        if (android.state !== "device_ready") {
          return {
            ...pendingUserActionResponse(pending),
            android,
            nextCommand: androidCommand(runDir),
            fallbackCommand: androidCommand(runDir, " --no-device"),
          };
        }
        return {
          ok: true,
          nextAction: "open_android_login",
          requiredUserAction: "login_required",
          message: "当前等待登录。常规流程使用 Android 单入口打开手机/模拟器登录页；用户完成登录后再运行 android --login-completed。只有脚本失败或用户要求调试时才展开底层 adb/Probe/validator 子步骤，调试后仍回到 android --run 收敛。",
          android,
          pendingUserAction: pending,
          nextCommand: androidCommand(runDir, " --setup"),
          afterUserCommand: androidCommand(runDir, " --login-completed"),
        };
      }
    } else {
      return {
        ...pendingUserActionResponse(pending),
        nextCommand: `node "<skill-dir>/scripts/bsg.mjs" run --run "${runDir}"`,
      };
    }
  }

  if (android.state !== "device_ready") {
    const pending = setPendingUserAction(
      state,
      "android_device_needed",
      android.state,
      "需要 Android 真机或模拟器才能进行 Android/Probe/WebView 验证。请连接真机、开启 USB 调试并授权，或启动模拟器；如果没有设备，请明确说明 Android 不可用。",
      { android },
    );
    saveRunState(runDir, state);
    return {
      ...pendingUserActionResponse(pending),
      android,
      nextCommand: androidCommand(runDir),
      fallbackCommand: androidCommand(runDir, " --no-device"),
    };
  }

  if (args.includes("--setup")) {
    const result = cmdLogin(["--run", runDir]);
    if (!result.ok) {
      return {
        ...result,
        via: "android:setup",
        nextCommand: androidCommand(runDir),
      };
    }
    const pending = setPendingUserAction(
      state,
      "login_required",
      "android_probe_login",
      "Android Probe 已打开登录页。请在手机或模拟器内完成账号登录和验证码；完成后运行 android --login-completed，由 Probe Cookie 证明登录态。",
      { android, adbAvailable: true, via: "android:setup" },
    );
    saveRunState(runDir, state);
    return {
      ...result,
      via: "android:setup",
      requiredUserAction: "login_required",
      pendingUserAction: pending,
      nextCommand: androidCommand(runDir, " --login-completed"),
    };
  }

  const probe = diagnoseProbe();
  if (probe.state !== "ready") {
    return {
      ok: true,
      nextAction: "setup_android_probe",
      android,
      probe,
      message: "Android 设备已就绪，但 Probe 未运行。常规流程运行 Android 单入口的 setup 模式启动 Probe；如 setup 失败再展开底层 adb/Probe 诊断，不能直接退回 HTTP 交付。",
      nextCommand: androidCommand(runDir, " --setup"),
    };
  }

  const report = reportForRun(runDir, state);
  if (report) {
    const recorded = cmdRecordValidation(["--run", runDir, "--status", report.status]);
    return {
      ...recorded,
      via: "record-validation",
      android,
      probe,
      nextCommand: recorded.nextCommand || `node "<skill-dir>/scripts/bsg.mjs" run --run ${runDir}`,
    };
  }

  const validated = cmdValidate(["--run", runDir, "--mode", "android"]);
  if (!validated.ok) return validated;
  if (validated.status === "skipped") {
    return {
      ...validated,
      via: "validate",
      android,
      probe,
      nextCommand: androidCommand(runDir),
    };
  }
  return {
    ...validated,
    via: "validate",
    android,
    probe,
    nextCommand: androidCommand(runDir),
  };
}
