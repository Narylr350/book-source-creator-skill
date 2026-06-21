import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { determineStatus, extractSummary, mapReportStep, normalizeCookieFile } from "../scripts/validate-with-validator.mjs";

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

describe("validate-with-validator report step mapping", () => {
  it("preserves request headers and WebView evidence for downstream gates", () => {
    const mapped = mapReportStep({
      phase: "content",
      status: "success",
      request: {
        url: "https://example.com/chapter/1",
        method: "GET",
        headers: { Cookie: "sid=abc", Authorization: "Bearer token" },
      },
      response: {
        code: 200,
        bodyLength: 123,
        rendered: { html: "<main>正文</main>" },
      },
      webViewHtmlPreview: "<main>正文</main>",
      webViewScreenshotBase64: "base64-png",
    });

    assert.deepEqual(mapped.request.headers, { Cookie: "sid=abc", Authorization: "Bearer token" });
    assert.equal(mapped.response.rendered.html, "<main>正文</main>");
    assert.equal(mapped.webViewHtmlPreview, "<main>正文</main>");
    assert.equal(mapped.webViewScreenshotBase64, "base64-png");
  });
});

describe("validate-with-validator status", () => {
  it("keeps concrete failed reason when validator finalStatus is failed", () => {
    const result = determineStatus({
      ok: true,
      finalStatus: "failed",
      steps: [
        {
          phase: "content",
          status: "error",
          error: "正文为空",
          errorCode: "CONTENT_SELECTOR_EMPTY",
          needsAppReview: false,
        },
      ],
    });

    assert.equal(result.status, "failed");
    assert.equal(result.reason, "content: 正文为空");
  });
});
