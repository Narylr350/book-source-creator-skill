import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "export-opencode-session.mjs");

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "opencode-export-"));
}

describe("export-opencode-session", () => {
  it("exports latest opencode session for a work directory without PowerShell JSON parsing", async () => {
    const tmpDir = await makeTmpDir();
    const out = path.join(tmpDir, "session-export.json");
    const fakeOpencode = path.join(tmpDir, process.platform === "win32" ? "opencode.cmd" : "opencode");
    const fakeCli = path.join(tmpDir, "fake-opencode.mjs");
    const sessions = JSON.stringify([
      {
        id: "ses_old",
        title: "生成刺猬猫书源",
        updated: 1,
        directory: "D:\\Narylr",
      },
      {
        id: "ses_latest",
        title: "生成刺猬猫书源",
        updated: 3,
        directory: "D:\\Narylr\\skill-test",
      },
      {
        id: "ses_other",
        title: "别的会话",
        updated: 9,
        directory: "D:\\Narylr\\other",
      },
    ]);
    await fs.writeFile(fakeCli, [
      `const sessions = ${JSON.stringify(sessions)};`,
      "const args = process.argv.slice(2);",
      "if (args[0] === 'session') { console.log(sessions); process.exit(0); }",
      "if (args[0] === 'export') { console.log(JSON.stringify({ exported: args[1] })); process.exit(0); }",
      "process.exit(1);",
    ].join("\n"), "utf8");

    if (process.platform === "win32") {
      await fs.writeFile(fakeOpencode, [
        "@echo off",
        `node "${fakeCli}" %*`,
      ].join("\r\n"), "utf8");
    } else {
      await fs.writeFile(fakeOpencode, [
        "#!/bin/sh",
        "if [ \"$1\" = session ]; then",
        `  printf '%s\\n' '${sessions.replaceAll("'", "'\\''")}'`,
        "  exit 0",
        "fi",
        "if [ \"$1\" = export ]; then",
        "  printf '{\"exported\":\"%s\"}\\n' \"$2\"",
        "  exit 0",
        "fi",
        "exit 1",
      ].join("\n"), "utf8");
      await fs.chmod(fakeOpencode, 0o755);
    }

    const result = await execFileAsync("node", [
      SCRIPT,
      "--cwd", "D:\\Narylr\\skill-test",
      "--out", out,
      "--opencode", fakeOpencode,
    ], { encoding: "utf8" });

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.sessionId, "ses_latest");
    assert.equal(await fs.readFile(out, "utf8"), "{\"exported\":\"ses_latest\"}\n");
  });
});
