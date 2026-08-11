import os from "node:os";
import { execFileSync } from "node:child_process";

function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

export function parseProxySetting(rawValue, source = "unknown") {
  const raw = String(rawValue || "").trim();
  if (!raw || /^(null|none|direct|:0)$/i.test(raw)) {
    return { state: "none", source, raw: raw || null };
  }

  let selected = raw;
  if (raw.includes(";")) {
    const entries = Object.fromEntries(raw.split(";").map((entry) => entry.split("=", 2)).filter((entry) => entry.length === 2));
    selected = entries.https || entries.http || entries.socks || raw;
  }

  const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(selected);
  try {
    const parsed = new URL(explicitScheme ? selected : `http://${selected}`);
    const scheme = parsed.protocol.replace(":", "").toLowerCase();
    const port = parsePort(parsed.port || (scheme === "https" ? "443" : "80"));
    if (!parsed.hostname || !port) throw new Error("missing host or port");
    return {
      state: "configured",
      source,
      raw,
      scheme,
      host: parsed.hostname,
      port,
      hasCredentials: Boolean(parsed.username || parsed.password),
    };
  } catch {
    return { state: "unusable", source, raw, reason: "invalid_proxy_setting" };
  }
}

function readRegistryValue(name) {
  try {
    const output = execFileSync("reg.exe", [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      "/v",
      name,
    ], { encoding: "utf-8", timeout: 3000 });
    const match = output.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)$`, "mi"));
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

export function detectTunnelInterfaces(networkInterfaces = os.networkInterfaces()) {
  const matches = [];
  for (const [name, addresses] of Object.entries(networkInterfaces || {})) {
    const nameLooksLikeTunnel = /(^|\b)(tun|wintun|mihomo|clash|sing|meta tunnel|wireguard)(\b|$)/i.test(name);
    const hasFakeIpRange = (addresses || []).some((item) => {
      if (item?.family !== "IPv4") return false;
      const parts = String(item.address || "").split(".").map(Number);
      return parts.length === 4 && parts[0] === 198 && [18, 19].includes(parts[1]);
    });
    if (nameLooksLikeTunnel || hasFakeIpRange) matches.push(name);
  }
  return matches;
}

function curlExecutable() {
  return process.platform === "win32" ? "curl.exe" : "curl";
}

export function probeLoopbackHttpProxy(port) {
  try {
    execFileSync(curlExecutable(), [
      "-sS", "-I", "--max-time", "3",
      "--proxy", `http://127.0.0.1:${port}`,
      "https://example.com/",
    ], { encoding: "utf-8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

export function detectTunnelProxy(
  networkInterfaces = os.networkInterfaces(),
  probe = probeLoopbackHttpProxy,
  candidatePorts = [7890, 7891, 7892, 1080, 8080, 8888],
) {
  const interfaces = detectTunnelInterfaces(networkInterfaces);
  if (interfaces.length === 0) return null;
  for (const port of candidatePorts) {
    if (probe(port)) {
      return {
        state: "configured",
        source: `tunnel:${interfaces.join(",")}`,
        raw: `http://127.0.0.1:${port}`,
        scheme: "http",
        host: "127.0.0.1",
        port,
        hasCredentials: false,
        tunnel: true,
        tunnelInterfaces: interfaces,
      };
    }
  }
  return {
    state: "tunnel_unmapped",
    source: `tunnel:${interfaces.join(",")}`,
    raw: null,
    tunnel: true,
    tunnelInterfaces: interfaces,
    reason: "no_loopback_http_proxy",
  };
}

export function detectHostProxy(environment = process.env, allowSystemLookup = true, options = {}) {
  const candidates = [
    ["HTTPS_PROXY", environment.HTTPS_PROXY ?? environment.https_proxy],
    ["HTTP_PROXY", environment.HTTP_PROXY ?? environment.http_proxy],
    ["ALL_PROXY", environment.ALL_PROXY ?? environment.all_proxy],
  ];
  for (const [name, value] of candidates) {
    if (String(value || "").trim()) return parseProxySetting(value, `environment:${name}`);
  }

  if (process.platform === "win32" && allowSystemLookup) {
    const enabled = readRegistryValue("ProxyEnable");
    if (enabled && !/0x0\b/i.test(enabled)) {
      return parseProxySetting(readRegistryValue("ProxyServer"), "windows:internet-settings");
    }
  }

  const tunnel = detectTunnelProxy(
    options.networkInterfaces || os.networkInterfaces(),
    options.probeTunnelProxy || probeLoopbackHttpProxy,
    options.tunnelCandidatePorts || [7890, 7891, 7892, 1080, 8080, 8888],
  );
  return tunnel || { state: "none", source: "none", raw: null };
}

export function parseAndroidProxy(rawValue) {
  const parsed = parseProxySetting(rawValue, "android:global-http-proxy");
  if (parsed.state === "configured") {
    return { ...parsed, scheme: "http" };
  }
  return parsed;
}

export function planAndroidProxySync(hostProxy, androidProxy, serial) {
  const emulator = /^emulator-\d+$/i.test(String(serial || ""));
  if (hostProxy.state === "none") {
    if (androidProxy.state === "none") {
      return {
        state: "consistent",
        consistent: true,
        autoConfigurable: false,
        emulator,
        requiredAction: null,
      };
    }
    if (emulator && androidProxy.state === "configured") {
      return {
        state: "emulator_proxy_clear_required",
        consistent: false,
        autoConfigurable: true,
        clear: true,
        emulator: true,
        requiredAction: "clear_emulator_proxy",
      };
    }
    return {
      state: "host_direct_android_proxy_review_required",
      consistent: false,
      autoConfigurable: false,
      emulator,
      requiredAction: emulator ? "configure_android_network" : "review_physical_device_proxy",
    };
  }
  if (hostProxy.state !== "configured") {
    return {
      state: "host_proxy_unusable",
      consistent: false,
      autoConfigurable: false,
      emulator,
      requiredAction: "configure_android_network",
    };
  }
  if (!["http", "https"].includes(hostProxy.scheme) || hostProxy.hasCredentials) {
    return {
      state: "host_proxy_not_android_compatible",
      consistent: false,
      autoConfigurable: false,
      emulator,
      requiredAction: "configure_android_network",
    };
  }
  if (!emulator) {
    return {
      state: "physical_device_proxy_review_required",
      consistent: false,
      autoConfigurable: false,
      emulator: false,
      requiredAction: "configure_physical_device_proxy",
    };
  }

  const localHost = ["127.0.0.1", "localhost", "::1"].includes(hostProxy.host.toLowerCase());
  const desired = {
    host: localHost ? "10.0.2.2" : hostProxy.host,
    port: hostProxy.port,
  };
  const consistent = androidProxy.state === "configured"
    && androidProxy.host.toLowerCase() === desired.host.toLowerCase()
    && androidProxy.port === desired.port;
  return {
    state: consistent ? "consistent" : "emulator_proxy_sync_required",
    consistent,
    autoConfigurable: !consistent,
    emulator: true,
    desired,
    requiredAction: consistent ? null : "sync_emulator_proxy",
  };
}

function adbProxyValue(adbPath, serial) {
  if (process.env.BSG_TEST_ANDROID_PROXY != null) return process.env.BSG_TEST_ANDROID_PROXY;
  return execFileSync(adbPath, ["-s", serial, "shell", "settings", "get", "global", "http_proxy"], {
    encoding: "utf-8",
    timeout: 5000,
  }).trim();
}

export function ensureAndroidProxy(android) {
  const device = android?.devices?.find((item) => item.state === "device");
  if (!device) {
    return { ok: false, state: "android_device_missing", requiredUserAction: "connect_android_device" };
  }
  if (android.adbPath === "test-env" && process.env.BSG_TEST_PC_PROXY == null && process.env.BSG_TEST_ANDROID_PROXY == null) {
    return { ok: true, state: "consistent", consistent: true, simulated: true };
  }

  const hostProxy = process.env.BSG_TEST_PC_PROXY != null
    ? parseProxySetting(process.env.BSG_TEST_PC_PROXY, "test")
    : detectHostProxy();
  let androidProxy;
  try {
    androidProxy = parseAndroidProxy(adbProxyValue(android.adbPath || "adb", device.serial));
  } catch (error) {
    return {
      ok: false,
      state: "android_proxy_check_failed",
      hostProxy,
      error: String(error.message || error),
      requiredUserAction: "reconnect_android_device",
    };
  }

  const plan = planAndroidProxySync(hostProxy, androidProxy, device.serial);
  if (plan.consistent) {
    return { ok: true, ...plan, hostProxy, androidProxy };
  }
  if (!plan.autoConfigurable) {
    return { ok: false, ...plan, hostProxy, androidProxy, requiredUserAction: plan.requiredAction };
  }

  const value = plan.clear ? ":0" : `${plan.desired.host}:${plan.desired.port}`;
  try {
    if (process.env.BSG_TEST_PROXY_APPLY_ERROR) throw new Error(process.env.BSG_TEST_PROXY_APPLY_ERROR);
    if (android.adbPath !== "test-env") {
      execFileSync(android.adbPath || "adb", [
        "-s", device.serial, "shell", "settings", "put", "global", "http_proxy", value,
      ], { encoding: "utf-8", timeout: 5000 });
      const verified = parseAndroidProxy(adbProxyValue(android.adbPath || "adb", device.serial));
      const verifiedOk = plan.clear
        ? verified.state === "none"
        : verified.state === "configured" && verified.host === plan.desired.host && verified.port === plan.desired.port;
      if (!verifiedOk) {
        throw new Error(`Android proxy verification returned ${verified.raw || verified.state}`);
      }
    }
    return {
      ok: true,
      ...plan,
      state: plan.clear ? "emulator_proxy_cleared" : "emulator_proxy_synced",
      consistent: true,
      applied: true,
      appliedValue: value,
      hostProxy,
      androidProxy,
    };
  } catch (error) {
    return {
      ok: false,
      ...plan,
      state: "emulator_proxy_sync_failed",
      hostProxy,
      androidProxy,
      error: String(error.message || error),
      requiredUserAction: "configure_android_network",
    };
  }
}

export async function checkProbeNetwork() {
  if (process.env.BSG_TEST_PROBE_NETWORK_RESULT != null) {
    return JSON.parse(process.env.BSG_TEST_PROBE_NETWORK_RESULT);
  }
  if (process.env.BSG_TEST_PROBE_INFO != null) {
    return { ok: true, state: "reachable", url: "https://example.com/", simulated: true };
  }
  try {
    const response = await fetch("http://127.0.0.1:18888/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/",
        timeout: 10000,
        jsRetries: 1,
        jsDelay: 250,
        screenshot: false,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      return {
        ok: false,
        state: "neutral_page_failed",
        url: "https://example.com/",
        error: result.error || `Probe returned HTTP ${response.status}`,
      };
    }
    return {
      ok: true,
      state: "reachable",
      url: "https://example.com/",
      loadTimeMs: result.loadTimeMs ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      state: "neutral_page_failed",
      url: "https://example.com/",
      error: String(error.message || error),
    };
  }
}
