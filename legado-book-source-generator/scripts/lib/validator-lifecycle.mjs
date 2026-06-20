import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { SKILL_ROOT, VALIDATOR_URL, fail, fileExists } from "./state.mjs";

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
  try {
    const pidFile = path.join(SKILL_ROOT, ".validator-pid");
    if (fileExists(pidFile)) {
      const savedPid = parseInt(fs.readFileSync(pidFile, "utf-8").trim());
      try {
        if (process.platform === "win32") {
          execSync(`tasklist /FI "PID eq ${savedPid}" /NH`, { encoding: "utf-8", timeout: 3000 });
          return savedPid;
        }
        execSync(`kill -0 ${savedPid}`, { timeout: 3000 });
        return savedPid;
      } catch {
        fs.unlinkSync(pidFile);
      }
    }
  } catch { /* fall through to netstat */ }

  try {
    if (process.platform === "win32") {
      const out = execSync('netstat -aon | findstr :1111 | findstr LISTENING', {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      if (!out) return null;
      const m = out.match(/(\d+)\s*$/m);
      return m ? parseInt(m[1], 10) : null;
    }
    const out = execSync("lsof -ti :1111", { encoding: "utf-8", timeout: 5000 }).trim();
    return out ? parseInt(out, 10) : null;
  } catch {
    return null;
  }
}

function getValidatorJar() {
  const jarPath = path.join(SKILL_ROOT, "validator", "app", "legado-source-validator.jar");
  if (!fileExists(jarPath)) {
    const alt = path.join(SKILL_ROOT, "app", "legado-source-validator.jar");
    if (fileExists(alt)) return alt;
    return null;
  }
  return jarPath;
}

export async function cmdValidatorStart(_args) {
  const running = await checkValidator();
  if (running) {
    const pid = findValidatorPid();
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
    const child = spawn("java", ["-jar", jarPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();

    await new Promise((r) => setTimeout(r, 3000));

    const up = await checkValidator();
    const pid = child.pid;

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

export async function cmdValidatorStop() {
  const pid = findValidatorPid();

  const pidFile = path.join(SKILL_ROOT, ".validator-pid");
  try { if (fileExists(pidFile)) fs.unlinkSync(pidFile); } catch { /* ignore */ }

  if (!pid) {
    return { ok: true, message: "未找到运行中的 validator (端口 1111)。" };
  }

  try {
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
