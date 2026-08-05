import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "tools", "export-claude-session.mjs");

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "claude-export-"));
}

function projectDirName(workDir) {
  return path.resolve(workDir).replace(/[:\\/]/g, "-");
}

async function writeSession(claudeHome, workDir, sessionId, mtime) {
  const projectDir = path.join(claudeHome, "projects", projectDirName(workDir));
  await fs.mkdir(projectDir, { recursive: true });
  const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);
  await fs.writeFile(sessionPath, JSON.stringify({ sessionId, cwd: workDir }), "utf8");
  await fs.utimes(sessionPath, mtime, mtime);
  return sessionPath;
}

async function writeFakeExporter(tmpDir, { fail = false } = {}) {
  const exporter = path.join(tmpDir, fail ? "fake-exporter-fail.mjs" : "fake-exporter.mjs");
  const source = fail
    ? "process.stderr.write('forced failure\\n'); process.exit(2);\n"
    : [
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "const args = process.argv.slice(2);",
      "const outIndex = args.indexOf('-o');",
      "if (outIndex < 0 || !args[outIndex + 1]) process.exit(3);",
      "fs.writeFileSync(args[outIndex + 1], `# Export\\n\\n${path.basename(args[0])}\\n`, 'utf8');",
    ].join("\n");
  await fs.writeFile(exporter, source, "utf8");
  return exporter;
}

function exporterEnv(exporter) {
  return {
    ...process.env,
    CLAUDE_CODE_LOG_COMMAND: JSON.stringify([process.execPath, exporter]),
  };
}

describe("export-claude-session", () => {
  it("exports the latest Claude Code session for the requested work directory", async () => {
    const tmpDir = await makeTmpDir();
    const claudeHome = path.join(tmpDir, ".claude");
    const workDir = path.join(tmpDir, "target-work");
    const otherWorkDir = path.join(tmpDir, "other-work");
    const out = path.join(tmpDir, "session.md");
    const exporter = await writeFakeExporter(tmpDir);
    await writeSession(claudeHome, workDir, "session-old", new Date("2026-01-01T00:00:00Z"));
    const latestPath = await writeSession(claudeHome, workDir, "session-latest", new Date("2026-01-02T00:00:00Z"));
    await writeSession(claudeHome, otherWorkDir, "session-other", new Date("2026-01-03T00:00:00Z"));

    const result = await execFileAsync(process.execPath, [
      SCRIPT,
      "--cwd", workDir,
      "--claude-home", claudeHome,
      "--out", out,
    ], { encoding: "utf8", env: exporterEnv(exporter) });

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.sessionId, "session-latest");
    assert.equal(parsed.sourcePath, latestPath);
    assert.equal(parsed.outPath, out);
    assert.match(await fs.readFile(out, "utf8"), /session-latest\.jsonl/);
  });

  it("finds an explicit session across projects and creates an extensionless output directory", async () => {
    const tmpDir = await makeTmpDir();
    const claudeHome = path.join(tmpDir, ".claude");
    const workDir = path.join(tmpDir, "work");
    const outDir = path.join(tmpDir, "audit-output");
    const exporter = await writeFakeExporter(tmpDir);
    const sessionPath = await writeSession(claudeHome, workDir, "session-explicit", new Date());

    const result = await execFileAsync(process.execPath, [
      SCRIPT,
      "--session", "session-explicit",
      "--claude-home", claudeHome,
      "--out", outDir,
    ], { encoding: "utf8", env: exporterEnv(exporter) });

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.sourcePath, sessionPath);
    assert.equal(parsed.outPath, path.join(outDir, "claude-session-export.md"));
    assert.match(await fs.readFile(parsed.outPath, "utf8"), /session-explicit\.jsonl/);
  });

  it("uses the system temporary directory by default", async (t) => {
    const tmpDir = await makeTmpDir();
    const claudeHome = path.join(tmpDir, ".claude");
    const workDir = path.join(tmpDir, "work");
    const defaultOut = path.join(os.tmpdir(), "claude-session-export.md");
    const exporter = await writeFakeExporter(tmpDir);
    await writeSession(claudeHome, workDir, "session-default", new Date());
    await fs.rm(defaultOut, { force: true });
    t.after(() => fs.rm(defaultOut, { force: true }));

    const result = await execFileAsync(process.execPath, [
      SCRIPT,
      workDir,
      "--claude-home", claudeHome,
    ], { encoding: "utf8", env: exporterEnv(exporter) });

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.outPath, defaultOut);
    assert.match(await fs.readFile(defaultOut, "utf8"), /session-default\.jsonl/);
  });

  it("fails without copying raw JSONL when the Markdown exporter fails", async () => {
    const tmpDir = await makeTmpDir();
    const claudeHome = path.join(tmpDir, ".claude");
    const workDir = path.join(tmpDir, "work");
    const out = path.join(tmpDir, "failed.md");
    const exporter = await writeFakeExporter(tmpDir, { fail: true });
    await writeSession(claudeHome, workDir, "session-failure", new Date());

    await assert.rejects(
      execFileAsync(process.execPath, [
        SCRIPT,
        "--cwd", workDir,
        "--claude-home", claudeHome,
        "--out", out,
      ], { encoding: "utf8", env: exporterEnv(exporter) }),
      (error) => {
        assert.match(error.stderr, /未生成原始 JSONL 兜底文件/);
        return true;
      },
    );
    await assert.rejects(fs.access(out));
  });
});
