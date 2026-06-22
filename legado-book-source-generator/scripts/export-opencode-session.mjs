#!/usr/bin/env node
/* eslint-env node */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function usage() {
  return [
    "用法:",
    "  node scripts/export-opencode-session.mjs [--cwd <work-dir>] [--out <file-or-dir>]",
    "  node scripts/export-opencode-session.mjs --session <session-id> [--out <file-or-dir>]",
    "",
    "选项:",
    "  --cwd <dir>          选择该工作目录下最新的 opencode session，默认当前目录",
    "  --session <id>       指定 session id，跳过自动查找",
    "  --out <file-or-dir>  输出 JSON 文件或目录；目录时自动命名",
    "  --sanitize           调用 opencode export --sanitize 脱敏",
    "  --max-count <n>      session list 数量，默认 100",
    "  --opencode <cmd>     opencode 命令路径，默认 opencode",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sanitize") {
      args.sanitize = true;
    } else if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 需要参数`);
      args[arg.slice(2)] = value;
      i += 1;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return args;
}

function runCommand(command, args, options = {}) {
  if (process.platform === "win32") {
    const resolved = resolveWindowsCommand(command);
    if (/\.(cmd|bat)$/i.test(resolved)) {
      return execFileSync("cmd.exe", ["/d", "/c", "call", resolved, ...args], {
        encoding: "utf8",
        cwd: options.cwd,
        windowsHide: true,
        timeout: 120000,
      });
    }
    return execFileSync(resolved, args, {
      encoding: "utf8",
      cwd: options.cwd,
      windowsHide: true,
      timeout: 120000,
    });
  }
  return execFileSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd,
    timeout: 120000,
  });
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

function normalizeDir(value) {
  return path.resolve(value).replaceAll("\\", "/").toLowerCase();
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    const start = output.indexOf("[");
    const end = output.lastIndexOf("]");
    if (start >= 0 && end > start) return JSON.parse(output.slice(start, end + 1));
    throw new Error(`${label} 输出不是合法 JSON: ${error.message}`);
  }
}

function findLatestSession(opencode, cwd, maxCount) {
  const output = runCommand(opencode, ["session", "list", "--format", "json", "--max-count", String(maxCount)], { cwd });
  const sessions = parseJsonOutput(output, "opencode session list");
  if (!Array.isArray(sessions)) throw new Error("opencode session list 输出不是数组");

  const target = normalizeDir(cwd);
  const matches = sessions
    .filter((session) => session?.directory && normalizeDir(session.directory) === target)
    .sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));
  if (matches.length === 0) {
    throw new Error(`未找到工作目录 ${cwd} 对应的 opencode session。可用 --session <id> 指定。`);
  }
  return matches[0];
}

function resolveOutPath(outArg, cwd, sessionId) {
  const defaultFile = `opencode-session-${sessionId}.json`;
  if (!outArg) return path.join(cwd, defaultFile);
  const resolved = path.resolve(outArg);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return path.join(resolved, defaultFile);
  }
  if (outArg.endsWith("/") || outArg.endsWith("\\")) return path.join(resolved, defaultFile);
  return resolved;
}

function main(argv) {
  const args = parseArgs(argv);
  const opencode = args.opencode || "opencode";
  const cwd = path.resolve(args.cwd || process.cwd());
  const maxCount = Number(args["max-count"] || 100);
  if (!Number.isInteger(maxCount) || maxCount <= 0) throw new Error("--max-count 必须是正整数");

  const session = args.session
    ? { id: args.session, directory: null, title: null, updated: null }
    : findLatestSession(opencode, cwd, maxCount);
  const outPath = resolveOutPath(args.out, cwd, session.id);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const exportArgs = ["export", session.id];
  if (args.sanitize) exportArgs.push("--sanitize");
  const exported = runCommand(opencode, exportArgs, { cwd });
  fs.writeFileSync(outPath, exported, "utf8");

  return {
    ok: true,
    sessionId: session.id,
    title: session.title || null,
    directory: session.directory || null,
    outPath,
    sanitized: Boolean(args.sanitize),
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
