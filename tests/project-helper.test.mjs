import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { initializeOutputBundle, validateBookSource } from "../legado-book-source-generator/scripts/project-helper.mjs";

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

test("initializeOutputBundle creates the standard output files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "legado-skill-"));

  try {
    const bundleDir = initializeOutputBundle(tempRoot, "https://www.example.com/books/search");

    assert.equal(path.basename(bundleDir), "example-com");
    assert.ok(fs.existsSync(path.join(bundleDir, "assessment.md")));
    assert.ok(fs.existsSync(path.join(bundleDir, "analysis.md")));
    assert.ok(fs.existsSync(path.join(bundleDir, "book-source.json")));
    assert.ok(fs.existsSync(path.join(bundleDir, "validation-checklist.md")));
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(bundleDir, "book-source.json"), "utf8")),
      [],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("CLI validate-source accepts a top-level array payload for Legado import compatibility", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "legado-validate-array-"));

  try {
    const sourcePath = path.join(tempRoot, "book-source.json");
    fs.writeFileSync(
      sourcePath,
      JSON.stringify(
        [
          {
            bookSourceUrl: "https://example.com",
            bookSourceName: "Example",
            searchUrl: "https://example.com/search?q={{key}}",
            ruleSearch: { bookList: "$.items[*]", name: "$.title", bookUrl: "$.url" },
            ruleBookInfo: { name: "$.title", tocUrl: "$.toc" },
            ruleToc: { chapterList: "$.chapters[*]", chapterName: "$.title", chapterUrl: "$.url" },
            ruleContent: { content: "$.content" },
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const scriptPath = path.resolve("legado-book-source-generator/scripts/project-helper.mjs");
    const result = spawnSync(
      process.execPath,
      [scriptPath, "validate-source", sourcePath],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Book source JSON is valid/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("CLI scaffold-output creates the output bundle", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "legado-skill-cli-"));

  try {
    const scriptPath = path.resolve("legado-book-source-generator/scripts/project-helper.mjs");
    const result = spawnSync(
      process.execPath,
      [scriptPath, "scaffold-output", tempRoot, "https://www.example.com"],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0);
    assert.ok(fs.existsSync(path.join(tempRoot, "example-com", "assessment.md")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
