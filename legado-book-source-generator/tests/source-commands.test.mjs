import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { cmdSource } from "../scripts/lib/source-commands.mjs";
import { freshRunState, saveRunState, writeJsonFile } from "../scripts/lib/state.mjs";

function makeRun(phase = "generate") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bsg-source-cmd-"));
  const runDir = path.join(root, "runs", "example");
  const outputDir = path.join(root, "outputs", "example");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const state = freshRunState("https://example.test", "example", "normal", root);
  for (const name of ["probe", "assess", "analyze", "generate", "validate", "deliver"]) {
    state.phases[name].status = name === phase ? "in_progress" : "pending";
  }
  saveRunState(runDir, state);
  writeJsonFile(path.join(outputDir, "book-source.json"), [{
    bookSourceUrl: "https://example.test",
    bookSourceName: "Example",
    searchUrl: "/search/{{key}}",
    ruleSearch: { bookList: "$.items", name: "$.title", bookUrl: "$.url" },
    ruleBookInfo: { name: "$.name", author: "$.author", intro: "$.intro", tocUrl: "$.toc" },
    ruleToc: { chapterList: "$.chapters", chapterName: "$.title", chapterUrl: "{{$.url}},{\"webView\":true}" },
    ruleContent: { content: "@css:#reader@text", webJs: "document.querySelector('#reader')?.innerText" }
  }]);

  return { root, runDir };
}

describe("bsg source commands", () => {
  it("inspects common risky source fields", () => {
    const { root, runDir } = makeRun();
    try {
      const result = cmdSource(["inspect", "--run", runDir]);

      assert.equal(result.ok, true);
      assert.equal(result.phase, "generate");
      assert.equal(result.summary.hasWebView, true);
      assert.equal(result.summary.hasWebJs, true);
      assert.equal(result.fields["ruleToc.chapterUrl"], "{{$.url}},{\"webView\":true}");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("sets one field only during generate phase", () => {
    const { root, runDir } = makeRun();
    try {
      const result = cmdSource([
        "set",
        "--run", runDir,
        "--path", "ruleContent.content",
        "--value", "@css:.content@text"
      ]);

      assert.equal(result.ok, true);
      const source = JSON.parse(fs.readFileSync(path.join(root, "outputs", "example", "book-source.json"), "utf-8"))[0];
      assert.equal(source.ruleContent.content, "@css:.content@text");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows source edits outside generate phase and invalidates stale validation artifacts", () => {
    const { root, runDir } = makeRun("validate");
    try {
      for (const name of ["rule-check.json", "validator-report.json", "validator-summary.md", "capability-matrix.json"]) {
        fs.writeFileSync(path.join(runDir, name), "{}");
      }

      const result = cmdSource([
        "set",
        "--run", runDir,
        "--path", "ruleContent.content",
        "--value", "@css:.content@text"
      ]);

      assert.equal(result.ok, true);
      assert.equal(result.invalidatedArtifacts.length, 4);
      const source = JSON.parse(fs.readFileSync(path.join(root, "outputs", "example", "book-source.json"), "utf-8"))[0];
      assert.equal(source.ruleContent.content, "@css:.content@text");
      for (const name of ["rule-check.json", "validator-report.json", "validator-summary.md", "capability-matrix.json"]) {
        assert.equal(fs.existsSync(path.join(runDir, name)), false);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
