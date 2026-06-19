import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractSummary, normalizeCookieFile } from "../scripts/validate-with-validator.mjs";

describe("validate-with-validator report summary", () => {
  it("does not count optional rule misses from successful steps as failed fields", () => {
    const summary = extractSummary({
      phases: { search: "success", content: "success" },
      steps: [
        {
          phase: "search",
          status: "success",
          ruleHits: [
            { field: "name", success: true },
            { field: "updateTime", success: false },
          ],
        },
        {
          phase: "content",
          status: "success",
          errorCode: "CONTENT_CHAPTER_MISMATCH",
          ruleHits: [
            { field: "isVolume", success: false },
          ],
        },
      ],
    });

    assert.deepEqual(summary.failedFields, []);
  });

  it("keeps failed fields from error steps", () => {
    const summary = extractSummary({
      phases: { search: "error" },
      steps: [
        {
          phase: "search",
          status: "error",
          ruleHits: [
            { field: "ruleSearch.bookList", success: false },
          ],
        },
      ],
    });

    assert.deepEqual(summary.failedFields, ["ruleSearch.bookList"]);
  });
});

describe("validate-with-validator cookie file", () => {
  it("normalizes supported cookie file shapes", () => {
    assert.deepEqual(
      normalizeCookieFile({ "www.ciweimao.com": "login_token=abc; uid=1" }),
      [{ domain: "www.ciweimao.com", cookie: "login_token=abc; uid=1" }]
    );

    assert.deepEqual(
      normalizeCookieFile({ domain: "www.ciweimao.com", cookie: "login_token=abc" }),
      [{ domain: "www.ciweimao.com", cookie: "login_token=abc" }]
    );
  });

  it("rejects domain key containing a cookie string", () => {
    assert.throws(
      () => normalizeCookieFile({ domain: "login_token=abc; uid=1" }),
      /缺少真实域名键/
    );
  });
});
