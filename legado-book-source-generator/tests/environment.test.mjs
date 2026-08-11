import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildProbeCookieCheckUrl,
  hasProbeLoginEvidence,
  probeCookieCheckDomains,
  probeCookieFingerprint,
  probeCookieFingerprintChanged,
  selectBestProbeCookieResult,
} from "../scripts/lib/environment.mjs";
import {
  parseProxySetting,
  detectTunnelInterfaces,
  detectTunnelProxy,
  planAndroidProxySync,
  ensureAndroidProxy,
  checkProbeNetwork,
} from "../scripts/lib/android-network.mjs";

describe("Android proxy synchronization", () => {
  it("detects a TUN adapter and its usable loopback HTTP proxy", () => {
    const interfaces = {
      Mihomo: [{ family: "IPv4", address: "198.18.0.1" }],
      Ethernet: [{ family: "IPv4", address: "192.168.1.10" }],
    };

    assert.deepEqual(detectTunnelInterfaces(interfaces), ["Mihomo"]);
    const proxy = detectTunnelProxy(interfaces, (port) => port === 7890, [7890, 7891]);
    assert.equal(proxy.state, "configured");
    assert.equal(proxy.tunnel, true);
    assert.equal(proxy.port, 7890);
  });

  it("does not report an unmapped TUN as a direct connection", () => {
    const proxy = detectTunnelProxy(
      { "Meta Tunnel": [{ family: "IPv4", address: "198.19.0.1" }] },
      () => false,
      [7890],
    );

    assert.equal(proxy.state, "tunnel_unmapped");
    assert.equal(proxy.tunnel, true);
  });

  it("maps a localhost HTTP proxy to the emulator host gateway", () => {
    const plan = planAndroidProxySync(
      parseProxySetting("http://127.0.0.1:7890", "test"),
      parseProxySetting("", "android"),
      "emulator-5554",
    );

    assert.equal(plan.autoConfigurable, true);
    assert.deepEqual(plan.desired, { host: "10.0.2.2", port: 7890 });
  });

  it("clears a stale emulator proxy when the host is direct", () => {
    const plan = planAndroidProxySync(
      parseProxySetting("", "host"),
      parseProxySetting("10.0.2.2:7890", "android"),
      "emulator-5554",
    );

    assert.equal(plan.autoConfigurable, true);
    assert.equal(plan.clear, true);
  });

  it("does not auto-configure a physical device proxy", () => {
    const plan = planAndroidProxySync(
      parseProxySetting("http://127.0.0.1:7890", "test"),
      parseProxySetting("", "android"),
      "R58M123456A",
    );

    assert.equal(plan.autoConfigurable, false);
    assert.equal(plan.requiredAction, "configure_physical_device_proxy");
  });

  it("rejects SOCKS proxies that Android global HTTP proxy cannot represent", () => {
    const plan = planAndroidProxySync(
      parseProxySetting("socks5://127.0.0.1:1080", "test"),
      parseProxySetting("", "android"),
      "emulator-5554",
    );

    assert.equal(plan.autoConfigurable, false);
    assert.equal(plan.state, "host_proxy_not_android_compatible");
  });

  it("automatically synchronizes an emulator proxy", () => {
    const previous = {
      pc: process.env.BSG_TEST_PC_PROXY,
      android: process.env.BSG_TEST_ANDROID_PROXY,
    };
    process.env.BSG_TEST_PC_PROXY = "http://127.0.0.1:7890";
    process.env.BSG_TEST_ANDROID_PROXY = "null";
    try {
      const result = ensureAndroidProxy({
        adbPath: "test-env",
        devices: [{ serial: "emulator-5554", state: "device" }],
      });
      assert.equal(result.ok, true);
      assert.equal(result.applied, true);
      assert.equal(result.appliedValue, "10.0.2.2:7890");
    } finally {
      if (previous.pc == null) delete process.env.BSG_TEST_PC_PROXY;
      else process.env.BSG_TEST_PC_PROXY = previous.pc;
      if (previous.android == null) delete process.env.BSG_TEST_ANDROID_PROXY;
      else process.env.BSG_TEST_ANDROID_PROXY = previous.android;
    }
  });

  it("automatically clears a stale emulator proxy", () => {
    const previous = {
      pc: process.env.BSG_TEST_PC_PROXY,
      android: process.env.BSG_TEST_ANDROID_PROXY,
    };
    process.env.BSG_TEST_PC_PROXY = "";
    process.env.BSG_TEST_ANDROID_PROXY = "10.0.2.2:7890";
    try {
      const result = ensureAndroidProxy({
        adbPath: "test-env",
        devices: [{ serial: "emulator-5554", state: "device" }],
      });
      assert.equal(result.ok, true);
      assert.equal(result.state, "emulator_proxy_cleared");
      assert.equal(result.appliedValue, ":0");
    } finally {
      if (previous.pc == null) delete process.env.BSG_TEST_PC_PROXY;
      else process.env.BSG_TEST_PC_PROXY = previous.pc;
      if (previous.android == null) delete process.env.BSG_TEST_ANDROID_PROXY;
      else process.env.BSG_TEST_ANDROID_PROXY = previous.android;
    }
  });

  it("reports neutral Probe failures as device network failures", async () => {
    const previous = process.env.BSG_TEST_PROBE_NETWORK_RESULT;
    process.env.BSG_TEST_PROBE_NETWORK_RESULT = JSON.stringify({
      ok: false,
      state: "neutral_page_failed",
      error: "Timeout after 10000ms",
    });
    try {
      const result = await checkProbeNetwork();
      assert.equal(result.ok, false);
      assert.equal(result.state, "neutral_page_failed");
    } finally {
      if (previous == null) delete process.env.BSG_TEST_PROBE_NETWORK_RESULT;
      else process.env.BSG_TEST_PROBE_NETWORK_RESULT = previous;
    }
  });
});

describe("Probe cookie check URL", () => {
  it("requires the target site domain instead of using a baked-in default", () => {
    assert.equal(
      buildProbeCookieCheckUrl("https://novalpie.cc/book/1"),
      "http://localhost:18888/cookie-check?domain=novalpie.cc"
    );
  });

  it("encodes explicit host names", () => {
    assert.equal(
      buildProbeCookieCheckUrl("www.example.com"),
      "http://localhost:18888/cookie-check?domain=www.example.com"
    );
  });

  it("rejects missing domains", () => {
    assert.throws(() => buildProbeCookieCheckUrl(""), /domain/);
  });
});

describe("Probe login cookie evidence", () => {
  it("does not treat an anonymous session cookie as login", () => {
    assert.equal(hasProbeLoginEvidence({
      hasCookies: true,
      cookies: "ci_session=abc; readPage_visits=2",
      url: "https://www.example.com",
    }), false);
  });

  it("accepts explicit login cookie names as login evidence", () => {
    assert.equal(hasProbeLoginEvidence({
      hasCookies: true,
      cookies: "user_id=123; reader_id=123; login_token=abc; ci_session=def",
      url: "https://wap.example.com",
    }), true);
  });

  it("checks mobile-domain cookie candidates for www sites", () => {
    assert.deepEqual(
      probeCookieCheckDomains("https://www.example.com"),
      ["www.example.com", "wap.example.com", "m.example.com", "example.com"]
    );
  });

  it("prefers mobile login cookies over www anonymous cookies", () => {
    const result = selectBestProbeCookieResult("https://www.example.com", [
      { ok: true, parsed: { url: "https://www.example.com", hasCookies: true, cookies: "ci_session=abc" } },
      { ok: true, parsed: { url: "https://wap.example.com", hasCookies: true, cookies: "login_token=abc; user_id=1" } },
    ]);

    assert.equal(result.parsed.url, "https://wap.example.com");
  });

  it("compares cookie fingerprints without storing raw cookie values", () => {
    const before = probeCookieFingerprint({ hasCookies: false, cookies: "", url: "https://example.com" });
    const after = probeCookieFingerprint({
      hasCookies: true,
      cookies: "opaque_session=abc; route=mobile",
      url: "https://example.com",
    });

    assert.equal(after.hasCookies, true);
    assert.deepEqual(after.cookieNames, ["opaque_session", "route"]);
    assert.equal(after.cookieHash.length, 16);
    assert.doesNotMatch(JSON.stringify(after), /abc|mobile/);
    assert.equal(probeCookieFingerprintChanged(before, after), true);
  });

  it("does not treat unchanged anonymous cookies as a login delta", () => {
    const before = probeCookieFingerprint({
      hasCookies: true,
      cookies: "sid=abc; route=mobile",
      url: "https://example.com",
    });
    const after = probeCookieFingerprint({
      hasCookies: true,
      cookies: "sid=abc; route=mobile",
      url: "https://example.com",
    });

    assert.equal(probeCookieFingerprintChanged(before, after), false);
  });
});
