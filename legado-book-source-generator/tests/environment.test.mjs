import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildProbeCookieCheckUrl } from "../scripts/lib/environment.mjs";

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
