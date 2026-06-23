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

async function writeFakeOpencode(tmpDir, sessions, exports = {}) {
  const fakeOpencode = path.join(tmpDir, process.platform === "win32" ? "opencode.cmd" : "opencode");
  const fakeCli = path.join(tmpDir, "fake-opencode.mjs");
  const sessionsJson = JSON.stringify(sessions);
  await fs.writeFile(fakeCli, [
    `const sessions = ${JSON.stringify(sessionsJson)};`,
    `const exports = ${JSON.stringify(exports)};`,
    "const args = process.argv.slice(2);",
    "if (args[0] === 'session') { console.log(sessions); process.exit(0); }",
    "if (args[0] === 'export') { console.log(exports[args[1]] || JSON.stringify({ exported: args[1] })); process.exit(0); }",
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
      `node "${fakeCli}" "$@"`,
    ].join("\n"), "utf8");
    await fs.chmod(fakeOpencode, 0o755);
  }
  return fakeOpencode;
}

describe("export-opencode-session", () => {
  it("exports latest opencode session for a work directory without PowerShell JSON parsing", async () => {
    const tmpDir = await makeTmpDir();
    const out = path.join(tmpDir, "session-export.json");
    const fakeOpencode = await writeFakeOpencode(tmpDir, [
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
    ], {
      ses_latest: JSON.stringify({
        id: "ses_latest",
        title: "生成刺猬猫书源",
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "生成刺猬猫书源" }],
          },
          {
            role: "assistant",
            parts: [
              { type: "text", text: "我先检查状态。" },
              {
                type: "tool",
                tool: "Bash",
                input: { command: "node scripts/bsg.mjs android --run runs/ciweimao-com" },
                output: "requiredUserAction: android_device_needed",
              },
            ],
          },
        ],
      }),
    });

    const result = await execFileAsync("node", [
      SCRIPT,
      "--cwd", "D:\\Narylr\\skill-test",
      "--out", out,
      "--opencode", fakeOpencode,
    ], { encoding: "utf8" });

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.sessionId, "ses_latest");
    assert.equal(parsed.cleanPath, out.replace(/\.json$/i, ".clean.md"));
    const cleaned = await fs.readFile(parsed.cleanPath, "utf8");
    assert.match(cleaned, /# OpenCode Session Clean Export/);
    assert.match(cleaned, /生成刺猬猫书源/);
    assert.match(cleaned, /node scripts\/bsg\.mjs android --run runs\/ciweimao-com/);
    assert.match(cleaned, /requiredUserAction: android_device_needed/);
    assert.doesNotMatch(cleaned, /"parts":/);
  });

  it("defaults to current directory and writes a fixed export filename", async () => {
    const tmpDir = await makeTmpDir();
    const defaultOut = path.join(tmpDir, "opencode-session-export.json");
    const fakeOpencode = await writeFakeOpencode(tmpDir, [
      {
        id: "ses_current",
        title: "当前目录会话",
        updated: 10,
        directory: tmpDir,
      },
    ]);

    const result = await execFileAsync("node", [
      SCRIPT,
      "--opencode", fakeOpencode,
    ], { cwd: tmpDir, encoding: "utf8" });

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.sessionId, "ses_current");
    assert.equal(parsed.outPath, defaultOut);
    assert.equal(parsed.cleanPath, path.join(tmpDir, "opencode-session-export.clean.md"));
    assert.equal(await fs.readFile(defaultOut, "utf8"), "{\"exported\":\"ses_current\"}\n");
  });

  it("accepts the work directory as a positional argument", async () => {
    const tmpDir = await makeTmpDir();
    const workDir = path.join(tmpDir, "work");
    await fs.mkdir(workDir);
    const fakeOpencode = await writeFakeOpencode(tmpDir, [
      {
        id: "ses_positional",
        title: "目标目录会话",
        updated: 10,
        directory: workDir,
      },
    ]);

    const result = await execFileAsync("node", [
      SCRIPT,
      workDir,
      "--opencode", fakeOpencode,
    ], { cwd: tmpDir, encoding: "utf8" });

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.sessionId, "ses_positional");
    assert.equal(parsed.outPath, path.join(workDir, "opencode-session-export.json"));
  });

  it("cleans an existing opencode export without invoking opencode", async () => {
    const tmpDir = await makeTmpDir();
    const input = path.join(tmpDir, "raw.json");
    await fs.writeFile(input, JSON.stringify({
      id: "ses_clean_only",
      directory: tmpDir,
      messages: [
        { role: "user", parts: [{ text: "开始黑盒" }] },
        {
          role: "assistant",
          parts: [
            { text: "读取文件。" },
            { tool: "Read", input: { filePath: "D:/Narylr/skill-test/test.md" }, output: "# test" },
          ],
        },
      ],
    }), "utf8");

    const result = await execFileAsync("node", [
      SCRIPT,
      "--clean-only", input,
    ], { encoding: "utf8" });

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.outPath, input);
    assert.equal(parsed.cleanPath, path.join(tmpDir, "raw.clean.md"));
    const cleaned = await fs.readFile(parsed.cleanPath, "utf8");
    assert.match(cleaned, /ses_clean_only/);
    assert.match(cleaned, /开始黑盒/);
    assert.match(cleaned, /D:\/Narylr\/skill-test\/test\.md/);
  });

  it("extracts opencode state tool input and output fields", async () => {
    const tmpDir = await makeTmpDir();
    const input = path.join(tmpDir, "state-tool.json");
    await fs.writeFile(input, JSON.stringify({
      info: { id: "ses_state_tool", title: "真实结构" },
      messages: [
        {
          info: { role: "assistant" },
          parts: [
            {
              type: "tool",
              tool: "bash",
              state: {
                status: "completed",
                input: { command: "node bsg.mjs status --run runs/demo" },
                output: "{\"ok\":true}",
              },
            },
            {
              type: "tool",
              tool: "read",
              state: {
                status: "completed",
                input: { filePath: "D:/Narylr/skill-test/test.md" },
                output: "# test",
              },
            },
          ],
        },
      ],
    }), "utf8");

    const result = await execFileAsync("node", [SCRIPT, "--clean-only", input], { encoding: "utf8" });
    const parsed = JSON.parse(result.stdout);
    const cleaned = await fs.readFile(parsed.cleanPath, "utf8");

    assert.match(cleaned, /tool calls: 2/);
    assert.match(cleaned, /node bsg\.mjs status --run runs\/demo/);
    assert.match(cleaned, /D:\/Narylr\/skill-test\/test\.md/);
    assert.match(cleaned, /\{"ok":true\}/);
  });
});
