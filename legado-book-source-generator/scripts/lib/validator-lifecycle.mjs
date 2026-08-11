import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { SKILL_ROOT, fail, fileExists } from "./state.mjs";
import {
  isProcessAlive,
  readValidatorRuntime,
  removeValidatorRuntime,
  reserveAvailablePort,
  resolveValidatorUrl,
  writeValidatorRuntime,
} from "./validator-runtime.mjs";

async function checkValidator(url) {
  if (!url) return false;
  try {
    const res = await fetch(`${url}/api/sources`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function getValidatorJar() {
  const jarPath = path.join(SKILL_ROOT, "validator", "app", "legado-source-validator.jar");
  if (fileExists(jarPath)) return jarPath;
  const alt = path.join(SKILL_ROOT, "app", "legado-source-validator.jar");
  return fileExists(alt) ? alt : null;
}

function cleanupRuntimeFiles(runtime) {
  removeValidatorRuntime();
  if (runtime?.logPath) {
    try { fs.unlinkSync(runtime.logPath); } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function readLogTail(logPath, maxLines = 30) {
  try {
    return fs.readFileSync(logPath, "utf-8").trim().split(/\r?\n/).slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

async function waitUntilReady(url, child, spawnError, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError.value) return { ready: false, error: spawnError.value };
    if (child.exitCode != null || !isProcessAlive(child.pid)) {
      return { ready: false, error: new Error(`validator process exited with code ${child.exitCode ?? "unknown"}`) };
    }
    if (await checkValidator(url)) return { ready: true };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ready: false, error: new Error(`validator did not become ready within ${timeoutMs}ms`) };
}

function configuredPort() {
  const configured = String(process.env.VALIDATOR_URL || "").trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    const port = Number(parsed.port);
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return null;
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export async function cmdValidatorStart() {
  const configuredUrl = String(process.env.VALIDATOR_URL || "").trim().replace(/\/$/, "");
  if (configuredUrl && await checkValidator(configuredUrl)) {
    return {
      ok: true,
      running: true,
      external: true,
      url: configuredUrl,
      pid: null,
      message: `Validator 已在运行 (${configuredUrl})。复用当前配置的服务。`,
    };
  }

  const existing = readValidatorRuntime();
  if (existing) {
    if (isProcessAlive(existing.pid) && await checkValidator(existing.url)) {
      return {
        ok: true,
        running: true,
        url: existing.url,
        pid: existing.pid,
        message: `Validator 已在运行 (PID: ${existing.pid}, ${existing.url})。复用现有服务。`,
      };
    }
    cleanupRuntimeFiles(existing);
  }

  const jarPath = getValidatorJar();
  if (!jarPath) {
    return fail("找不到 legado-source-validator.jar。请确认 validator/app/ 目录存在。");
  }

  const fixedPort = configuredPort();
  if (configuredUrl && !fixedPort) {
    return fail(`VALIDATOR_URL 必须是带端口的本机地址，当前值: ${configuredUrl}`);
  }
  const port = fixedPort || await reserveAvailablePort();
  const url = configuredUrl || `http://127.0.0.1:${port}`;
  const logPath = path.join(os.tmpdir(), `legado-validator-${process.pid}-${Date.now()}.log`);
  let logFd = null;
  let child = null;

  try {
    logFd = fs.openSync(logPath, "a");
    child = spawn("java", ["-jar", jarPath, "--port", String(port)], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    const spawnError = { value: null };
    child.once("error", (error) => { spawnError.value = error; });
    child.unref();
    fs.closeSync(logFd);

    const result = await waitUntilReady(url, child, spawnError);
    if (!result.ready) {
      if (isProcessAlive(child.pid)) {
        try {
          if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/F"], { timeout: 5000 });
          else process.kill(child.pid, "SIGTERM");
        } catch { /* process may already be gone */ }
      }
      const logTail = readLogTail(logPath);
      try { fs.unlinkSync(logPath); } catch { /* ignore */ }
      return fail([
        `启动 validator 失败: ${result.error?.message || "unknown error"}`,
        logTail ? `JVM 输出:\n${logTail}` : "JVM 未产生可用输出。",
      ].join("\n"));
    }

    const runtime = {
      pid: child.pid,
      port,
      url,
      logPath,
      startedAt: new Date().toISOString(),
    };
    writeValidatorRuntime(runtime);
    return {
      ok: true,
      running: true,
      url,
      pid: child.pid,
      startedBySession: true,
      message: `Validator 已启动 (PID: ${child.pid}, ${url})。用完后运行 validator-stop 关闭。`,
      stopReminder: "完成后运行: node \"<skill-dir>/scripts/bsg.mjs\" validator-stop",
    };
  } catch (error) {
    if (isProcessAlive(child?.pid)) {
      try {
        if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/F"], { timeout: 5000 });
        else process.kill(child.pid, "SIGTERM");
      } catch { /* process may already be gone */ }
    }
    if (logFd != null) {
      try { fs.closeSync(logFd); } catch { /* already closed */ }
    }
    try { fs.unlinkSync(logPath); } catch { /* ignore */ }
    removeValidatorRuntime();
    return fail(`启动 validator 失败: ${error.message}`);
  }
}

export async function cmdValidatorStop() {
  const runtime = readValidatorRuntime();
  if (!runtime) {
    return { ok: true, message: "未找到由当前 Skill 启动的 validator。" };
  }

  if (!isProcessAlive(runtime.pid)) {
    cleanupRuntimeFiles(runtime);
    return { ok: true, message: `Validator 进程已结束，已清理过期运行记录 (PID: ${runtime.pid})。` };
  }

  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(runtime.pid), "/F"], { timeout: 5000 });
    } else {
      process.kill(runtime.pid, "SIGTERM");
    }
    cleanupRuntimeFiles(runtime);
    return { ok: true, message: `Validator 已停止 (PID: ${runtime.pid})。` };
  } catch (error) {
    return fail(`停止 validator 失败: ${error.message}`);
  }
}

export { checkValidator, resolveValidatorUrl };
