import fs from "node:fs";
import path from "node:path";
import { fileSha256 } from "./state.mjs";

export const SOURCE_TARGETS = {
  "legacy-json": {
    sourceFormat: "legacy_json",
    targetRuntime: "legacy_app",
    artifactName: "book-source.json",
    validationBackend: "local_validator",
  },
  "community-js": {
    sourceFormat: "community_js",
    targetRuntime: "community_app",
    artifactName: "book-source.js",
    validationBackend: "legado_app_mcp",
  },
};

export function sourceTarget(state) {
  if (state?.sourceTarget && SOURCE_TARGETS[state.sourceTarget]) return state.sourceTarget;
  return state?.sourceFormat === "community_js" ? "community-js" : "legacy-json";
}

export function sourceContract(state) {
  return SOURCE_TARGETS[sourceTarget(state)];
}

export function sourceOutputDir(state) {
  return path.join(state.workingDir, "outputs", state.siteSlug);
}

export function sourceArtifactPath(state) {
  return path.join(sourceOutputDir(state), sourceContract(state).artifactName);
}

export function sourceReportName(state) {
  return sourceTarget(state) === "community-js" ? "app-mcp-report.json" : "validator-report.json";
}

export function sourceReportPath(runDir, state) {
  return path.join(runDir, sourceReportName(state));
}

export function initializeSourceArtifact(state) {
  const contract = sourceContract(state);
  const outputDir = sourceOutputDir(state);
  fs.mkdirSync(outputDir, { recursive: true });
  const artifactPath = sourceArtifactPath(state);
  if (!fs.existsSync(artifactPath)) {
    fs.writeFileSync(artifactPath, contract.sourceFormat === "community_js" ? "" : "[]\n", "utf8");
  }
  return artifactPath;
}

export function initializeTargetRunArtifacts(runDir, state) {
  if (sourceTarget(state) !== "community-js") return;
  const checklist = [
    "# 社区版 App MCP 验收清单",
    "",
    "1. 保存 `book-source.js` 到目标 App",
    "2. 读回脚本并确认仅有 App 管理字段变化",
    "3. 验证搜索、详情、目录、正文四条链路",
    "4. 运行 App check 并取得明确通过结果",
    "5. 删除临时测试源并确认没有残留，或明确记录保留",
    "6. 运行 `record-validation` 和 `deliver` 收敛结果",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(runDir, "validation-checklist.md"), checklist, "utf8");
}

export function validateCommunityJsSource(content) {
  const errors = [];
  if (!/\b(?:var|let|const)\s+config\s*=/.test(content)) errors.push("缺少顶层 config 配置对象。");
  for (const name of ["search", "getChapters", "getContent"]) {
    if (!new RegExp(`\\bfunction\\s+${name}\\s*\\(`).test(content)) errors.push(`缺少 ${name}() 函数。`);
  }
  if (!/bookSourceUrl\s*:/.test(content)) errors.push("config 缺少 bookSourceUrl。");
  if (!/bookSourceName\s*:/.test(content)) errors.push("config 缺少 bookSourceName。");
  try {
    new Function(content);
  } catch (error) {
    errors.push(`JavaScript 语法错误: ${error.message}`);
  }
  return errors;
}

export function writeCommunityRuleCheck(runDir, state) {
  const artifactPath = sourceArtifactPath(state);
  if (!fs.existsSync(artifactPath)) return { ok: false, error: `${path.basename(artifactPath)} 不存在。` };
  const content = fs.readFileSync(artifactPath, "utf8");
  if (!content.trim()) return { ok: false, error: `${path.basename(artifactPath)} 为空。` };
  const errors = validateCommunityJsSource(content);
  const ruleCheck = {
    version: "1.0",
    status: errors.length === 0 ? "passed" : "failed",
    source: "community-js-contract",
    sourceFormat: "community_js",
    sourceHash: fileSha256(artifactPath),
    errors,
    warnings: [],
    checkedRuleIds: ["community-js-required-contract", "community-js-syntax"],
  };
  fs.writeFileSync(path.join(runDir, "rule-check.json"), JSON.stringify(ruleCheck, null, 2) + "\n", "utf8");
  return { ok: errors.length === 0, artifactPath, ruleCheck, error: errors.join(" ") };
}
