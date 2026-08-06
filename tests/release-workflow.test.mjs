import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return fs.readFile(path.join(ROOT, relativePath), "utf8");
}

test("release workflow uses maintained notes and package version", async () => {
  const packageJson = JSON.parse(await read("legado-book-source-generator/package.json"));
  const workflow = await read(".github/workflows/release.yml");
  const packageScript = await read("validator/package-release.ps1");
  const notesPath = path.join(ROOT, "release-notes", `v${packageJson.version}.md`);

  await fs.access(notesPath);
  assert.match(workflow, /push:\s*\n\s*tags:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--notes-file/);
  assert.doesNotMatch(workflow, /--generate-notes/);
  assert.match(packageScript, /legado-book-source-generator\\package\.json/);
  assert.doesNotMatch(packageScript, /\[string\]\$Version\s*=\s*"v\d/);
});
