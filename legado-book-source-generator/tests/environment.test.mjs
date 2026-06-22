import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildProbeCookieCheckUrl,
  hasProbeLoginEvidence,
  probeCookieCheckDomains,
  selectBestProbeCookieResult,
} from "../scripts/lib/environment.mjs";

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
});
