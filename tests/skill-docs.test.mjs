import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(".");
const skillRoot = path.join(repoRoot, "legado-book-source-generator");

function read(relPath) {
  return fs.readFileSync(path.join(skillRoot, relPath), "utf8");
}

test("SKILL documents the current toolbox mode and deliver gate", () => {
  const skill = read("SKILL.md");

  assert.match(skill, /工具箱模式/);
  assert.match(skill, /toolbox/);
  assert.match(skill, /record-validation/);
  assert.match(skill, /deliver/);
  assert.match(skill, /唯一最终审计/);
  assert.match(skill, /Browser MCP 前置/);
  assert.match(skill, /references\/site-inspection\.md/);
  assert.doesNotMatch(skill, /advance --run/);
});

test("workflow uses run as the current rule-check path and marks advance retired", () => {
  const workflow = read("references/workflow.md");

  assert.match(workflow, /工具箱模式/);
  assert.match(workflow, /当前入口是 `run`/);
  assert.match(workflow, /`advance` 已退役/);
  assert.match(workflow, /第一项站点操作必须是用 Browser MCP/);
  assert.doesNotMatch(workflow, /run\/advance/);
});

test("outputs docs point to bsg toolbox commands instead of retired helper CLIs", () => {
  const outputs = read("references/outputs.md");

  assert.match(outputs, /bsg\.mjs" init/);
  assert.match(outputs, /bsg\.mjs" record-validation/);
  assert.match(outputs, /bsg\.mjs" deliver/);
  assert.match(outputs, /独立 CLI 已退役/);
  assert.doesNotMatch(outputs, /npm run scaffold/);
  assert.doesNotMatch(outputs, /npm run audit/);
});

test("behavior docs have a single canonical source under references", () => {
  const docsWebView = fs.readFileSync(path.join(repoRoot, "docs", "webview-behavior-matrix.md"), "utf8");
  const docsBehavior = fs.readFileSync(path.join(repoRoot, "docs", "legado-source-behavior.md"), "utf8");

  assert.match(docsWebView, /canonical 文档/);
  assert.match(docsWebView, /legado-book-source-generator\/references\/webview-behavior-matrix\.md/);
  assert.match(docsBehavior, /canonical 文档/);
  assert.match(docsBehavior, /legado-book-source-generator\/references\/legado-source-behavior\.md/);
});
