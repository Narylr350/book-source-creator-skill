import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { initializeOutputBundle } from "../legado-book-source-generator/scripts/lib/output-bundle.mjs";
import { validateBookSource } from "../legado-book-source-generator/scripts/lib/source-validate.mjs";

test("validateBookSource accepts a minimal valid Legado source", () => {
  const source = {
    bookSourceUrl: "https://example.com",
    bookSourceName: "Example",
    searchUrl: "https://example.com/search?q={{key}}",
    ruleSearch: { bookList: "$.items[*]", name: "$.title", bookUrl: "$.url" },
    ruleBookInfo: { name: "$.title", tocUrl: "$.toc" },
    ruleToc: { chapterList: "$.chapters[*]", chapterName: "$.title", chapterUrl: "$.url" },
    ruleContent: { content: "$.content" },
  };

  assert.deepEqual(validateBookSource(source), []);
});

test("validateBookSource allows an empty tocUrl when the TOC is embedded in detail", () => {
  const source = {
    bookSourceUrl: "https://example.com",
    bookSourceName: "Example",
    searchUrl: "https://example.com/search?q={{key}}",
    ruleSearch: { bookList: "$.items[*]", name: "$.title", bookUrl: "$.url" },
    ruleBookInfo: { name: "$.title", tocUrl: "" },
    ruleToc: { chapterList: "$.chapters[*]", chapterName: "$.title", chapterUrl: "$.url" },
    ruleContent: { content: "$.content" },
  };

  assert.deepEqual(validateBookSource(source), []);
});

test("validateBookSource reports missing required fields", () => {
  const source = {
    bookSourceUrl: "https://example.com",
    bookSourceName: "Example",
    ruleSearch: { bookList: "$.items[*]" },
  };

  const errors = validateBookSource(source);

  assert.ok(errors.includes("Missing required top-level field: searchUrl"));
  assert.ok(errors.includes("Missing required top-level field: ruleBookInfo"));
  assert.ok(errors.includes("Missing required top-level field: ruleToc"));
  assert.ok(errors.includes("Missing required top-level field: ruleContent"));
});

test("initializeOutputBundle creates only the default user deliverable", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "legado-skill-"));

  try {
    const bundleDir = initializeOutputBundle(tempRoot, "https://www.example.com/books/search");

    assert.equal(path.basename(bundleDir), "example-com");
    assert.ok(fs.existsSync(path.join(bundleDir, "book-source.json")));
    assert.ok(!fs.existsSync(path.join(bundleDir, "assessment.md")));
    assert.ok(!fs.existsSync(path.join(bundleDir, "analysis.md")));
    assert.ok(!fs.existsSync(path.join(bundleDir, "validation-checklist.md")));
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(bundleDir, "book-source.json"), "utf8")),
      [],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
