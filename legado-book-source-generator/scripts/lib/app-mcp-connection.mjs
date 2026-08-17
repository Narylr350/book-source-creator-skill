import { execFileSync } from "node:child_process";
import { diagnoseAndroid } from "./environment.mjs";
import { parseArg } from "./state.mjs";

const DEVICE_MCP_PORT = 1236;

function onlineDevices(android) {
  return (android.devices || []).filter((device) => device.state === "device");
}

function removeForward(adbPath, serial, port, execFile = execFileSync) {
  try {
    execFile(adbPath, ["-s", serial, "forward", "--remove", `tcp:${port}`], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
  } catch {
    // The device may have disconnected after the command completed.
  }
}

export function resolveAppMcpConnection(args, dependencies = {}) {
  const explicitUrl = parseArg(args, "--url") || process.env.LEGADO_MCP_URL;
  const token = process.env.LEGADO_MCP_TOKEN || "";
  if (explicitUrl) {
    try {
      return {
        url: new URL(explicitUrl).toString(),
        token,
        transport: "direct",
        cleanup: () => {},
      };
    } catch {
      return { error: `无效的 Legado App MCP 地址: ${explicitUrl}` };
    }
  }

  const diagnose = dependencies.diagnoseAndroid || diagnoseAndroid;
  const execFile = dependencies.execFileSync || execFileSync;
  const android = diagnose();
  if (android.state !== "device_ready") {
    return {
      error: "未找到可用于 App MCP 自动连接的在线 Android 设备。",
      requiredUserAction: android.requiredUserAction || "connect_android_device",
      details: { androidState: android.state },
    };
  }

  const devices = onlineDevices(android);
  const requestedSerial = parseArg(args, "--serial") || process.env.ANDROID_SERIAL || "";
  const selected = requestedSerial
    ? devices.find((device) => device.serial === requestedSerial)
    : devices.length === 1 ? devices[0] : null;
  if (!selected) {
    return {
      error: requestedSerial
        ? `指定的 Android 设备不在线: ${requestedSerial}`
        : "检测到多个在线 Android 设备，无法确定社区版阅读所在设备。",
      requiredUserAction: "select_android_device",
      details: { devices: devices.map((device) => device.serial) },
    };
  }

  if (android.adbPath === "test-env") {
    return {
      error: "测试环境未提供 App MCP adb 转发实现。",
      requiredUserAction: "enable_app_mcp_service",
      details: { serial: selected.serial },
    };
  }

  try {
    const output = execFile(android.adbPath || "adb", [
      "-s", selected.serial, "forward", "tcp:0", `tcp:${DEVICE_MCP_PORT}`,
    ], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    const localPort = Number(String(output).trim());
    if (!Number.isInteger(localPort) || localPort <= 0 || localPort > 65535) {
      throw new Error(`adb 未返回有效本地端口: ${String(output).trim()}`);
    }
    return {
      url: `http://127.0.0.1:${localPort}/mcp`,
      token,
      transport: "adb_forward",
      serial: selected.serial,
      localPort,
      cleanup: () => removeForward(android.adbPath || "adb", selected.serial, localPort, execFile),
    };
  } catch (error) {
    return {
      error: `无法通过 adb 连接设备 App MCP: ${error.message}`,
      requiredUserAction: "enable_app_mcp_service",
      details: { serial: selected.serial, devicePort: DEVICE_MCP_PORT },
    };
  }
}

export function classifyAppMcpConnectionError(error) {
  const message = String(error?.message || error || "");
  if (/HTTP\s+(401|403)|token|unauthorized|forbidden/i.test(message)) {
    return { requiredUserAction: "provide_app_mcp_token", message };
  }
  if (/ECONNREFUSED|fetch failed|aborted|timeout|socket|connection/i.test(message)) {
    return { requiredUserAction: "enable_app_mcp_service", message };
  }
  return { requiredUserAction: "check_app_mcp_service", message };
}
