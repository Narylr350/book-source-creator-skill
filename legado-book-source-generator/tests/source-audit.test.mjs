import { describe, it } from "node:test";
import assert from "node:assert";
import {
  auditSourceRules,
  buildSearchPreview,
  collectEmbeddedJsSyntaxErrors,
} from "../scripts/lib/source-audit.mjs";

describe("buildSearchPreview", () => {
  it("replaces {{key}} and {{page}}", () => {
    const result = buildSearchPreview("https://example.com/search?q={{key}}&p={{page}}", "小说", "2");
    assert.strictEqual(result, "https://example.com/search?q=小说&p=2");
  });

  it("returns empty string for invalid input", () => {
    assert.strictEqual(buildSearchPreview(""), "");
    assert.strictEqual(buildSearchPreview(null), "");
  });
});

describe("collectEmbeddedJsSyntaxErrors", () => {
  it("returns empty for valid rules", () => {
    const source = {
      ruleSearch: { bookList: "$.items[*]" },
      ruleContent: { content: "$.content" },
    };
    assert.deepStrictEqual(collectEmbeddedJsSyntaxErrors(source), []);
  });

  it("detects syntax error in <js> block", () => {
    const source = {
      ruleContent: {
        content: "<js>return java.connect(</js>",
      },
    };
    const errors = collectEmbeddedJsSyntaxErrors(source);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes("ruleContent.content"));
  });

  it("detects syntax error in @js: rule", () => {
    const source = {
      ruleContent: {
        content: "@js:java.connect(",
      },
    };
    const errors = collectEmbeddedJsSyntaxErrors(source);
    assert.ok(errors.length > 0);
  });
});

describe("auditSourceRules", () => {
  const validSource = {
    bookSourceUrl: "https://example.com",
    bookSourceName: "Example",
    searchUrl: "https://example.com/search?q={{key}}",
    ruleSearch: { bookList: "$.items[*]", name: "$.title", bookUrl: "$.url" },
    ruleBookInfo: { name: "$.title" },
    ruleToc: { chapterList: "$.chapters[*]", chapterName: "$.title", chapterUrl: "$.url" },
    ruleContent: { content: "$.content" },
  };

  it("reports no issues for valid source", () => {
    const audit = auditSourceRules(validSource);
    assert.strictEqual(audit.jsSyntaxErrors.length, 0);
    assert.strictEqual(audit.loginConfigured, false);
    assert.strictEqual(audit.exploreConfigured, false);
  });

  it("detects login configuration", () => {
    const source = { ...validSource, loginUrl: "https://example.com/login" };
    const audit = auditSourceRules(source);
    assert.strictEqual(audit.loginConfigured, true);
  });

  it("detects placeholder fields", () => {
    const source = {
      ...validSource,
      ruleSearch: { bookList: "书籍列表规则", name: "$.title", bookUrl: "$.url" },
    };
    const audit = auditSourceRules(source);
    assert.ok(audit.sections.ruleSearch.placeholderFields.includes("bookList"));
  });

  it("detects risky JS rules", () => {
    const source = {
      ...validSource,
      ruleContent: { content: "@js:java.connect(url)" },
    };
    const audit = auditSourceRules(source);
    assert.ok(audit.sections.ruleContent.riskyFields.includes("content"));
  });
});
