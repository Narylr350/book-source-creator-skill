import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { SKILL_ROOT, fileExists, parseArg, fail } from "./state.mjs";
import { checkAdb } from "./phase-engine.mjs";
import { checkProbeCookies, probeCookieResultDomain, targetDomainFromSiteUrl } from "./environment.mjs";

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

export function resolveValidateCookieFile(runDir, state, mode) {
  const cookieFile = path.join(runDir, "cookies.json");
  if (fileExists(cookieFile)) {
    return { ok: true, cookieFile, source: "cookies.json" };
  }

  if (mode !== "android" || state.loginFeatures?._loginMethod !== "probe" || state.loginFeatures?._loginVerified !== true) {
    return { ok: true, cookieFile: null, source: null };
  }

  const domain = targetDomainFromSiteUrl(state.siteUrl);
  const probeCookies = checkProbeCookies(state.siteUrl);
  const cookie = probeCookies.parsed?.cookies || probeCookies.parsed?.cookie || "";
  const cookieDomain = probeCookieResultDomain(probeCookies.parsed, state.siteUrl);
  if (!probeCookies.ok || !cookie) {
    return {
      ok: false,
      error: `Probe 登录已记录，但没有返回 ${domain || "目标站"} Cookie。请先运行 android --run <dir> 打开手机/模拟器登录页，确认登录后再运行 android --run <dir> --login-completed。`,
    };
  }

  const tempFile = path.join(os.tmpdir(), `bsg-probe-cookies-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tempFile, JSON.stringify({ [cookieDomain || domain]: cookie }, null, 2), "utf-8");
  return {
    ok: true,
    cookieFile: tempFile,
    source: "probe",
    cleanup: () => {
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
    },
  };
}

function isGenericAnalysisTitle(title) {
  const normalized = String(title || "").trim().replace(/[：:]\s*$/, "").toLowerCase();
  return [
    "分析",
    "网站分析",
    "站点分析",
    "site analysis",
    "website analysis",
    "analysis",
  ].includes(normalized);
}

export function cmdValidate(args) {
  const runDir = parseArg(args, "--run");
  if (!runDir) return fail("用法: node \"<skill-dir>/scripts/bsg.mjs\" validate --run <dir> [--keyword <kw>] [--mode http|browser|android]");

  const keywordArg = parseArg(args, "--keyword");
  const modeArg = parseArg(args, "--mode");
  const bookUrlArg = parseArg(args, "--book-url");

  // Read run state
  const statePath = path.join(runDir, "run-state.json");
  if (!fileExists(statePath)) return fail(`run-state.json 不存在: ${statePath}`);
  const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));

  // Find book-source.json
  const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (!fileExists(bookSourcePath)) return fail(`book-source.json 不存在: ${bookSourcePath}。请先完成 generate 阶段。`);

  // Determine keyword: override → specific analysis.md title → siteSlug
  let keyword = keywordArg;
  if (!keyword) {
    const analysisPath = path.join(runDir, "analysis.md");
    if (fileExists(analysisPath)) {
      const firstLine = fs.readFileSync(analysisPath, "utf-8").split("\n")[0];
      const m = firstLine.match(/#\s*(.+)/);
      if (m && !isGenericAnalysisTitle(m[1])) keyword = m[1].trim();
    }
  }
  if (!keyword) {
    const factsPath = path.join(runDir, "site-facts.json");
    if (fileExists(factsPath)) {
      try {
        const facts = JSON.parse(fs.readFileSync(factsPath, "utf-8"));
        const searchEvidence = facts.evidence?.find((e) => e.phase === "search");
        if (searchEvidence?.note) {
          const m = searchEvidence.note.match(/关键词[：:]\s*(\S+)/);
          if (m) keyword = m[1];
        }
      } catch {}
    }
  }
  if (!keyword) {
    return fail("validator 需要搜索关键词。请传 --keyword <中文关键词>，或在 analysis.md 标题写书名，或在 site-facts evidence note 写'关键词：xxx'。不能用站点 slug 当搜索词。");
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
  const cookiePlan = resolveValidateCookieFile(runDir, state, mode);
  if (!cookiePlan.ok) return fail(cookiePlan.error);
  let cmd = `node "${validatorScript}" "${bookSourcePath}" "${keyword}" ${mode} --output "${runDir}"`;
  if (cookiePlan.cookieFile) cmd += ` --cookie=${shellQuote(cookiePlan.cookieFile)}`;
  if (bookUrlArg) cmd += ` --book-url=${shellQuote(bookUrlArg)}`;

  console.error(`验证中: ${bookSourcePath}`);
  console.error(`关键词: ${keyword}, mode: ${mode}`);
  if (cookiePlan.source === "cookies.json") console.error("检测到 cookies.json，自动注入 Cookie");
  if (cookiePlan.source === "probe") console.error("检测到 Android Probe Cookie，自动注入 validator");

  try {
    const out = execSync(cmd, { encoding: "utf-8", timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
    const report = JSON.parse(out);
    const nextCommand = report.status === "skipped"
      ? `node "<skill-dir>/scripts/bsg.mjs" validator-start`
      : `node "<skill-dir>/scripts/bsg.mjs" record-validation --run ${runDir} --status ${report.status}`;
    const message = report.status === "skipped"
      ? `validator 未运行，已写入 skipped 报告。请先启动 validator 后重跑 validate。`
      : `validator-report.json 已写入。状态: ${report.status}${report.reason ? `, 原因: ${report.reason}` : ""}。现在运行 record-validation。`;
    return {
      ok: true,
      status: report.status,
      keyword,
      mode,
      reportPath: path.join(runDir, "validator-report.json"),
      message,
      nextCommand,
    };
  } catch (e) {
    // On exec error, try to extract JSON from stdout (script may have errored after writing output)
    try {
      const report = JSON.parse(e.stdout || "{}");
      if (report.status) {
        const nextCommand = report.status === "skipped"
          ? `node "<skill-dir>/scripts/bsg.mjs" validator-start`
          : `node "<skill-dir>/scripts/bsg.mjs" record-validation --run ${runDir} --status ${report.status}`;
        const message = report.status === "skipped"
          ? `validator 未运行，已写入 skipped 报告。请先启动 validator 后重跑 validate。`
          : `validator-report.json 已写入。状态: ${report.status}${report.reason ? `, 原因: ${report.reason}` : ""}。现在运行 record-validation。`;
        return {
          ok: true,
          status: report.status,
          keyword,
          mode,
          reportPath: path.join(runDir, "validator-report.json"),
          message,
          nextCommand,
        };
      }
    } catch {}
    return fail(`validator 运行失败: ${e.stderr || e.message}`);
  } finally {
    cookiePlan.cleanup?.();
  }
}
