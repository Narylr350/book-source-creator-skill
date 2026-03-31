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
const jsonStructurePath = path.join(
  repoRoot,
  "legado-book-source-generator",
  "references",
  "legado-json-structure.md",
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

test("reference source patterns keeps a clean sample appendix without noisy user-provided urls", () => {
  const patterns = fs.readFileSync(patternPath, "utf8");
  const localSamples = [
    "legado-book-source-generator/references/reference-sources/jiwangyihao-source-j-legado/masiro.json",
    "legado-book-source-generator/references/reference-sources/jiwangyihao-source-j-legado/bilinovel.json",
    "legado-book-source-generator/references/reference-sources/jiwangyihao-source-j-legado/wenku.json",
    "legado-book-source-generator/references/reference-sources/ZWolken-Light-Novel-Yuedu-Source/ACGZC.json",
    "legado-book-source-generator/references/reference-sources/ZWolken-Light-Novel-Yuedu-Source/Lofter.json",
    "legado-book-source-generator/references/reference-sources/ZWolken-Light-Novel-Yuedu-Source/刺猬猫.json",
  ];

  assert.match(patterns, /参考书源速查/);
  assert.match(patterns, /masiro\.json/);
  assert.match(patterns, /bilinovel\.json/);
  assert.match(patterns, /wenku\.json/);
  assert.match(patterns, /ACGZC\.json/);
  assert.match(patterns, /Lofter\.json/);
  assert.match(patterns, /刺猬猫\.json/);
  assert.doesNotMatch(patterns, /用户提供/);
  assert.doesNotMatch(patterns, /n\.novelia\.cc/);
  assert.doesNotMatch(patterns, /esjzone/i);

  for (const sample of localSamples) {
    assert.ok(fs.existsSync(path.join(repoRoot, sample)), sample);
  }
});

test("official Legado notes capture the core rule details needed during generation", () => {
  const notes = fs.readFileSync(officialNotesPath, "utf8");

  assert.match(notes, /webView/i);
  assert.match(notes, /JSON\.stringify\(\)/);
  assert.match(notes, /nextTocUrl/);
  assert.match(notes, /@put|@get/);
});

test("JSON structure docs require array-wrapped import payloads for Legado", () => {
  const jsonStructure = fs.readFileSync(jsonStructurePath, "utf8");
  const skill = fs.readFileSync(skillPath, "utf8");

  assert.match(jsonStructure, /顶层必须是 JSON 数组/);
  assert.match(jsonStructure, /\[\s*\{/);
  assert.match(skill, /JSON 数组/);
});
