import { describe, it } from "node:test";
import assert from "node:assert";
import { deriveSiteSlug } from "../scripts/lib/slug.mjs";
import { validateBookSource } from "../scripts/lib/source-validate.mjs";

describe("deriveSiteSlug", () => {
  it("extracts slug from full URL", () => {
    assert.strictEqual(deriveSiteSlug("https://www.example.com/path"), "example-com");
  });

  it("strips www prefix", () => {
    assert.strictEqual(deriveSiteSlug("https://www.test.org"), "test-org");
  });

  it("handles URL without protocol", () => {
    assert.strictEqual(deriveSiteSlug("example.com"), "example-com");
  });

  it("returns 'site' for empty input", () => {
    assert.strictEqual(deriveSiteSlug(""), "site");
  });
});

describe("validateBookSource", () => {
  const validSource = {
    bookSourceUrl: "https://example.com",
    bookSourceName: "Example",
    searchUrl: "https://example.com/search?q={{key}}",
    ruleSearch: { bookList: "$.items[*]", name: "$.title", bookUrl: "$.url" },
    ruleBookInfo: { name: "$.title", tocUrl: "$.tocUrl" },
    ruleToc: { chapterList: "$.chapters[*]", chapterName: "$.title", chapterUrl: "$.url" },
    ruleContent: { content: "$.content" },
  };

  it("passes for valid source", () => {
    assert.deepStrictEqual(validateBookSource(validSource), []);
  });

  it("passes when tocUrl is missing (embedded TOC)", () => {
    const source = { ...validSource, ruleBookInfo: { name: "$.title" } };
    assert.deepStrictEqual(validateBookSource(source), []);
  });

  it("fails when bookSourceUrl is missing", () => {
    const source = { ...validSource };
    delete source.bookSourceUrl;
    const errors = validateBookSource(source);
    assert.ok(errors.some((e) => e.includes("bookSourceUrl")));
  });

  it("fails when ruleSearch.bookList is missing", () => {
    const source = {
      ...validSource,
      ruleSearch: { name: "$.title", bookUrl: "$.url" },
    };
    const errors = validateBookSource(source);
    assert.ok(errors.some((e) => e.includes("ruleSearch.bookList")));
  });

  it("fails when ruleBookInfo.name is missing", () => {
    const source = {
      ...validSource,
      ruleBookInfo: { tocUrl: "$.tocUrl" },
    };
    const errors = validateBookSource(source);
    assert.ok(errors.some((e) => e.includes("ruleBookInfo.name")));
  });
});
