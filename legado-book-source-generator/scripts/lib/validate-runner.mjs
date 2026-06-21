import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { SKILL_ROOT, fileExists, parseArg, fail } from "./state.mjs";
import { checkAdb } from "./phase-engine.mjs";

export function cmdValidate(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node scripts/bsg.mjs validate --run <dir> [--keyword <kw>] [--mode http|browser|android]");

  const keywordArg = parseArg(args, "--keyword");
  const modeArg = parseArg(args, "--mode");

  // Read run state
  const statePath = path.join(runDir, "run-state.json");
  if (!fileExists(statePath)) return fail(`run-state.json 不存在: ${statePath}`);
  const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));

  // Find book-source.json
  const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (!fileExists(bookSourcePath)) return fail(`book-source.json 不存在: ${bookSourcePath}。请先完成 generate 阶段。`);

  // Determine keyword: override → analysis.md title → siteSlug
  let keyword = keywordArg;
  if (!keyword) {
    const analysisPath = path.join(runDir, "analysis.md");
    if (fileExists(analysisPath)) {
      const firstLine = fs.readFileSync(analysisPath, "utf-8").split("\n")[0];
      const m = firstLine.match(/#\s*(.+)/);
      if (m) keyword = m[1].trim();
    }
    if (!keyword) keyword = state.siteSlug;
  }

  // Determine mode: override → adb available → probe login → http
  let mode = modeArg;
  if (!mode) {
    if (checkAdb()) {
      mode = "android";
    } else if (state.loginFeatures?._loginMethod === "probe") {
      mode = "android";
    } else {
      mode = "http";
    }
  }

  const validModes = ["http", "browser", "android"];
  if (!validModes.includes(mode)) {
    return fail(`无效 mode: ${mode}。可选: ${validModes.join(", ")}`);
  }

  const validatorScript = path.join(SKILL_ROOT, "scripts", "validate-with-validator.mjs");
  const cookieFile = path.join(runDir, "cookies.json");
  let cmd = `node "${validatorScript}" "${bookSourcePath}" "${keyword}" ${mode} --output "${runDir}"`;
  if (fileExists(cookieFile)) cmd += ` --cookie="${cookieFile}"`;

  console.error(`验证中: ${bookSourcePath}`);
  console.error(`关键词: ${keyword}, mode: ${mode}`);
  if (fileExists(cookieFile)) console.error("检测到 cookies.json，自动注入 Cookie");

  try {
    const out = execSync(cmd, { encoding: "utf-8", timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
    const report = JSON.parse(out);
    return {
      ok: true,
      status: report.status,
      keyword,
      mode,
      reportPath: path.join(runDir, "validator-report.json"),
      message: `验证完成。状态: ${report.status}${report.reason ? `, 原因: ${report.reason}` : ""}`,
    };
  } catch (e) {
    // On exec error, try to extract JSON from stdout (script may have errored after writing output)
    try {
      const report = JSON.parse(e.stdout || "{}");
      if (report.status) {
        return {
          ok: true,
          status: report.status,
          keyword,
          mode,
          reportPath: path.join(runDir, "validator-report.json"),
          message: `验证完成。状态: ${report.status}${report.reason ? `, 原因: ${report.reason}` : ""}`,
        };
      }
    } catch {}
    return fail(`validator 运行失败: ${e.stderr || e.message}`);
  }
}
