#!/usr/bin/env node
/* eslint-env node */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function usage() {
  return [
    "用法:",
    "  node \"<skill-dir>/scripts/export-opencode-session.mjs\" [work-dir] [--out <file-or-dir>]",
    "  node \"<skill-dir>/scripts/export-opencode-session.mjs\" [--cwd <work-dir>] [--out <file-or-dir>]",
    "  node \"<skill-dir>/scripts/export-opencode-session.mjs\" --session <session-id> [--out <file-or-dir>]",
    "  node \"<skill-dir>/scripts/export-opencode-session.mjs\" --clean-only <export-json>",
    "",
    "选项:",
    "  --cwd <dir>          选择该工作目录下最新的 opencode session，默认当前目录",
    "  --session <id>       指定 session id，跳过自动查找",
    "  --out <file-or-dir>  输出 JSON 文件或目录；目录时自动命名",
    "  --clean-only <file>  只清洗已有 opencode export JSON，不调用 opencode",
    "  --sanitize           调用 opencode export --sanitize 脱敏",
    "  --max-count <n>      session list 数量，默认 100",
    "  --opencode <cmd>     opencode 命令路径，默认 opencode",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  const positional = [];
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
      positional.push(arg);
    }
  }
  if (positional.length > 1) throw new Error(`只能指定一个工作目录参数: ${positional.join(" ")}`);
  if (positional.length === 1 && args.cwd) throw new Error("工作目录只能用位置参数或 --cwd 指定一种");
  if (positional.length === 1) args.cwd = positional[0];
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

function resolveOutPath(outArg, cwd) {
  const defaultFile = "opencode-session-export.json";
  if (!outArg) return path.join(cwd, defaultFile);
  const resolved = path.resolve(outArg);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return path.join(resolved, defaultFile);
  }
  if (outArg.endsWith("/") || outArg.endsWith("\\")) return path.join(resolved, defaultFile);
  return resolved;
}

function cleanOutPath(jsonPath) {
  return jsonPath.replace(/\.json$/i, ".clean.md");
}

function truncate(value, max = 1200) {
  const text = String(value || "").replace(/\r\n/g, "\n").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... [truncated ${text.length - max} chars]`;
}

function redact(text) {
  return String(text || "")
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s'",;]+/gi, "$1$2REDACTED")
    .replace(/((?:cookie|token|password|passwd|secret|api[_-]?key)\s*[:=]\s*)[^\s'",;]+/gi, "$1REDACTED");
}

function markdownFence(text) {
  return ["```text", redact(truncate(text)).replaceAll("```", "'''"), "```"].join("\n");
}

function messageList(data) {
  const raw = Array.isArray(data)
    ? data
    : data?.messages || data?.session?.messages || data?.data?.messages || [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

function partList(message) {
  const raw = message?.parts || message?.message?.parts || message?.content || [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") return [{ type: "text", text: raw }];
  return [];
}

function textFromPart(part) {
  if (typeof part === "string") return part;
  if (typeof part?.text === "string") return part.text;
  if (typeof part?.content === "string") return part.content;
  if (Array.isArray(part?.content)) {
    return part.content.map((item) => textFromPart(item)).filter(Boolean).join("\n");
  }
  return "";
}

function stringField(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

function toolFromPart(part) {
  if (!part || typeof part !== "object") return null;
  const state = part.state && typeof part.state === "object" ? part.state : {};
  const input = part.input || part.args || part.arguments || part.tool?.input || state.input || {};
  const name = stringField(part.tool, part.name, part.toolName, part.type);
  const command = stringField(part.command, input.command, input.cmd, input.shell);
  const filePath = stringField(input.filePath, input.path, input.file, input.filename, part.filePath, part.path);
  const output = stringField(part.output, part.result, part.error, part.tool?.output, state.output, state.error, state.metadata?.output);
  if (!command && !filePath && !output) return null;
  return {
    name: name && name !== "text" ? name : "tool",
    command,
    filePath,
    output,
  };
}

function sessionMeta(data) {
  const session = data?.session || data || {};
  const info = data?.info || session.info || {};
  const pathInfo = info.path || session.path || {};
  return {
    id: stringField(session.id, data?.id, info.sessionID, info.id),
    title: stringField(session.title, data?.title, info.title),
    directory: stringField(session.directory, data?.directory, session.cwd, data?.cwd, pathInfo.cwd),
    created: session.created || data?.created || info.time?.created || null,
    updated: session.updated || data?.updated || info.time?.completed || null,
  };
}

function renderCleanMarkdown(data, sourcePath) {
  const meta = sessionMeta(data);
  const messages = messageList(data);
  const tools = [];
  const sessionLines = [
    "# OpenCode Session Clean Export",
    "",
    "## Session",
    `- source: ${sourcePath}`,
    `- id: ${meta.id || "(unknown)"}`,
    `- title: ${meta.title || "(unknown)"}`,
    `- directory: ${meta.directory || "(unknown)"}`,
  ];
  if (meta.created) sessionLines.push(`- created: ${meta.created}`);
  if (meta.updated) sessionLines.push(`- updated: ${meta.updated}`);

  const timelineLines = ["", "## Timeline"];
  messages.forEach((message, index) => {
    const role = stringField(message.role, message.info?.role, message.author?.role, message.message?.role, message.type) || "message";
    timelineLines.push("", `### ${String(index + 1).padStart(3, "0")} ${role}`);
    const parts = partList(message);
    for (const part of parts) {
      const text = textFromPart(part);
      if (text) {
        timelineLines.push("", markdownFence(text));
      }
      const tool = toolFromPart(part);
      if (tool) {
        tools.push(tool);
        timelineLines.push("", `- tool: ${tool.name}`);
        if (tool.command) timelineLines.push(`  - command: \`${redact(truncate(tool.command, 300)).replaceAll("`", "'")}\``);
        if (tool.filePath) timelineLines.push(`  - file: \`${tool.filePath.replaceAll("`", "'")}\``);
        if (tool.output) timelineLines.push("", markdownFence(tool.output));
      }
    }
  });

  const commands = [...new Set(tools.map((tool) => tool.command).filter(Boolean))];
  const files = [...new Set(tools.map((tool) => tool.filePath).filter(Boolean))];
  const summaryLines = [
    "",
    "## Tool Summary",
    `- messages: ${messages.length}`,
    `- tool calls: ${tools.length}`,
    `- commands: ${commands.length}`,
    `- files: ${files.length}`,
  ];
  if (commands.length > 0) {
    summaryLines.push("", "### Commands", ...commands.slice(0, 50).map((cmd) => `- \`${redact(truncate(cmd, 300)).replaceAll("`", "'")}\``));
  }
  if (files.length > 0) {
    summaryLines.push("", "### Files", ...files.slice(0, 50).map((file) => `- \`${file.replaceAll("`", "'")}\``));
  }

  return `${[...sessionLines, ...summaryLines, ...timelineLines].join("\n")}\n`;
}

function writeCleanExport(jsonPath) {
  const raw = fs.readFileSync(jsonPath, "utf8");
  const data = JSON.parse(raw);
  const cleanPath = cleanOutPath(jsonPath);
  fs.writeFileSync(cleanPath, renderCleanMarkdown(data, jsonPath), "utf8");
  return cleanPath;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args["clean-only"]) {
    const outPath = path.resolve(args["clean-only"]);
    if (!fs.existsSync(outPath)) throw new Error(`opencode export JSON 不存在: ${outPath}`);
    const cleanPath = writeCleanExport(outPath);
    return { ok: true, mode: "clean-only", outPath, cleanPath };
  }

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
  const cleanPath = writeCleanExport(outPath);

  return {
    ok: true,
    sessionId: session.id,
    title: session.title || null,
    directory: session.directory || null,
    outPath,
    cleanPath,
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
