import fs from "node:fs";
import path from "node:path";
import { deriveSiteSlug } from "./slug.mjs";
import { initializeRunBundle } from "./output-bundle.mjs";
import {
  fail, parseArg, freshRunState, saveRunState, loadAndVerify,
  isInSkillInstallDir, blockForPendingUserAction, getPendingUserAction,
  ensureRunArtifacts, fileExists, readJsonFile,
} from "./state.mjs";
import {
  PHASE_ORDER, currentPhaseIndex, startPhase, completePhase,
  checkEnvironment, checkAdb, PHASE_READ_NEXT, phaseNextCommand,
} from "./phase-engine.mjs";
import { cmdRecordValidation } from "./validation-commands.mjs";

export function cmdInit(args) {
  if (args.length < 1) {
    return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" init <site-url> [--fast] [--cwd {dir}]");
  }

  const siteUrl = args[0];
  const fastMode = args.includes("--fast");
  const cwdIdx = args.indexOf("--cwd");
  const cwd = cwdIdx >= 0 ? path.resolve(args[cwdIdx + 1]) : process.cwd();

  let parsed;
  try { parsed = new URL(siteUrl); } catch {
    return fail("无效的站点 URL: " + siteUrl);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return fail("站点 URL 必须以 http:// 或 https:// 开头");
  }

  const inSkillDir = isInSkillInstallDir(cwd);
  const env = checkEnvironment();

  const siteSlug = deriveSiteSlug(siteUrl);
  const runsRoot = path.join(cwd, "runs");
  const runDir = initializeRunBundle(runsRoot, siteUrl);

  const state = freshRunState(siteUrl, siteSlug, fastMode ? "fast" : "full", cwd);
  state.adbDetected = checkAdb();
  saveRunState(runDir, state);
  ensureRunArtifacts(runDir, state);

  return {
    ok: true,
    nextAction: "probe_site",
    runDir,
    siteSlug,
    mode: state.mode,
    workingDir: cwd,
    environment: {
      allOk: env.allOk,
      results: env.results,
    },
    warnSkillDir: inSkillDir
      ? `当前在 skill 安装目录下运行。输出将写入 ${cwd}，建议切换到项目目录并用 --cwd 指定。`
      : null,
    message: fastMode
      ? "快速路径已启用。跳过 Browser MCP，直接进入网络分析。"
      : "完整路径。先匿名初探 4 条链路，判断站点结构和反爬。",
    hint: fastMode
      ? "用 HTTP fetch 匿名探索 search/detail/toc/content 链路，记录发现到 analysis.md。"
      : "用 Browser MCP 或 HTTP fetch 匿名探索 search/detail/toc/content 链路。检测登录入口、反爬、WebView 需求。",
    outputs: {
      runsRoot,
      runDir,
      stateFile: path.join(runDir, "run-state.json"),
      bookSourceDir: path.join(cwd, "outputs", siteSlug),
    },
    readNext: PHASE_READ_NEXT.probe,
    nextCommand: phaseNextCommand(runDir, "probe"),
  };
}

export function cmdStatus(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" status --run <run-dir>");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const phases = Object.entries(state.phases).map(([name, p]) => ({
    phase: name,
    status: p.status,
    ...(name === "assess" && p.rating ? { rating: p.rating } : {}),
    ...(name === "validate" ? { attempts: p.attempts, lastStatus: p.lastStatus, consecutiveSame: p.consecutiveSame } : {}),
  }));

  const completed = phases.filter((p) => p.status === "completed").map((p) => p.phase);
  const inProgress = phases.find((p) => p.status === "in_progress");
  const pending = phases.filter((p) => p.status === "pending").map((p) => p.phase);

  const currentPhase = inProgress ? inProgress.phase : (pending.length > 0 ? pending[0] : "all_completed");

  let nextAction = null;
  if (!inProgress && pending.length > 0) {
    const next = pending[0];
    nextAction = next === "assess" ? "record_assessment"
      : next === "analyze" ? "write_analysis"
      : next === "generate" ? "generate_json"
      : next === "validate" ? "run_validator"
      : next === "deliver" ? "deliver"
      : "probe_site";
  }

  return {
    ok: true,
    siteUrl: state.siteUrl,
    siteSlug: state.siteSlug,
    mode: state.mode,
    currentPhase,
    pendingUserAction: getPendingUserAction(state),
    repairContext: state.repairContext || null,
    userDecisions: state.userDecisions || {},
    completed,
    pending,
    inProgress: inProgress ? inProgress.phase : null,
    nextAction,
    readNext: PHASE_READ_NEXT[currentPhase] || [],
    nextCommand: phaseNextCommand(runDir, currentPhase),
    loginFeatures: state.loginFeatures,
    phases,
  };
}

export function cmdToolbox() {
  return {
    ok: true,
    mode: "toolbox",
    message: "按当前问题选择工具；中间阶段以诊断和修复为主，deliver 只做最终审计。",
    tools: [
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" init <url> [--cwd <dir>]", use: "创建 run 目录和初始过程文件。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" status --run <run-dir>", use: "查看当前阶段、pendingUserAction、repairContext 和下一步建议。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" check --run <run-dir>", use: "检查评估/登录/Android 决策是否缺证据。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" source inspect --run <run-dir>", use: "审计当前 book-source.json 的风险字段。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" android --run <run-dir>", use: "Android 单入口：检查设备/Probe，必要时启动 Probe，运行 android 验证并收敛报告。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" android-status", use: "只读诊断：检查 adb、设备/模拟器和 Android Probe 状态。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" validate --run <run-dir> [--mode http|browser|android]", use: "运行 validator 并写 validator-report.json。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" record-validation --run <run-dir> --status <status>", use: "把真实 validator-report.json 收敛成状态、能力矩阵和修复上下文。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" debug-bundle [--run <run-dir>]", use: "打包状态、报告、书源和会话导出，方便复盘。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" run --run <run-dir>", use: "可选状态助手：启动下一阶段，或把已有 validator-report.json 自动收敛。" },
    ],
    scenarios: [
      {
        name: "android_webview_or_login",
        when: "需要登录态、WebView/WebJs、入口反爬复核，或桌面 HTTP/Browser 不能代表阅读 App 行为。",
        readFirst: [
          "references/android-probe-guide.md",
          "references/policies.md",
          "references/validator-integration.md",
          "references/webview-behavior-matrix.md",
        ],
        commands: [
          "node \"<skill-dir>/scripts/bsg.mjs\" android --run <run-dir>",
        ],
      },
      {
        name: "validation_failure_repair",
        when: "validator-report.json 已生成但验证失败、blocked 或需要回修。",
        readFirst: [
          "references/failure-diagnosis.md",
          "references/validation-policy.md",
          "references/validator-integration.md",
        ],
        commands: [
          "node \"<skill-dir>/scripts/bsg.mjs\" record-validation --run <run-dir> --status <validator-report.status>",
          "node \"<skill-dir>/scripts/bsg.mjs\" status --run <run-dir>",
          "node \"<skill-dir>/scripts/bsg.mjs\" source inspect --run <run-dir>",
        ],
      },
    ],
    finalAudit: {
      command: "node \"<skill-dir>/scripts/bsg.mjs\" deliver --run <run-dir>",
      prerequisite: "validator-report.json 必须已通过 record-validation 收敛，rule-check.json / capability-matrix.json 必须对应当前 book-source.json。",
      use: "唯一最终交付审计；通过它之前不要宣称书源可用或 full pass。",
    },
  };
}

function runAgainCommand(runDir) {
  return `node "<skill-dir>/scripts/bsg.mjs" run --run ${runDir}`;
}

function recordAssessmentCommand(runDir) {
  return `node "<skill-dir>/scripts/bsg.mjs" record-assessment --run ${runDir}`;
}

function assessmentFactsReady(runDir) {
  const facts = readJsonFile(path.join(runDir, "site-facts.json"), null);
  if (!facts?.links) return false;
  return ["search", "detail", "toc", "content"].every((phase) => {
    const status = String(facts.links?.[phase]?.status || "unknown").trim().toLowerCase();
    return status && status !== "unknown";
  });
}

function analysisHasContent(runDir) {
  const analysisPath = path.join(runDir, "analysis.md");
  if (!fileExists(analysisPath)) return false;
  const text = readTextSafe(analysisPath);
  return /-\s+[^:\n]+:\s*\S/.test(text);
}

function sourcePathForState(state) {
  return path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
}

function sourceExists(state) {
  const sourcePath = sourcePathForState(state);
  if (!fileExists(sourcePath)) return false;
  const parsed = readJsonFile(sourcePath, null);
  return Array.isArray(parsed) && parsed.length > 0;
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function instructionForPhase(current, state, runDir) {
  if (current === "assess") {
    if (state.phases.assess.recorded === true) return completePhase(current, state, runDir);
    if (assessmentFactsReady(runDir)) {
      return {
        ok: true,
        currentPhase: "assess",
        nextAction: "run_command",
        readNext: PHASE_READ_NEXT.assess,
        message: "assessment.md 和 site-facts.json 已具备记录条件。执行 record-assessment，完成后继续运行 bsg run。",
        nextCommand: recordAssessmentCommand(runDir),
      };
    }
    return {
      ok: true,
      currentPhase: "assess",
      nextAction: "write_assessment",
      writeTarget: path.join(runDir, "assessment.md"),
      readNext: PHASE_READ_NEXT.assess,
      message: "填写 site-facts.json 和 assessment.md 的证据说明区；完成后继续运行 bsg run。",
      nextCommand: runAgainCommand(runDir),
    };
  }

  if (current === "analyze") {
    if (analysisHasContent(runDir)) return completePhase(current, state, runDir);
    return {
      ok: true,
      currentPhase: "analyze",
      nextAction: "write_analysis",
      writeTarget: path.join(runDir, "analysis.md"),
      readNext: PHASE_READ_NEXT.analyze,
      message: "按 search/detail/toc/content 写 analysis.md；完成后继续运行 bsg run。",
      nextCommand: runAgainCommand(runDir),
    };
  }

  if (current === "generate") {
    if (sourceExists(state)) return completePhase(current, state, runDir);
    return {
      ok: true,
      currentPhase: "generate",
      nextAction: "generate_json",
      writeTarget: sourcePathForState(state),
      readNext: PHASE_READ_NEXT.generate,
      message: "生成 book-source.json；完成后继续运行 bsg run。",
      nextCommand: runAgainCommand(runDir),
    };
  }

  if (current === "validate") {
    const report = readJsonFile(path.join(runDir, "validator-report.json"), null);
    if (report?._generatedBy === "validate-with-validator.mjs" && report.status !== "skipped") {
      const recorded = cmdRecordValidation(["--run", runDir, "--status", report.status]);
      if (!recorded.ok) return recorded;
      return {
        ...recorded,
        currentPhase: "validate",
        nextAction: recorded.shouldRetry ? recorded.nextAction : "run_command",
        readNext: PHASE_READ_NEXT.validate,
        message: `${recorded.message}\nrun 已自动记录 validator-report.json。继续运行 bsg run。`,
        nextCommand: recorded.nextCommand || runAgainCommand(runDir),
      };
    }
    return {
      ok: true,
      currentPhase: "validate",
      nextAction: "run_command",
      readNext: PHASE_READ_NEXT.validate,
      message: "运行真实 validator；完成后继续运行 bsg run。",
      nextCommand: phaseNextCommand(runDir, "validate"),
    };
  }

  if (current === "deliver") {
    return {
      ok: true,
      currentPhase: "deliver",
      nextAction: "run_command",
      readNext: PHASE_READ_NEXT.deliver,
      message: "运行 deliver 完成最终交付。",
      nextCommand: phaseNextCommand(runDir, "deliver"),
    };
  }

  return completePhase(current, state, runDir);
}

export function cmdRun(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" run --run <run-dir>");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const pendingBlock = blockForPendingUserAction(state);
  if (pendingBlock) {
    const pendingType = pendingBlock.requiredUserAction;
    const nextCommand = ["android_device_needed", "android_entry_review_needed", "login_required"].includes(pendingType)
      ? `node "<skill-dir>/scripts/bsg.mjs" android --run "${runDir}"`
      : `node "<skill-dir>/scripts/bsg.mjs" resolve-user-action --run ${runDir} --action <action>`;
    return {
      ...pendingBlock,
      nextAction: "stop",
      nextCommand,
    };
  }

  const idx = currentPhaseIndex(state);
  if (idx >= PHASE_ORDER.length) {
    return {
      ok: true,
      message: "所有阶段已完成。运行 deliver 完成交付。",
      nextAction: "run_command",
      readNext: PHASE_READ_NEXT.deliver,
      nextCommand: phaseNextCommand(runDir, "deliver"),
    };
  }

  const current = PHASE_ORDER[idx];
  const currentPhase = state.phases[current];

  if (currentPhase.status === "pending") {
    const started = startPhase(current, state, runDir);
    return { ...started, nextCommand: runAgainCommand(runDir) };
  }

  if (currentPhase.status !== "in_progress") {
    return fail(`阶段 ${current} 状态异常: ${currentPhase.status}`);
  }

  if (current === "probe") {
    const moved = completePhase(current, state, runDir);
    if (!moved.ok) return moved;
    const next = moved.currentPhase || "assess";
    return instructionForPhase(next, state, runDir);
  }

  return instructionForPhase(current, state, runDir);
}

export function cmdAdvance(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" advance --run <run-dir>");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);

  const pendingBlock = blockForPendingUserAction(state);
  if (pendingBlock) return pendingBlock;

  const idx = currentPhaseIndex(state);
  if (idx >= PHASE_ORDER.length) {
    return {
      ok: true,
      message: "所有阶段已完成。运行 deliver 完成交付。",
      nextAction: "all_done",
      readNext: PHASE_READ_NEXT.deliver,
      nextCommand: phaseNextCommand(runDir, "deliver"),
    };
  }

  const current = PHASE_ORDER[idx];
  const currentPhase = state.phases[current];

  if (currentPhase.status === "pending") {
    return startPhase(current, state, runDir);
  }
  if (currentPhase.status === "in_progress") {
    return completePhase(current, state, runDir);
  }

  return fail(`阶段 ${current} 状态异常: ${currentPhase.status}`);
}
