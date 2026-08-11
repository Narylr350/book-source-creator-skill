import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { SKILL_ROOT } from "./state.mjs";

export const VALIDATOR_RUNTIME_FILE = path.join(SKILL_ROOT, ".validator-runtime.json");

export function readValidatorRuntime() {
  try {
    const runtime = JSON.parse(fs.readFileSync(VALIDATOR_RUNTIME_FILE, "utf-8"));
    if (!runtime?.url || !Number.isInteger(runtime?.port)) return null;
    return runtime;
  } catch {
    return null;
  }
}

export function removeValidatorRuntime() {
  try {
    fs.unlinkSync(VALIDATOR_RUNTIME_FILE);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function writeValidatorRuntime(runtime) {
  fs.writeFileSync(VALIDATOR_RUNTIME_FILE, `${JSON.stringify(runtime, null, 2)}\n`, "utf-8");
}

export function resolveValidatorUrl() {
  const configured = String(process.env.VALIDATOR_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return readValidatorRuntime()?.url || null;
}

export async function reserveAvailablePort(host = "127.0.0.1") {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Failed to allocate validator port"));
        else resolve(port);
      });
    });
  });
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
