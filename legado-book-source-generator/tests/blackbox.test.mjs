import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const HELPER = path.join(ROOT, "scripts", "project-helper.mjs");
const AUDIT = path.join(ROOT, "scripts", "audit-source.mjs");

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bsg-blackbox-"));
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── CLI 黑盒 ──

describe("CLI: scaffold-output", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("只生成 book-source.json，不生成 md", async () => {
    await execFileAsync("node", [HELPER, "scaffold-output", tmpDir, "https://example.com"]);

    const slugDir = path.join(tmpDir, "example-com");
    assert.ok(await exists(path.join(slugDir, "book-source.json")), "book-source.json 应存在");
    assert.ok(!(await exists(path.join(slugDir, "assessment.md"))), "assessment.md 不应存在");
    assert.ok(!(await exists(path.join(slugDir, "analysis.md"))), "analysis.md 不应存在");
    assert.ok(!(await exists(path.join(slugDir, "validation-checklist.md"))), "validation-checklist.md 不应存在");
  });

  it("book-source.json 内容为空数组", async () => {
    await execFileAsync("node", [HELPER, "scaffold-output", tmpDir, "https://example.com"]);

    const content = await fs.readFile(path.join(tmpDir, "example-com", "book-source.json"), "utf8");
    assert.deepStrictEqual(JSON.parse(content), []);
  });

  it("重复运行不覆盖已有文件", async () => {
    const slugDir = path.join(tmpDir, "example-com");
    await fs.mkdir(slugDir, { recursive: true });
    await fs.writeFile(path.join(slugDir, "book-source.json"), '[{"bookSourceUrl":"x"}]', "utf8");

    await execFileAsync("node", [HELPER, "scaffold-output", tmpDir, "https://example.com"]);

    const content = await fs.readFile(path.join(slugDir, "book-source.json"), "utf8");
    assert.ok(content.includes("bookSourceUrl"), "不应覆盖已有文件");
  });

  it("参数不足时退出码为 2", async () => {
    await assert.rejects(
      () => execFileAsync("node", [HELPER, "scaffold-output"]),
      (err) => err.code === 2,
    );
  });
});

describe("CLI: scaffold-run", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("只生成过程 md，不生成 book-source.json", async () => {
    await execFileAsync("node", [HELPER, "scaffold-run", tmpDir, "https://example.com"]);

    const slugDir = path.join(tmpDir, "example-com");
    assert.ok(await exists(path.join(slugDir, "assessment.md")), "assessment.md 应存在");
    assert.ok(await exists(path.join(slugDir, "analysis.md")), "analysis.md 应存在");
    assert.ok(await exists(path.join(slugDir, "validation-checklist.md")), "validation-checklist.md 应存在");
    assert.ok(!(await exists(path.join(slugDir, "book-source.json"))), "book-source.json 不应存在");
  });

  it("assessment.md 包含完整模板字段", async () => {
    await execFileAsync("node", [HELPER, "scaffold-run", tmpDir, "https://example.com"]);

    const content = await fs.readFile(path.join(tmpDir, "example-com", "assessment.md"), "utf8");
    assert.ok(content.includes("<!-- AUTO:BEGIN summary -->"), "应包含脚本自动结论区");
    assert.ok(content.includes("<!-- AUTO:HASH pending -->"), "初始自动结论区应等待 record-assessment 生成 hash");
    assert.ok(content.includes("## 证据说明"), "应包含 AI 证据说明区");
    assert.ok(content.includes("## 分析备注"), "应包含 AI 分析备注区");
    assert.ok(!content.includes("用户选择: 登录分析 / 不登录分析"), "不应预设登录/不登录选择");
  });

  it("参数不足时退出码为 2", async () => {
    await assert.rejects(
      () => execFileAsync("node", [HELPER, "scaffold-run"]),
      (err) => err.code === 2,
    );
  });
});

// ── 交付物黑盒 ──

describe("CLI: validate-source", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("合法 JSON 返回 0", async () => {
    const filePath = path.join(tmpDir, "valid.json");
    await fs.writeFile(filePath, JSON.stringify([{
      bookSourceUrl: "https://example.com",
      bookSourceName: "Test",
      searchUrl: "https://example.com/search?q={{key}}",
      ruleSearch: { bookList: "$.items", name: "$.title", bookUrl: "$.url" },
      ruleBookInfo: { name: "$.title" },
      ruleToc: { chapterList: "$.chapters", chapterName: "$.title", chapterUrl: "$.url" },
      ruleContent: { content: "$.content" },
    }]), "utf8");

    const { stdout } = await execFileAsync("node", [HELPER, "validate-source", filePath]);
    assert.ok(stdout.includes("valid"), "输出应包含 valid");
  });

  it("空数组返回非 0", async () => {
    const filePath = path.join(tmpDir, "empty.json");
    await fs.writeFile(filePath, "[]", "utf8");

    await assert.rejects(
      () => execFileAsync("node", [HELPER, "validate-source", filePath]),
      (err) => err.code !== 0,
    );
  });

  it("缺必填字段返回非 0", async () => {
    const filePath = path.join(tmpDir, "missing.json");
    await fs.writeFile(filePath, JSON.stringify([{ bookSourceUrl: "https://example.com" }]), "utf8");

    await assert.rejects(
      () => execFileAsync("node", [HELPER, "validate-source", filePath]),
      (err) => err.code !== 0,
    );
  });

  it("非法 JSON 返回非 0", async () => {
    const filePath = path.join(tmpDir, "bad.json");
    await fs.writeFile(filePath, "not json", "utf8");

    await assert.rejects(
      () => execFileAsync("node", [HELPER, "validate-source", filePath]),
      (err) => err.code !== 0,
    );
  });
});

describe("CLI: audit-source", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("合法 JSON 返回 0，输出包含搜索预览", async () => {
    const filePath = path.join(tmpDir, "valid.json");
    await fs.writeFile(filePath, JSON.stringify([{
      bookSourceUrl: "https://example.com",
      bookSourceName: "Test",
      searchUrl: "https://example.com/search?q={{key}}&p={{page}}",
      ruleSearch: { bookList: "$.items", name: "$.title", bookUrl: "$.url" },
      ruleBookInfo: { name: "$.title" },
      ruleToc: { chapterList: "$.chapters", chapterName: "$.title", chapterUrl: "$.url" },
      ruleContent: { content: "$.content" },
    }]), "utf8");

    const { stdout } = await execFileAsync("node", [AUDIT, filePath, "--keyword", "凡人修仙", "--page", "1"]);
    assert.ok(stdout.includes("凡人修仙"), "输出应包含搜索关键词");
    assert.ok(stdout.includes("p=1"), "输出应包含页码");
    assert.ok(stdout.includes("书源:"), "输出应包含书源信息");
  });

  it("检测占位字段", async () => {
    const filePath = path.join(tmpDir, "placeholder.json");
    await fs.writeFile(filePath, JSON.stringify([{
      bookSourceUrl: "https://example.com",
      bookSourceName: "Test",
      searchUrl: "https://example.com/search?q={{key}}",
      ruleSearch: { bookList: "书籍列表规则", name: "$.title", bookUrl: "$.url" },
      ruleBookInfo: { name: "$.title" },
      ruleToc: { chapterList: "$.chapters", chapterName: "$.title", chapterUrl: "$.url" },
      ruleContent: { content: "$.content" },
    }]), "utf8");

    const { stdout } = await execFileAsync("node", [AUDIT, filePath]);
    assert.ok(stdout.includes("占位字段"), "输出应提示占位字段");
  });

  it("检测 JS 语法错误", async () => {
    const filePath = path.join(tmpDir, "badjs.json");
    await fs.writeFile(filePath, JSON.stringify([{
      bookSourceUrl: "https://example.com",
      bookSourceName: "Test",
      searchUrl: "https://example.com/search?q={{key}}",
      ruleSearch: { bookList: "$.items", name: "$.title", bookUrl: "$.url" },
      ruleBookInfo: { name: "$.title" },
      ruleToc: { chapterList: "$.chapters", chapterName: "$.title", chapterUrl: "$.url" },
      ruleContent: { content: "<js>return java.connect(</js>" },
    }]), "utf8");

    const { stdout } = await execFileAsync("node", [AUDIT, filePath]);
    assert.ok(stdout.includes("语法") || stdout.includes("error") || stdout.includes("Unexpected"), "输出应提示 JS 语法错误");
  });
});

// ── 文档契约测试 ──

describe("文档契约: 输出结构一致性", async () => {
  const docsToCheck = [];

  async function collectMd(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "fixtures" && entry.name !== "examples") {
        await collectMd(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        docsToCheck.push(full);
      }
    }
  }

  await collectMd(ROOT);

  for (const docPath of docsToCheck) {
    const relPath = path.relative(ROOT, docPath);
    const content = await fs.readFile(docPath, "utf8");

    it(`${relPath}: 不得把 md 放在 outputs/<site-slug>/ 下`, () => {
      const forbidden = [
        /outputs\/<site-slug>\/assessment\.md/,
        /outputs\/<site-slug>\/analysis\.md/,
        /outputs\/<site-slug>\/validation-checklist\.md/,
        /outputs\/[^/]+\/assessment\.md/,
        /outputs\/[^/]+\/analysis\.md/,
        /outputs\/[^/]+\/validation-checklist\.md/,
      ];
      for (const pattern of forbidden) {
        assert.ok(
          !pattern.test(content),
          `${relPath} 中不应出现 ${pattern.source}（md 不应放在 outputs 下）`,
        );
      }
    });
  }
});

describe("文档契约: 必须明确新结构", async () => {
  const keyFiles = [
    { name: "SKILL.md", path: path.join(ROOT, "SKILL.md") },
    { name: "references/outputs.md", path: path.join(ROOT, "references", "outputs.md") },
    { name: "references/workflow.md", path: path.join(ROOT, "references", "workflow.md") },
  ];

  for (const file of keyFiles) {
    const content = await fs.readFile(file.path, "utf8");

    it(`${file.name}: 必须明确 book-source.json 是唯一默认交付物`, () => {
      assert.ok(
        content.includes("book-source.json") && (
          content.includes("唯一") ||
          content.includes("sole") ||
          content.includes("only") ||
          content.includes("默认交付物") ||
          content.includes("default") ||
          content.includes("user deliverable")
        ),
        `${file.name} 应明确 book-source.json 是唯一默认交付物`,
      );
    });

    it(`${file.name}: 必须明确 runs 下保存过程记录`, () => {
      assert.ok(
        content.includes("runs/") || content.includes("runs\\"),
        `${file.name} 应提及 runs/ 目录`,
      );
    });
  }
});
