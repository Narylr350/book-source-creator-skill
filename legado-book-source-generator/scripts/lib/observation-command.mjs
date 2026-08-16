import path from "node:path";
import {
  LINK_PHASES, fail, loadAndVerify, normalizeLinkStatus, parseArg,
  readJsonFile, writeJsonFile,
} from "./state.mjs";
import { isAntiBotBlocker } from "./facts.mjs";

const ALLOWED_STATUSES = new Set(["success", "partial", "blocked", "failed"]);
const ALLOWED_RENDERS = new Set(["ssr_or_http", "csr", "webview", "csr_encrypted"]);

function optionValue(args, flag) {
  const value = parseArg(args, flag);
  return value && !value.startsWith("--") ? value : null;
}

function nextEvidenceId(facts, phase) {
  let index = 1;
  const used = new Set((facts.evidence || []).map((item) => item?.id).filter(Boolean));
  while (used.has(`${phase}-${index}`)) index += 1;
  return `${phase}-${index}`;
}

function inspectionBoundary(facts) {
  const entryAntiBot = ["search", "detail", "toc"].some((phase) => {
    const link = facts.links?.[phase];
    return normalizeLinkStatus(link?.status) === "blocked" && isAntiBotBlocker(link?.blocker);
  });
  const contentProtected = facts.links?.content?.render === "csr_encrypted"
    || /encrypt|signature|font_obfuscation/i.test(String(facts.links?.content?.blocker || ""));
  return { reached: entryAntiBot || contentProtected, entryAntiBot, contentProtected };
}

export function cmdObserve(args) {
  const runDir = optionValue(args, "--run");
  const phase = optionValue(args, "--phase");
  const rawStatus = optionValue(args, "--status");
  const blocker = optionValue(args, "--blocker");
  const render = optionValue(args, "--render");
  const kind = optionValue(args, "--kind") || "browser";
  const note = optionValue(args, "--note") || "Browser MCP evidence";
  if (!runDir || !phase || !rawStatus) {
    return fail("用法: bsg observe --run <run-dir> --phase search|detail|toc|content --status success|partial|blocked|failed [--blocker <type>] [--render <type>] [--kind <type>] [--note <text>]");
  }
  if (!LINK_PHASES.includes(phase)) return fail(`无效 phase: ${phase}`);
  const status = normalizeLinkStatus(rawStatus);
  if (!ALLOWED_STATUSES.has(status)) return fail(`无效 status: ${rawStatus}`);
  if (render && !ALLOWED_RENDERS.has(render)) return fail(`无效 render: ${render}`);
  if (status === "blocked" && !blocker) return fail("blocked 状态必须提供 --blocker。");

  const { state, error } = loadAndVerify(runDir);
  if (error) return fail(error);
  if (state.phases.assess?.status !== "in_progress" || state.phases.assess?.recorded === true) {
    return fail("observe 只允许在未记录的 assess 阶段写入站点事实。");
  }

  const factsPath = path.join(runDir, "site-facts.json");
  const facts = readJsonFile(factsPath, null);
  if (!facts?.links || !Array.isArray(facts.evidence)) return fail("site-facts.json 结构无效。");
  if (facts.inspection?.closed === true) {
    return fail(`前置评估探查已因 ${facts.inspection.boundary} 关闭。下一步必须运行 record-assessment，不能继续观察或逆向实现。`);
  }

  const evidenceId = nextEvidenceId(facts, phase);
  facts.links[phase] = {
    status,
    blocker: blocker || null,
    render: render || facts.links[phase]?.render || null,
    evidenceIds: [evidenceId],
  };
  facts.evidence.push({ id: evidenceId, phase, kind, note });
  const boundary = inspectionBoundary(facts);
  if (boundary.reached) {
    const boundaryName = boundary.entryAntiBot ? "entry_antibot" : "protected_content_implementation";
    for (const name of LINK_PHASES) {
      if (normalizeLinkStatus(facts.links[name]?.status) === "unknown") {
        facts.links[name] = {
          status: "blocked",
          blocker: "inspection_boundary",
          render: facts.links[name]?.render || null,
          evidenceIds: [],
        };
      }
    }
    facts.inspection = {
      closed: true,
      boundary: boundaryName,
      evidenceId,
      closedAt: new Date().toISOString(),
    };
  }
  writeJsonFile(factsPath, facts);

  const unknownPhases = LINK_PHASES.filter((name) => normalizeLinkStatus(facts.links[name]?.status) === "unknown");
  const readyToRecord = unknownPhases.length === 0;
  const nextCommand = readyToRecord
    ? `node "<skill-dir>/scripts/bsg.mjs" record-assessment --run ${runDir}`
    : null;
  return {
    ok: true,
    recorded: { phase, status, blocker: blocker || null, render: facts.links[phase].render, evidenceId },
    stopInspection: boundary.reached,
    inspectionBoundary: boundary.reached
      ? boundary.entryAntiBot ? "entry_antibot" : "protected_content_implementation"
      : null,
    unknownPhases,
    nextAction: readyToRecord ? "record_assessment" : "observe_next_link",
    maxAdditionalPublicSamples: boundary.reached ? 0 : null,
    forbiddenActions: boundary.reached
      ? ["generate_source", "reverse_engineer_signature", "parse_obfuscation_font", "implement_site_decoder"]
      : [],
    nextCommand,
    nextCommandTemplate: readyToRecord
      ? null
      : `node "<skill-dir>/scripts/bsg.mjs" observe --run ${runDir} --phase <${unknownPhases.join("|")}> --status <success|partial|blocked|failed> [--blocker <type>] [--render <type>] --note "<Browser MCP 证据>"`,
    message: boundary.reached
      ? "已达到前置评估探查边界，未观察链路已关闭。不得继续浏览、生成，或进入签名、字体、解码逆向；立即运行 record-assessment。"
      : "站点事实已记录。继续用 Browser MCP 观察下一条未记录链路。",
  };
}
