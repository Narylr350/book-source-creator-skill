import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

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

    it(`${file.name}: 必须明确 book-source.json 是默认交付物`, () => {
      assert.ok(
        content.includes("book-source.json") && (
          content.includes("默认") ||
          content.includes("default") ||
          content.includes("user deliverable")
        ),
        `${file.name} 应明确 book-source.json 是默认交付物`,
      );
    });

    it(`${file.name}: community-js 必须是显式可选目标`, () => {
      assert.ok(
        content.includes("book-source.js") && (
          content.includes("显式") ||
          content.includes("community-js") ||
          content.includes("社区维护版")
        ),
        `${file.name} 应明确 book-source.js 只属于显式 community-js 目标`,
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
