import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveValidateCookieFile } from "../scripts/lib/validate-runner.mjs";

describe("validate runner cookie resolution", () => {
  it("bridges verified Probe login cookies into validator cookie input", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "bsg-validate-cookie-"));
    const previous = process.env.BSG_TEST_PROBE_COOKIE_CHECK;
    process.env.BSG_TEST_PROBE_COOKIE_CHECK = JSON.stringify({
      hasCookies: true,
      domain: "www.ciweimao.com",
      cookies: "license=abc; PHPSESSID=def",
    });

    try {
      const state = {
        siteUrl: "https://www.ciweimao.com",
        loginFeatures: {
          _loginMethod: "probe",
          _loginVerified: true,
        },
      };

      const result = resolveValidateCookieFile(runDir, state, "android");

      assert.equal(result.ok, true);
      assert.equal(result.source, "probe");
      assert.ok(result.cookieFile);
      const cookieJson = JSON.parse(fs.readFileSync(result.cookieFile, "utf-8"));
      assert.deepEqual(cookieJson, {
        "www.ciweimao.com": "license=abc; PHPSESSID=def",
      });
      result.cleanup?.();
      assert.equal(fs.existsSync(result.cookieFile), false);
    } finally {
      if (previous == null) delete process.env.BSG_TEST_PROBE_COOKIE_CHECK;
      else process.env.BSG_TEST_PROBE_COOKIE_CHECK = previous;
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("uses the selected Probe cookie result domain for mobile login cookies", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "bsg-validate-cookie-"));
    const previous = process.env.BSG_TEST_PROBE_COOKIE_CHECK;
    process.env.BSG_TEST_PROBE_COOKIE_CHECK = JSON.stringify({
      hasCookies: true,
      url: "https://wap.ciweimao.com",
      cookies: "user_id=1; reader_id=1; login_token=abc; ci_session=def",
    });

    try {
      const state = {
        siteUrl: "https://www.ciweimao.com",
        loginFeatures: {
          _loginMethod: "probe",
          _loginVerified: true,
        },
      };

      const result = resolveValidateCookieFile(runDir, state, "android");

      assert.equal(result.ok, true);
      assert.equal(result.source, "probe");
      const cookieJson = JSON.parse(fs.readFileSync(result.cookieFile, "utf-8"));
      // 登录态在 wap. 子域，但书源请求 base 域 www.；validator CookieStore 按域精确匹配，
      // 必须同时注入 base 域(validator 实际请求的域)和来源子域(兜底)。
      assert.deepEqual(cookieJson, {
        "www.ciweimao.com": "user_id=1; reader_id=1; login_token=abc; ci_session=def",
        "wap.ciweimao.com": "user_id=1; reader_id=1; login_token=abc; ci_session=def",
      });
      result.cleanup?.();
    } finally {
      if (previous == null) delete process.env.BSG_TEST_PROBE_COOKIE_CHECK;
      else process.env.BSG_TEST_PROBE_COOKIE_CHECK = previous;
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});
