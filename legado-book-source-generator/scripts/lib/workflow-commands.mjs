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
import {
  SOURCE_TARGETS, initializeSourceArtifact, initializeTargetRunArtifacts,
  sourceArtifactPath, sourceReportPath, sourceTarget,
} from "./source-artifact.mjs";

function pendingUserActionCommand(runDir, pendingType) {
  return ["android_device_needed", "android_entry_review_needed", "login_required"].includes(pendingType)
    ? `node "<skill-dir>/scripts/bsg.mjs" android --run "${runDir}"`
    : `node "<skill-dir>/scripts/bsg.mjs" resolve-user-action --run ${runDir} --action <action>`;
}

export function cmdInit(args) {
  if (args.length < 1) {
    return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" init <site-url> [--cwd {dir}] [--target legacy-json|community-js]");
  }

  const siteUrl = args[0];
  for (let i = 1; i < args.length; i += 1) {
    if (["--cwd", "--target"].includes(args[i])) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) return fail(`${args[i]} 需要参数`);
      i += 1;
      continue;
    }
    return fail(`init 不支持参数: ${args[i]}`);
  }
  const cwdIdx = args.indexOf("--cwd");
  const cwd = cwdIdx >= 0 ? path.resolve(args[cwdIdx + 1]) : process.cwd();
  const target = parseArg(args, "--target") || "legacy-json";
  if (!SOURCE_TARGETS[target]) return fail(`不支持的 source target: ${target}`);

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
  const expectedRunDir = path.join(runsRoot, siteSlug);
  if (fileExists(path.join(expectedRunDir, "run-state.json"))) {
    const existing = loadAndVerify(expectedRunDir);
    if (existing.error) return fail(`已有 run 无法读取: ${existing.error}`);
    const existingTarget = sourceTarget(existing.state);
    return fail(`站点 ${siteSlug} 已存在 target ${existingTarget} 的 run。继续使用该 run，或删除对应 run 和输出后重新 init；不能覆盖初始化。`);
  }
  const runDir = initializeRunBundle(runsRoot, siteUrl);

  const state = freshRunState(siteUrl, siteSlug, "full", cwd);
  state.sourceTarget = target;
  Object.assign(state, SOURCE_TARGETS[target]);
  initializeSourceArtifact(state);
  state.adbDetected = checkAdb();
  state.phases.assess.status = "in_progress";
  saveRunState(runDir, state);
  ensureRunArtifacts(runDir, state);
  initializeTargetRunArtifacts(runDir, state);

  return {
    ok: true,
    currentPhase: "assess",
    nextAction: "open_site_with_browser_mcp",
    runDir,
    siteSlug,
    mode: state.mode,
    sourceTarget: target,
    sourceFormat: state.sourceFormat,
    targetRuntime: state.targetRuntime,
    workingDir: cwd,
    environment: {
      allOk: env.allOk,
      results: env.results,
    },
    warnSkillDir: inSkillDir
      ? `当前在 skill 安装目录下运行。输出将写入 ${cwd}，建议切换到项目目录并用 --cwd 指定。`
      : null,
    message: "Browser MCP 是站点分析前置能力。先打开目标站点；每确认一条 search/detail/toc/content 链路就调用 observe 写入事实，全部记录后再补 assessment.md。",
    hint: "如果当前没有 Browser MCP，先由执行者安装或配置；只有授权、客户端重启或更换客户端需要本人操作时才暂停。配置完成后用 Browser MCP 打开目标 URL 并完成四链路取证。",
    requiredCapability: {
      name: "browser_mcp",
      required: true,
      missingAction: "install_or_configure_browser_mcp",
    },
    outputs: {
      runsRoot,
      runDir,
      stateFile: path.join(runDir, "run-state.json"),
      bookSourceDir: path.join(cwd, "outputs", siteSlug),
      sourceArtifact: sourceArtifactPath(state),
    },
    readNext: PHASE_READ_NEXT.assess,
    nextCommand: phaseNextCommand(runDir, "assess", state),
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
  const pendingUserAction = getPendingUserAction(state);

  let nextAction = pendingUserAction ? "stop" : null;
  if (!pendingUserAction && !inProgress && pending.length > 0) {
    const next = pending[0];
    nextAction = next === "assess" ? "record_assessment"
      : next === "analyze" ? "write_analysis"
      : next === "generate" ? (sourceTarget(state) === "community-js" ? "generate_community_js" : "generate_json")
      : next === "validate" ? (sourceTarget(state) === "community-js" ? "run_app_mcp_validation" : "run_validator")
      : next === "deliver" ? "deliver"
      : "write_assessment";
  }

  return {
    ok: true,
    siteUrl: state.siteUrl,
    siteSlug: state.siteSlug,
    mode: state.mode,
    sourceTarget: sourceTarget(state),
    sourceFormat: state.sourceFormat,
    targetRuntime: state.targetRuntime,
    validationBackend: state.validationBackend,
    sourceArtifact: sourceArtifactPath(state),
    currentPhase,
    pendingUserAction,
    repairContext: state.repairContext || null,
    userDecisions: state.userDecisions || {},
    completed,
    pending,
    inProgress: inProgress ? inProgress.phase : null,
    nextAction,
    readNext: PHASE_READ_NEXT[currentPhase] || [],
    nextCommand: pendingUserAction
      ? pendingUserActionCommand(runDir, pendingUserAction.type)
      : phaseNextCommand(runDir, currentPhase, state),
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
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" init <url> [--cwd <dir>] [--target legacy-json|community-js]", use: "创建 run 目录和目标格式对应的初始产物；默认 legacy-json。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" status --run <run-dir>", use: "查看当前阶段、pendingUserAction、repairContext 和下一步建议。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" check --run <run-dir>", use: "检查评估/登录/Android 决策是否缺证据。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" observe --run <run-dir> --phase <phase> --status <status> [--blocker <type>] [--render <type>] --note <evidence>", use: "每确认一条 Browser MCP 链路就立即写入事实；硬边界会返回 stopInspection。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" source inspect --run <run-dir>", use: "审计当前 book-source.json 的风险字段。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" android --run <run-dir>", use: "Android 单入口：检查设备/Probe，必要时启动 Probe，运行 android 验证并收敛报告。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" android-status", use: "只读诊断：检查 adb、设备/模拟器和 Android Probe 状态。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" validate --run <run-dir> [--mode http|browser|android]", use: "运行 validator 并写 validator-report.json。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" app-mcp help-js", use: "动态读取目标 App 当前 JavaScript 单文件书源契约。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" app-mcp validate-js --source <book-source.js> --keyword <关键词> --report <run-dir>/app-mcp-report.json", use: "在社区维护版 App 中验证 community-js 目标。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" record-validation --run <run-dir> --status <status>", use: "把真实 validator-report.json 收敛成状态、能力矩阵和修复上下文。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" debug-bundle [--run <run-dir>]", use: "打包状态、报告、书源和会话导出，方便复盘。" },
      { command: "node \"<skill-dir>/scripts/bsg.mjs\" run --run <run-dir>", use: "可选状态助手：启动下一阶段，或把当前目标的验证报告自动收敛。" },
    ],
    scenarios: [
      {
        name: "site_inspection",
        when: "初始化后用 Browser MCP 观察目标站点，并通过 observe 逐条记录链路事实。",
        requiredCapability: { name: "browser_mcp", required: true, missingAction: "install_or_configure_browser_mcp" },
        readFirst: [
          "references/site-inspection.md",
          "references/assessment-template.md",
        ],
        firstAction: "用 Browser MCP 打开用户提供的目标 URL。",
      },
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
  return sourceArtifactPath(state);
}

function sourceExists(state) {
  const sourcePath = sourcePathForState(state);
  if (!fileExists(sourcePath)) return false;
  if (sourceTarget(state) === "community-js") return readTextSafe(sourcePath).trim().length > 0;
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
      nextAction: "open_site_with_browser_mcp",
      writeTarget: path.join(runDir, "assessment.md"),
      readNext: PHASE_READ_NEXT.assess,
      message: "先用 Browser MCP 打开目标站点；每确认一条链路就调用 observe 写入事实，全部记录后再补 assessment.md。",
      requiredCapability: {
        name: "browser_mcp",
        required: true,
        missingAction: "install_or_configure_browser_mcp",
      },
      nextCommand: phaseNextCommand(runDir, "assess", state),
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
      nextAction: sourceTarget(state) === "community-js" ? "generate_community_js" : "generate_json",
      writeTarget: sourcePathForState(state),
      readNext: sourceTarget(state) === "community-js"
        ? ["references/community-app-mcp.md"]
        : PHASE_READ_NEXT.generate,
      message: `生成 ${path.basename(sourcePathForState(state))}；完成后继续运行 bsg run。`,
      nextCommand: runAgainCommand(runDir),
    };
  }

  if (current === "validate") {
    const report = readJsonFile(sourceReportPath(runDir, state), null);
    const validReport = sourceTarget(state) === "community-js"
      ? report?._generatedBy === "bsg app-mcp validate-js"
      : report?._generatedBy === "validate-with-validator.mjs" && report.status !== "skipped";
    if (validReport) {
      const recorded = cmdRecordValidation(["--run", runDir, "--status", report.status]);
      if (!recorded.ok) return recorded;
      return {
        ...recorded,
        currentPhase: "validate",
        nextAction: recorded.shouldRetry ? recorded.nextAction : "run_command",
        readNext: PHASE_READ_NEXT.validate,
        message: `${recorded.message}\nrun 已自动记录 ${path.basename(sourceReportPath(runDir, state))}。继续运行 bsg run。`,
        nextCommand: recorded.nextCommand || runAgainCommand(runDir),
      };
    }
    return {
      ok: true,
      currentPhase: "validate",
      nextAction: "run_command",
      readNext: PHASE_READ_NEXT.validate,
      message: sourceTarget(state) === "community-js" ? "运行社区版 App MCP 验证；完成后继续运行 bsg run。" : "运行真实 validator；完成后继续运行 bsg run。",
      nextCommand: phaseNextCommand(runDir, "validate", state),
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
    return {
      ...pendingBlock,
      nextAction: "stop",
      nextCommand: pendingUserActionCommand(runDir, pendingBlock.requiredUserAction),
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

  return instructionForPhase(current, state, runDir);
}

export function cmdAdvance(args) {
  const runDir = parseArg(args, "--run") || "<run-dir>";
  return fail(
    `advance 已退役。请使用工具箱模式：先运行 status --run ${runDir} 查看当前状态，再按 nextCommand 使用 run/source/validate/record-validation/deliver。`
  );
}
