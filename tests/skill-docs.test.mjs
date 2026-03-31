import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(".");
const skillPath = path.join(
  repoRoot,
  "legado-book-source-generator",
  "SKILL.md",
);
const workflowPath = path.join(
  repoRoot,
  "legado-book-source-generator",
  "references",
  "analysis-workflow.md",
);
const patternPath = path.join(
  repoRoot,
  "legado-book-source-generator",
  "references",
  "reference-source-patterns.md",
);
const officialNotesPath = path.join(
  repoRoot,
  "legado-book-source-generator",
  "references",
  "legado-official-rule-notes.md",
);

test("SKILL requires checking WebView and reference examples before a final negative rating", () => {
  const skill = fs.readFileSync(skillPath, "utf8");

  assert.match(skill, /WebView/i);
  assert.match(skill, /P15/);
  assert.match(skill, /不建议生成/);
  assert.match(skill, /examples\/README\.md/);
});

test("analysis workflow treats browser-rendered content as a WebView checkpoint", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert.match(workflow, /WebView/i);
  assert.match(workflow, /浏览器|Browser MCP/);
  assert.match(workflow, /正文/);
});

test("SKILL hard-blocks on login-capable sites and points generation back to official Legado rules", () => {
  const skill = fs.readFileSync(skillPath, "utf8");

  assert.match(skill, /登录/);
  assert.match(skill, /选择登录还是不登录分析/);
  assert.match(skill, /硬阻断|停止/);
  assert.match(skill, /legado-official-rule-notes\.md/);
});

test("reference source patterns stays distilled and removes noisy user-provided sample chatter", () => {
  const patterns = fs.readFileSync(patternPath, "utf8");

  assert.doesNotMatch(patterns, /用户提供/);
  assert.doesNotMatch(patterns, /n\.novelia\.cc/);
  assert.doesNotMatch(patterns, /esjzone/i);
});

test("official Legado notes capture the core rule details needed during generation", () => {
  const notes = fs.readFileSync(officialNotesPath, "utf8");

  assert.match(notes, /webView/i);
  assert.match(notes, /JSON\.stringify\(\)/);
  assert.match(notes, /nextTocUrl/);
  assert.match(notes, /@put|@get/);
});
