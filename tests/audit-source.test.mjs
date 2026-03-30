import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  auditSourceRules,
  buildSearchPreview,
} from "../legado-book-source-generator/scripts/lib/source-audit.mjs";

test("auditSourceRules flags placeholder and risky rule fields", () => {
  const audit = auditSourceRules({
    bookSourceName: "Demo",
    bookSourceUrl: "https://example.com",
    searchUrl: "https://example.com/search?q={{key}}",
    ruleSearch: {
      bookList: "书籍列表规则",
      name: "@css:.title@text",
      bookUrl: "@js:'/book/' + result",
    },
  });

  assert.deepEqual(audit.sections.ruleSearch.placeholderFields, ["bookList"]);
  assert.deepEqual(audit.sections.ruleSearch.riskyFields, ["bookUrl"]);
});

test("buildSearchPreview replaces Legado variables for quick inspection", () => {
  const preview = buildSearchPreview(
    "https://example.com/search?q={{key}}&page={{page}}",
    "凡人修仙传",
    "3",
  );

  assert.equal(preview, "https://example.com/search?q=凡人修仙传&page=3");
});

test("audit-source CLI prints an audit report for a valid source file", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "legado-audit-"));
  const sourcePath = path.join(tempRoot, "source.json");

  fs.writeFileSync(
    sourcePath,
    JSON.stringify(
      {
        bookSourceName: "Demo",
        bookSourceUrl: "https://example.com",
        searchUrl: "https://example.com/search?q={{key}}&page={{page}}",
        ruleSearch: {
          bookList: "@css:.item",
          name: "@css:.title@text",
          bookUrl: "@css:a@href",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const scriptPath = path.resolve("legado-book-source-generator/scripts/audit-source.mjs");
    const result = spawnSync(
      process.execPath,
      [scriptPath, sourcePath, "--keyword", "凡人修仙", "--page", "2"],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /书源: Demo/);
    assert.match(result.stdout, /搜索预览: https:\/\/example\.com\/search\?q=凡人修仙&page=2/);
    assert.match(result.stdout, /本脚本只做静态审计/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
