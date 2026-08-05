#!/usr/bin/env node
/* eslint-env node */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function usage() {
  return [
    "用法:",
    "  node \"<repo>/tools/export-claude-session.mjs\" [work-dir] [--out <file-or-dir>]",
    "  node \"<repo>/tools/export-claude-session.mjs\" --cwd <work-dir> [--out <file-or-dir>]",
    "  node \"<repo>/tools/export-claude-session.mjs\" --session <session-id> [--out <file-or-dir>]",
    "",
    "选项:",
    "  --cwd <dir>          选择该工作目录下最新的 Claude Code session，默认当前目录",
    "  --session <id>       指定 session id，并在全部 Claude Code 项目中查找",
    "  --out <file-or-dir>  输出 Markdown 文件或目录；目录时自动命名",
    "  --claude-home <dir>  Claude 配置目录，默认 CLAUDE_CONFIG_DIR 或 ~/.claude",
    "",
    "测试/覆盖:",
    "  CLAUDE_CODE_LOG_COMMAND 可设置为 JSON 命令数组，例如 [\"node\",\"fake-exporter.mjs\"]",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 需要参数`);
      args[arg.slice(2)] = value;
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) throw new Error(`只能指定一个工作目录参数: ${positional.join(" ")}`);
  if (positional.length === 1 && args.cwd) throw new Error("工作目录只能用位置参数或 --cwd 指定一种");
  if (positional.length === 1) args.cwd = positional[0];
  return args;
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function directoryExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function claudeHomeDir(args) {
  const configured = args["claude-home"]
    || process.env.CLAUDE_CONFIG_DIR
    || path.join(os.homedir(), ".claude");
  return path.resolve(configured);
}

function claudeProjectDirName(workDir) {
  return path.resolve(workDir).replace(/[:\\/]/g, "-");
}

function findJsonlCandidates(root) {
  if (!directoryExists(root)) return [];
  const candidates = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        candidates.push({
          path: fullPath,
          sessionId: path.basename(entry.name, ".jsonl"),
          mtimeMs: fs.statSync(fullPath).mtimeMs,
        });
      }
    }
  }
  return candidates;
}

function latestCandidate(candidates) {
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

function findSession(args, cwd) {
  const projectsRoot = path.join(claudeHomeDir(args), "projects");
  if (args.session) {
    const candidate = findJsonlCandidates(projectsRoot)
      .find((item) => item.sessionId === args.session);
    if (!candidate) throw new Error(`未找到 Claude Code session: ${args.session}`);
    return candidate;
  }

  const projectRoot = path.join(projectsRoot, claudeProjectDirName(cwd));
  const candidate = latestCandidate(findJsonlCandidates(projectRoot));
  if (!candidate) {
    throw new Error(`未找到工作目录 ${cwd} 对应的 Claude Code session。可用 --session <id> 指定。`);
  }
  return candidate;
}

function resolveOutPath(outArg) {
  const defaultFile = "claude-session-export.md";
  if (!outArg) return path.join(os.tmpdir(), defaultFile);
  const resolved = path.resolve(outArg);
  if (directoryExists(resolved)) return path.join(resolved, defaultFile);
  if (!fs.existsSync(resolved) && (
    outArg.endsWith("/")
    || outArg.endsWith("\\")
    || path.extname(resolved) === ""
  )) {
    fs.mkdirSync(resolved, { recursive: true });
    return path.join(resolved, defaultFile);
  }
  return resolved;
}

function resolveWindowsCommand(command) {
  if (/[\\/]/.test(command) || path.extname(command)) return command;
  try {
    const found = execFileSync("where.exe", [command], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return found.find((item) => /\.(cmd|bat|exe)$/i.test(item)) || found[0] || command;
  } catch {
    return command;
  }
}

function runCommand(command, args) {
  if (process.platform === "win32") {
    const resolved = resolveWindowsCommand(command);
    if (/\.(cmd|bat)$/i.test(resolved)) {
      return execFileSync("cmd.exe", ["/d", "/c", "call", resolved, ...args], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
      });
    }
    return execFileSync(resolved, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  return execFileSync(command, args, {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function exporterCommands() {
  if (process.env.CLAUDE_CODE_LOG_COMMAND) {
    let parsed;
    try {
      parsed = JSON.parse(process.env.CLAUDE_CODE_LOG_COMMAND);
    } catch (error) {
      throw new Error(`CLAUDE_CODE_LOG_COMMAND 必须是 JSON 命令数组: ${error.message}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("CLAUDE_CODE_LOG_COMMAND 必须是非空 JSON 命令数组");
    }
    return [parsed.map(String)];
  }
  return [
    ["claude-code-log"],
    ["uvx", "claude-code-log"],
    ["npx", "--yes", "claude-code-log"],
  ];
}

function exportTranscript(candidate, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const errors = [];
  for (const command of exporterCommands()) {
    const [bin, ...prefixArgs] = command;
    try {
      runCommand(bin, [
        ...prefixArgs,
        candidate.path,
        "--detail", "high",
        "--format", "md",
        "--compact",
        "-o", outPath,
      ]);
      if (!fileExists(outPath)) throw new Error("导出命令成功退出，但没有生成输出文件");
      return command.join(" ");
    } catch (error) {
      fs.rmSync(outPath, { force: true });
      errors.push(`${command.join(" ")}: ${String(error.message || error)}`);
    }
  }
  throw new Error(`claude-code-log 导出失败；未生成原始 JSONL 兜底文件。${errors.join(" | ")}`);
}

function main(argv) {
  const args = parseArgs(argv);
  const cwd = path.resolve(args.cwd || process.cwd());
  const candidate = findSession(args, cwd);
  const outPath = resolveOutPath(args.out);
  const exporter = exportTranscript(candidate, outPath);
  return {
    ok: true,
    sessionId: candidate.sessionId,
    sourcePath: candidate.path,
    outPath,
    exporter,
  };
}

try {
  const result = main(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exitCode = 1;
}
