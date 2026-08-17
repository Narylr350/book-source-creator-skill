import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAppMcpConnection } from "../scripts/lib/app-mcp-connection.mjs";

function readyAndroid(devices = [{ serial: "emulator-5554", state: "device" }]) {
  return {
    adbFound: true,
    adbPath: "adb",
    state: "device_ready",
    devices,
    requiredUserAction: null,
  };
}

describe("App MCP connection resolution", () => {
  it("uses an explicit URL directly without requiring a token", () => {
    const result = resolveAppMcpConnection(["--url", "http://192.168.1.20:1236/mcp"]);
    assert.equal(result.url, "http://192.168.1.20:1236/mcp");
    assert.equal(result.token, "");
    assert.equal(result.transport, "direct");
  });

  it("forwards the App MCP port for one online adb device and removes it afterward", () => {
    const calls = [];
    const result = resolveAppMcpConnection([], {
      diagnoseAndroid: () => readyAndroid(),
      execFileSync: (_adb, args) => {
        calls.push(args);
        return args.includes("--remove") ? "" : "21781\n";
      },
    });

    assert.equal(result.url, "http://127.0.0.1:21781/mcp");
    assert.equal(result.transport, "adb_forward");
    assert.equal(result.serial, "emulator-5554");
    result.cleanup();
    assert.deepEqual(calls, [
      ["-s", "emulator-5554", "forward", "tcp:0", "tcp:1236"],
      ["-s", "emulator-5554", "forward", "--remove", "tcp:21781"],
    ]);
  });

  it("requires device selection when several adb devices are online", () => {
    const result = resolveAppMcpConnection([], {
      diagnoseAndroid: () => readyAndroid([
        { serial: "emulator-5554", state: "device" },
        { serial: "device-1", state: "device" },
      ]),
    });
    assert.equal(result.requiredUserAction, "select_android_device");
    assert.deepEqual(result.details.devices, ["emulator-5554", "device-1"]);
  });

  it("uses --serial to choose one of several adb devices", () => {
    const result = resolveAppMcpConnection(["--serial", "device-1"], {
      diagnoseAndroid: () => readyAndroid([
        { serial: "emulator-5554", state: "device" },
        { serial: "device-1", state: "device" },
      ]),
      execFileSync: () => "21900\n",
    });
    assert.equal(result.serial, "device-1");
    assert.equal(result.url, "http://127.0.0.1:21900/mcp");
  });
});
