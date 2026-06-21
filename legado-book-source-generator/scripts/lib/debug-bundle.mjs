// 用法: node scripts/bsg.mjs debug-bundle [--cwd <工作目录>] [--run <run目录>] [--claude-session <sessionId>]
// 说明: 打包当前 run 目录的工件 + claude-code-log 导出的对话 Markdown
//   --cwd           指定项目根目录（默认当前目录）。脚本会去 runs/ 找最新 run
//   --run           直接指定 run 目录，跳过自动查找
//   --claude-session  指定 session ID 导出对话（不加则取最近的一个）
//   输出到 <cwd>/debug-bundles/<slug>-<timestamp>/
// 不能直接用 node scripts/lib/debug-bundle.mjs，必须通过 bsg.mjs 入口

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fail, fileExists, loadAndVerify, parseArg, readJsonFile, writeJsonFile } from "./state.mjs";

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function copyFileEnsuringDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function findLatestRunDir(cwd) {
  const runsRoot = path.join(cwd, "runs");
  if (!fileExists(runsRoot)) return null;
  const candidates = fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsRoot, entry.name))
    .filter((dir) => fileExists(path.join(dir, "run-state.json")))
    .map((dir) => ({ dir, mtimeMs: fs.statSync(path.join(dir, "run-state.json")).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.dir || null;
}

function redactCookieValue(value) {
  if (typeof value !== "string") return "REDACTED";
  return value
    .split(";")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const eq = trimmed.indexOf("=");
      return eq >= 0 ? `${trimmed.slice(0, eq + 1)}REDACTED` : "REDACTED";
    })
    .join("; ");
}

function writeRedactedCookies(src, dest) {
  const parsed = readJsonFile(src);
  let redacted;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if (typeof parsed.domain === "string" && typeof parsed.cookie === "string") {
      redacted = { domain: parsed.domain, cookie: redactCookieValue(parsed.cookie) };
    } else {
      redacted = Object.fromEntries(
        Object.entries(parsed).map(([domain, cookie]) => [domain, redactCookieValue(cookie)])
      );
    }
  } else {
    redacted = "REDACTED";
  }
  writeJsonFile(dest, redacted);
}

function copyRunDir(runDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const entry of fs.readdirSync(runDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const src = path.join(runDir, entry.name);
    if (entry.name === "cookies.json") {
      const dest = path.join(destDir, "cookies.redacted.json");
      writeRedactedCookies(src, dest);
      copied.push("run/cookies.redacted.json");
      continue;
    }
    const dest = path.join(destDir, entry.name);
    copyFileEnsuringDir(src, dest);
    copied.push(`run/${entry.name}`);
  }
  return copied;
}

function copyOutput(state, bundleDir) {
  const sourceDir = path.join(state.workingDir, "outputs", state.siteSlug);
  if (!fileExists(sourceDir)) return [];
  const destDir = path.join(bundleDir, "outputs", state.siteSlug);
  fs.mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const src = path.join(sourceDir, entry.name);
    const dest = path.join(destDir, entry.name);
    copyFileEnsuringDir(src, dest);
    copied.push(`outputs/${state.siteSlug}/${entry.name}`);
  }
  return copied;
}

function copyTranscript(transcriptPath, bundleDir) {
  if (!transcriptPath) return { copied: [], included: false };
  const src = path.resolve(transcriptPath);
  if (!fileExists(src)) return { copied: [], included: false, missing: src };
  const dest = path.join(bundleDir, "transcript", path.basename(src));
  copyFileEnsuringDir(src, dest);
  return { copied: [`transcript/${path.basename(src)}`], included: true };
}

function claudeHomeDir() {
  if (process.env.BSG_TEST_CLAUDE_HOME) return process.env.BSG_TEST_CLAUDE_HOME;
  return path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude");
}

function claudeProjectDirName(workDir) {
  return path.resolve(workDir).replace(/[:\\/]/g, "-");
}

function findClaudeJsonlCandidates(projectDirName = null) {
  const projectsRoot = path.join(claudeHomeDir(), "projects");
  const root = projectDirName ? path.join(projectsRoot, projectDirName) : projectsRoot;
  if (!fileExists(root)) return [];
  const candidates = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        candidates.push({
          path: full,
          sessionId: path.basename(entry.name, ".jsonl"),
          mtimeMs: fs.statSync(full).mtimeMs,
        });
      }
    }
  }
  return candidates;
}

function findClaudeSessionJsonl(sessionId) {
  if (!sessionId) return null;
  return findClaudeJsonlCandidates().find((item) => item.sessionId === sessionId) || null;
}

function latestCandidate(candidates) {
  return candidates
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

function findLatestClaudeSessionJsonl(workDir) {
  if (workDir) {
    const projectCandidates = findClaudeJsonlCandidates(claudeProjectDirName(workDir));
    const projectLatest = latestCandidate(projectCandidates);
    if (projectLatest) return projectLatest;
  }
  return latestCandidate(findClaudeJsonlCandidates());
}

function claudeCodeLogCommands() {
  if (process.env.BSG_CLAUDE_CODE_LOG_COMMAND) {
    try {
      const parsed = JSON.parse(process.env.BSG_CLAUDE_CODE_LOG_COMMAND);
      if (Array.isArray(parsed) && parsed.length > 0) return [parsed.map(String)];
    } catch {
      return [[process.env.BSG_CLAUDE_CODE_LOG_COMMAND]];
    }
  }
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const localBin = path.join(home, ".local", "bin");
  const appDataNpm = process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null;
  const commands = [];
  const commandForExecutable = (file, extra = []) => {
    if (/\.(cmd|bat)$/i.test(file)) return ["cmd.exe", "/d", "/s", "/c", `"${file}"`, ...extra];
    return [file, ...extra];
  };
  const addIfExists = (file, extra = []) => {
    if (fileExists(file)) commands.push(commandForExecutable(file, extra));
  };

  for (const name of ["claude-code-log.exe", "claude-code-log.cmd", "claude-code-log"]) {
    addIfExists(path.join(localBin, name));
    if (appDataNpm) addIfExists(path.join(appDataNpm, name));
  }
  for (const name of ["uvx.exe", "uvx.cmd", "uvx"]) {
    addIfExists(path.join(localBin, name), ["claude-code-log"]);
    if (appDataNpm) addIfExists(path.join(appDataNpm, name), ["claude-code-log"]);
  }

  commands.push(
    ["claude-code-log"],
    ["uvx", "claude-code-log"],
    ["npx", "--yes", "claude-code-log"],
  );
  return commands;
}

function exportClaudeTranscript(sessionId, bundleDir, workDir) {
  const candidate = sessionId ? findClaudeSessionJsonl(sessionId) : findLatestClaudeSessionJsonl(workDir);
  if (!candidate) {
    return { copied: [], included: false, source: null, exporter: "claude-code-log", error: "session_jsonl_not_found" };
  }
  const jsonlPath = candidate.path;
  const outPath = path.join(bundleDir, "transcript", "claude-code-log.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const errors = [];
  for (const command of claudeCodeLogCommands()) {
    const [bin, ...prefixArgs] = command;
    try {
      execFileSync(bin, [
        ...prefixArgs,
        jsonlPath,
        "--detail", "high",
        "--format", "md",
        "--compact",
        "-o", outPath,
      ], { encoding: "utf-8", timeout: 60000 });
      return {
      copied: ["transcript/claude-code-log.md"],
      included: true,
      source: jsonlPath,
      sessionId: candidate.sessionId,
      exporter: command.join(" "),
      error: null,
      };
    } catch (e) {
      errors.push(`${command.join(" ")}: ${String(e.message || e)}`);
    }
  }

  const rawDest = path.join(bundleDir, "transcript", path.basename(jsonlPath));
  copyFileEnsuringDir(jsonlPath, rawDest);
  return {
    copied: [`transcript/${path.basename(jsonlPath)}`],
    included: true,
    source: jsonlPath,
    sessionId: candidate.sessionId,
    exporter: "raw-jsonl-fallback",
    error: errors.join(" | "),
  }
}

export function cmdDebugBundle(args) {
  const cwd = path.resolve(parseArg(args, "--cwd") || process.cwd());
  const runArg = parseArg(args, "--run");
  const runDir = runArg ? path.resolve(runArg) : findLatestRunDir(cwd);
  if (!runDir) {
    return fail(`未找到 run 目录。用法: node scripts/bsg.mjs debug-bundle [--cwd <work-dir>] 或 --run <run-dir>。当前 cwd: ${cwd}`);
  }

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const bundleRoot = path.join(state.workingDir || cwd, "debug-bundles");
  const bundleDir = path.join(bundleRoot, `${state.siteSlug}-${timestampForPath()}`);
  fs.mkdirSync(bundleDir, { recursive: true });

  const runFiles = copyRunDir(runDir, path.join(bundleDir, "run"));
  const outputFiles = copyOutput(state, bundleDir);
  const claudeSession = parseArg(args, "--claude-session");
  const transcriptArg = parseArg(args, "--transcript");
  const transcriptWorkDir = parseArg(args, "--cwd") ? cwd : (state.workingDir || cwd);
  const transcript = transcriptArg
    ? { ...copyTranscript(transcriptArg, bundleDir), source: transcriptArg, exporter: "manual" }
    : exportClaudeTranscript(claudeSession, bundleDir, transcriptWorkDir);
  const resolvedClaudeSession = claudeSession || transcript.sessionId || null;

  const manifest = {
    version: "1.0",
    createdAt: new Date().toISOString(),
    workingDir: state.workingDir,
    runDir,
    siteUrl: state.siteUrl,
    siteSlug: state.siteSlug,
    files: [...runFiles, ...outputFiles, ...transcript.copied],
    redactions: {
      cookiesJson: runFiles.includes("run/cookies.redacted.json") ? "redacted" : "not_present",
    },
    claude: {
      sessionId: resolvedClaudeSession,
      resumeCommand: resolvedClaudeSession ? `claude --resume ${resolvedClaudeSession}` : null,
      transcriptIncluded: transcript.included,
      transcriptMissing: transcript.missing || null,
      transcriptSource: transcript.source || null,
      exporter: transcript.exporter || null,
      exporterError: transcript.error || null,
    },
  };
  writeJsonFile(path.join(bundleDir, "manifest.json"), manifest);

  return {
    ok: true,
    bundleDir,
    runDir,
    siteSlug: state.siteSlug,
    includedTranscript: transcript.included,
    copiedFiles: manifest.files.length,
    message: "debug bundle 已生成。本地排障时直接读取该目录；cookies.json 已脱敏为 cookies.redacted.json。",
  };
}
