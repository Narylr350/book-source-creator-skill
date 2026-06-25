import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  fileExists, readJsonFile, writeJsonFile, fileSha256, emptyLinks,
  normalizeLinkStatus, getEvidenceIds, LINK_PHASES, OFFICIAL_RULE_PACK_PATH,
} from "./state.mjs";

// ── cookie / report helpers ────────────────────────────────────────────────

export function validateCookieFileShape(cookieFile) {
  if (!fileExists(cookieFile)) {
    return { ok: false, reason: "missing" };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cookieFile, "utf-8"));
  } catch (e) {
    return { ok: false, reason: `cookies.json 不是合法 JSON: ${e.message}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "cookies.json 必须是对象。" };
  }

  if (typeof parsed.domain === "string" && typeof parsed.cookie === "string") {
    if (!parsed.domain.includes(".") || !parsed.cookie.includes("=")) {
      return { ok: false, reason: "cookies.json 的 {domain,cookie} 格式无效。" };
    }
    return { ok: true, format: "domain_cookie" };
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    return { ok: false, reason: "cookies.json 为空。" };
  }
  if (entries.length === 1 && entries[0][0] === "domain" && typeof entries[0][1] === "string" && entries[0][1].includes("=")) {
    return {
      ok: false,
      reason: "cookies.json 写成了 {\"domain\":\"cookie_string\"}，缺少真实域名键。",
    };
  }
  for (const [domain, value] of entries) {
    if (!domain.includes(".") || typeof value !== "string" || !value.includes("=")) {
      return {
        ok: false,
        reason: "cookies.json 应为 {\"www.example.com\":\"a=b; c=d\"}，或 {\"domain\":\"www.example.com\",\"cookie\":\"a=b; c=d\"}。",
      };
    }
  }
  return { ok: true, format: "domain_map" };
}

export function reportUsedAndroidMode(reportPath) {
  if (!fileExists(reportPath)) return false;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    if (report.mode === "android") return true;
    return (report.steps || []).some((s) => s.mode === "android");
  } catch {
    return false;
  }
}

function stepUsedAndroidProbe(step) {
  if (!step || step.mode !== "android") return false;
  if (step.androidProbeUsed === false) return false;
  if (step.androidProbeUsed === true) return true;
  if (String(step.androidBackend || "") === "probe_webview") return true;
  if (step.phase === "content" && (step.webViewHtmlPreview || step.webViewScreenshotBase64)) return true;
  const artifacts = step.debugArtifacts || {};
  return step.phase === "content" && Boolean(artifacts["response.rendered.html"] || artifacts["screenshot.png"]);
}

export function reportUsedAndroidProbe(reportPath) {
  if (!fileExists(reportPath)) return false;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    return (report.steps || []).some((step) => stepUsedAndroidProbe(step));
  } catch {
    return false;
  }
}

export function reportUsedAndroidWebView(reportPath) {
  if (!fileExists(reportPath)) return false;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    return (report.steps || []).some((step) => {
      if (step?.mode !== "android") return false;
      if (step.phase !== "content") return false;
      if (!stepUsedAndroidProbe(step)) return false;
      if (step.webViewHtmlPreview || step.webViewScreenshotBase64) return true;
      const artifacts = step.debugArtifacts || {};
      return Boolean(artifacts["response.rendered.html"] || artifacts["screenshot.png"]);
    });
  } catch {
    return false;
  }
}

export function reportHasAndroidWebViewContentEvidence(reportPath) {
  if (!fileExists(reportPath)) return false;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    const androidContentSteps = (report.steps || []).filter((step) => step?.mode === "android" && step.phase === "content");
    const contentSteps = androidContentSteps.filter((step) => stepUsedAndroidProbe(step));
    const hasExtractedContent = (step) => {
      if (step.preview && String(step.preview).trim().length > 0) return true;
      if (step.evidence?.contentPreview && String(step.evidence.contentPreview).trim().length > 0) return true;
      const evidenceLength = Number(step.evidence?.contentLength || 0);
      const extractedLength = Number(step.extracted?.contentLength || 0);
      return evidenceLength > 0 || extractedLength > 0;
    };
    if (androidContentSteps.some((step) => step.status === "error" && !hasExtractedContent(step))) return false;
    return contentSteps.some(hasExtractedContent);
  } catch {
    return false;
  }
}

export function reportHasLoginSessionEvidence(reportPath) {
  if (!fileExists(reportPath)) return false;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    if (report.sessionMode && report.sessionMode !== "anonymous") return true;
    return (report.steps || []).some((step) => {
      if (step.sessionMode && step.sessionMode !== "anonymous") return true;
      const headers = step.request?.headers || {};
      return Boolean(headers.Cookie || headers.cookie || headers.Authorization || headers.authorization);
    });
  } catch {
    return false;
  }
}

export function reportHardRuleError(reportPath) {
  if (!fileExists(reportPath)) return null;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    for (const step of report.steps || []) {
      const phase = step?.phase || "";
      const requestUrl = step?.request?.url || "";
      const extracted = step?.extracted || {};
      if (phase === "toc" && step.status === "error" && /\/chapter-list\/?(?:[?#]|$)/.test(requestUrl)) {
        return "目录请求变成 /chapter-list/，这是 tocUrl/book id 规则错误，不是 App 复核或 validator 限制。";
      }
      if (phase === "detail" && /\/chapter-list\/?(?:[?#]|$)/.test(extracted.tocUrl || "")) {
        return "详情阶段提取到的 tocUrl 缺少 book id，应修 ruleBookInfo.tocUrl，不应标 needs_app_review。";
      }
      if (phase === "detail" && step.status === "success") {
        const missing = [];
        if (Object.prototype.hasOwnProperty.call(extracted, "coverUrl") && !extracted.coverUrl) missing.push("coverUrl");
        if (Object.prototype.hasOwnProperty.call(extracted, "intro") && !extracted.intro) missing.push("intro");
        if (missing.length > 0) {
          return `详情阶段 ${missing.join(", ")} 为空，这是选择器或字段名错误，不应包装成 App 复核。`;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function successfulStep(report, phase) {
  return (report?.steps || []).find((step) => step.phase === phase && step.status === "success") || null;
}

function numberFrom(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function contentQualityIssue(contentPreview) {
  const text = String(contentPreview || "").trim();
  if (!text) return null;

  const repeatedTokens = text.match(/\b[A-Za-z0-9]{4,16}\b/g) || [];
  const counts = new Map();
  for (const token of repeatedTokens) {
    const key = token.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [token, count] of counts) {
    if (count >= 5) {
      return {
        blockedBy: "content_repeated_noise",
        message: `validator 报告标记 content success，但正文预览中短 token "${token}" 重复 ${count} 次。正文可能混入反复制/水印/污染内容，不能作为干净正文交付。`,
      };
    }
  }

  const chromeMarkers = [
    "window.parent",
    "history.pushState",
    "<script",
    "登录",
    "注册",
    "举报",
  ];
  const markerHits = chromeMarkers.filter((marker) => text.includes(marker));
  if (markerHits.length >= 3) {
    return {
      blockedBy: "content_page_chrome",
      message: `validator 报告标记 content success，但正文预览混入页面脚本/导航/弹窗标记: ${markerHits.join(", ")}。ruleContent 可能提取到了页面 chrome，不是干净正文。`,
    };
  }

  return null;
}

function hasAnyKey(obj, keys) {
  return Boolean(obj && typeof obj === "object" && keys.some((key) => Object.prototype.hasOwnProperty.call(obj, key)));
}

export function reportAcceptanceGateError(reportPath) {
  if (!fileExists(reportPath)) return null;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    const summary = report.summary || {};
    const rawSummary = report.raw?.summary || {};
    const phases = report.phases || {};

    if ((phases.search === "success" || successfulStep(report, "search")) && hasAnyKey(summary, ["resultCount", "firstBook"])) {
      const resultCount = numberFrom(summary.resultCount, rawSummary.resultCount);
      const firstBook = firstText(summary.firstBook, rawSummary.firstBook, successfulStep(report, "search")?.extracted?.name);
      if (resultCount < 1) {
        return {
          phase: "search",
          blockedBy: "search_result_empty",
          message: "validator 报告标记 search success，但 resultCount < 1。搜索没有证明能提取书籍列表，不能交付。",
        };
      }
      if (!firstBook) {
        return {
          phase: "search",
          blockedBy: "search_book_name_empty",
          message: "validator 报告标记 search success，但 firstBook/name 为空。搜索只证明页面有返回，未证明 ruleSearch.name 在阅读语义下可用。",
        };
      }
    }

    if ((phases.toc === "success" || successfulStep(report, "toc")) && hasAnyKey(summary, ["chapterCount"])) {
      const chapterCount = numberFrom(summary.chapterCount, rawSummary.chapterCount, successfulStep(report, "toc")?.extracted?.chapterCount);
      if (chapterCount > 0 && chapterCount < 10) {
        // 区分"真短目录"vs"匿名试读限制"：站点常把未登录的章节链接替换为 signup/login?redirect=。
        // 实测 ciweimao：chapter-list 50KB HTML 含整章导航，但匿名只暴露前 2 章 url，其余替换登录引导。
        // 走 toc_trial_chapters_only 而非 toc_chapter_count_too_low——修法不是"确认是否短篇"，是"让用户登录后重测"。
        const tocStep = successfulStep(report, "toc");
        const tocBody = tocStep?.response?.bodyPreview || "";
        const trialMarkers = /signup\/login\?redirect=|signin\?redirect=|\/login\?next=|\/login\?return=/i;
        if (trialMarkers.test(tocBody)) {
          return {
            phase: "toc",
            blockedBy: "toc_trial_chapters_only",
            message: "validator 报告 toc success 但 chapterCount < 10，且响应里有 signup/login?redirect= 引导链接——这是站点匿名试读策略：未登录时只暴露前几章 URL，其余替换为登录引导。不是 ruleToc 抓得少，是站点策略本身屏蔽了。让用户登录后重测目录，不要走 toc_chapter_count_confirmed 把短目录当真。",
          };
        }
        return {
          phase: "toc",
          blockedBy: "toc_chapter_count_too_low",
          message: "validator 报告标记 toc success，但 chapterCount < 10。目录数量不足，不能作为可交付结果。",
        };
      }
    }

    if ((phases.content === "success" || successfulStep(report, "content")) && hasAnyKey(summary, ["contentLength", "contentPreview"])) {
      const contentStep = successfulStep(report, "content");
      const contentPreview = firstText(summary.contentPreview, rawSummary.contentPreview, contentStep?.preview, contentStep?.evidence?.contentPreview);
      const contentLength = numberFrom(
        summary.contentLength,
        rawSummary.contentLength,
        contentStep?.evidence?.contentLength,
        contentStep?.extracted?.contentLength,
        contentPreview.length,
      );
      if (contentLength < 100) {
        return {
          phase: "content",
          blockedBy: "content_length_too_short",
          message: "validator 报告标记 content success，但 contentLength/contentPreview 不足 100 字符。正文未证明可用，不能交付。",
        };
      }
      const qualityIssue = contentQualityIssue(contentPreview);
      if (qualityIssue) {
        return {
          phase: "content",
          ...qualityIssue,
        };
      }
    }

    return null;
  } catch (e) {
    return { phase: "unknown", blockedBy: "validator_report_unreadable", message: `validator-report.json 读取失败: ${e.message}` };
  }
}

export function writeValidatorSummary(runDir, status, finalStatus, reportPath) {
  const lines = [
    "# 验证摘要",
    "",
    `- 记录状态: ${status}`,
    `- 最终状态: ${finalStatus}`,
  ];
  if (reportPath && fileExists(reportPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      if (report.phases) lines.push(`- 阶段状态: ${JSON.stringify(report.phases)}`);
      if (report.summary?.error) lines.push(`- 主要错误: ${report.summary.error}`);
      lines.push(`- Android mode: ${reportUsedAndroidMode(reportPath) ? "有" : "无"}`);
      lines.push(`- Android Probe 证据: ${reportUsedAndroidProbe(reportPath) ? "有" : "无"}`);
      lines.push(`- Android WebView 渲染证据: ${reportUsedAndroidWebView(reportPath) ? "有" : "无"}`);
    } catch (e) {
      lines.push(`- 报告读取失败: ${e.message}`);
    }
  }
  lines.push("", "此文件由 record-validation 生成，不手写。");
  fs.writeFileSync(path.join(runDir, "validator-summary.md"), lines.join("\n") + "\n", "utf-8");
}

// ── book source helpers ────────────────────────────────────────────────────

export function loadBookSource(runDir, state) {
  const bookSourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (!fileExists(bookSourcePath)) {
    return { ok: false, error: `book-source.json 不存在: ${bookSourcePath}。` };
  }
  try {
    const sourceJson = fs.readFileSync(bookSourcePath, "utf-8");
    const parsed = JSON.parse(sourceJson);
    const sources = Array.isArray(parsed) ? parsed : [parsed];
    return { ok: true, bookSourcePath, sourceJson, parsed, sources };
  } catch (e) {
    return { ok: false, error: `book-source.json 不是合法 JSON: ${e.message}` };
  }
}

export function validateBookSourceStructure(sources) {
  for (const source of sources) {
    if (source?.ruleBookInfo && Object.prototype.hasOwnProperty.call(source.ruleBookInfo, "summary")) {
      return "ruleBookInfo.summary 不是阅读详情简介字段；应使用 ruleBookInfo.intro。";
    }
  }
  return null;
}

// ── site facts / assessment ────────────────────────────────────────────────

export function bookSourceHasWebView(runDir, state) {
  const sourcePath = path.join(state.workingDir, "outputs", state.siteSlug, "book-source.json");
  if (!fileExists(sourcePath)) return false;
  try {
    const json = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
    const source = Array.isArray(json) ? json[0] : json;
    const jsonStr = JSON.stringify(source);
    return jsonStr.includes('"webView":true') || jsonStr.includes("'webView':true");
  } catch { return false; }
}

export function factsSuggestWebView(runDir) {
  const factsFile = path.join(runDir, "site-facts.json");
  if (!fileExists(factsFile)) return false;
  try {
    const facts = JSON.parse(fs.readFileSync(factsFile, "utf-8"));
    const links = facts.links || {};
    for (const key of Object.keys(links)) {
      const render = links[key]?.render;
      if (render && /webview|csr/i.test(render)) return true;
    }
  } catch {}
  return false;
}

export function loadSiteFacts(runDir) {
  const factsPath = path.join(runDir, "site-facts.json");
  const facts = readJsonFile(factsPath);
  if (!facts || typeof facts !== "object") {
    return { ok: false, error: "site-facts.json 不存在或不是合法 JSON。Probe 后必须先记录四链路事实。" };
  }
  const missing = [];
  const invalid = [];
  const invalidRender = [];
  const allowedRenderKinds = new Set(["ssr_or_http", "csr", "webview", "csr_encrypted"]);
  for (const phase of LINK_PHASES) {
    const link = facts.links?.[phase];
    if (!link || !link.status || link.status === "unknown") {
      missing.push(phase);
      continue;
    }
    const normalizedStatus = normalizeLinkStatus(link.status);
    if (!["success", "partial", "blocked", "failed"].includes(normalizedStatus)) {
      invalid.push(`${phase}:${link.status}`);
      continue;
    }
    if (link.render != null && !allowedRenderKinds.has(String(link.render))) {
      invalidRender.push(`${phase}:${link.render}`);
    }
    link.status = normalizedStatus;
  }
  if (missing.length > 0) {
    return { ok: false, error: `site-facts.json 四链路事实不完整，缺少明确状态: ${missing.join(", ")}。` };
  }
  if (invalid.length > 0) {
    return { ok: false, error: `site-facts.json 链路 status 必须是 success/partial/blocked/failed（ok/pass/error 可自动归一化）。无效值: ${invalid.join(", ")}。` };
  }
  if (invalidRender.length > 0) {
    return { ok: false, error: `site-facts.json 链路 render 必须是 ssr_or_http/csr/webview/csr_encrypted 或 null。无效值: ${invalidRender.join(", ")}。` };
  }
  return { ok: true, facts };
}

export function riskFromBlocker(blocker) {
  if (!blocker) return null;
  if (/captcha|cloudflare|turnstile|anti_bot|blocked/i.test(blocker)) return "有反爬风险";
  if (/login|cookie|auth|vip|paid|subscribe|payment/i.test(blocker)) return "需登录态";
  if (/webview|csr|android/i.test(blocker)) return "WebView 依赖";
  if (/encrypt|crypto/i.test(blocker)) return "加密正文";
  return null;
}

export function isAntiBotBlocker(blocker) {
  return /captcha|验证码|cloudflare|turnstile|challenge|geetest|anti[_-]?bot|man_machine/i.test(String(blocker || ""));
}

export function isEntryPhase(phase) {
  return ["search", "detail", "toc"].includes(phase);
}

export function risksFromRender(render) {
  const value = String(render || "");
  const risks = [];
  if (/webview|csr/i.test(value)) risks.push("WebView 依赖");
  if (/encrypt|crypto|cipher/i.test(value)) risks.push("加密正文");
  return risks;
}

export function deriveAssessmentFromFacts(facts) {
  const links = facts.links || {};
  const risks = new Set();
  const blockers = [];
  let hasEntryAntiBotRisk = false;
  const statuses = LINK_PHASES.map((phase) => {
    const link = links[phase] || { status: "unknown" };
    let status = normalizeLinkStatus(link.status);
    if (status === "success" && link.blocker) status = "partial";
    link.status = status;
    const risk = riskFromBlocker(link.blocker);
    if (risk) risks.add(risk);
    for (const renderRisk of risksFromRender(link.render)) risks.add(renderRisk);
    if (link.blocker) {
      blockers.push(`${phase}:${link.blocker}`);
      if (isEntryPhase(phase) && isAntiBotBlocker(link.blocker)) {
        hasEntryAntiBotRisk = true;
      }
    }
    return status;
  });

  const successCount = statuses.filter((s) => s === "success").length;
  const progressCount = statuses.filter((s) => s === "success" || s === "partial").length;
  const allSuccess = successCount === LINK_PHASES.length;
  const riskLabels = risks.size > 0 ? Array.from(risks).join(" / ") : "无风险";
  const loginDemand = risks.has("需登录态") ? "部分需要" : "否";
  const requiredActions = [];
  if (risks.has("需登录态")) requiredActions.push("login_required");
  if (risks.has("WebView 依赖")) requiredActions.push("android_device_needed");
  if (hasEntryAntiBotRisk) requiredActions.push("android_entry_review_needed");
  const fullPass = allSuccess && blockers.length === 0 && requiredActions.length === 0;
  const rating = fullPass ? "可生成" : progressCount > 0 ? "部分候选" : "不建议生成";
  const overallStatus = fullPass ? "full_pass_candidate" : progressCount > 0 ? "partial_candidate" : "blocked";

  return {
    rating,
    riskLabels,
    loginDemand,
    overallStatus,
    fullPass,
    blockers,
    requiredActions,
    signals: {
      protectedContent: risks.has("需登录态"),
      hasLoginRiskLabel: risks.has("需登录态"),
      hasPaymentRisk: blockers.some((b) => /vip|paid|subscribe|payment/i.test(b)),
      hasWebView: risks.has("WebView 依赖"),
      hasEncryptedContent: risks.has("加密正文"),
      hasEntryAntiBotRisk,
    },
  };
}

export function renderAssessmentAutoSummary(state, facts, derived) {
  const lines = [
    `- 站点 URL: ${facts.siteUrl || state.siteUrl}`,
    `- 评级: ${derived.rating}`,
    `- 风险标签: ${derived.riskLabels}`,
    `- 总体状态: ${derived.overallStatus}`,
    `- full pass: ${derived.fullPass ? "是" : "否"}`,
    `- 搜索链路: ${facts.links.search.status}${facts.links.search.blocker ? ` (${facts.links.search.blocker})` : ""}`,
    `- 详情链路: ${facts.links.detail.status}${facts.links.detail.blocker ? ` (${facts.links.detail.blocker})` : ""}`,
    `- 目录链路: ${facts.links.toc.status}${facts.links.toc.blocker ? ` (${facts.links.toc.blocker})` : ""}`,
    `- 正文链路: ${facts.links.content.status}${facts.links.content.render ? ` (${facts.links.content.render})` : ""}${facts.links.content.blocker ? ` (${facts.links.content.blocker})` : ""}`,
    `- 登录需求: ${derived.loginDemand}`,
    `- 登录/Android/WebView: ${derived.requiredActions.length > 0 ? derived.requiredActions.join(", ") : "无"}`,
    `- 阻塞原因: ${derived.blockers.length > 0 ? derived.blockers.join(", ") : "无"}`,
    `- 待确认动作: ${derived.requiredActions.length > 0 ? derived.requiredActions.join(", ") : "无"}`,
  ];
  const hash = crypto.createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
  return [
    "<!-- AUTO:BEGIN summary -->",
    `<!-- AUTO:HASH ${hash} -->`,
    ...lines,
    "<!-- AUTO:END summary -->",
  ].join("\n");
}

export function getAutoSummaryBlock(content) {
  const match = content.match(/<!-- AUTO:BEGIN summary -->([\s\S]*?)<!-- AUTO:END summary -->/);
  if (!match) return null;
  return match[0];
}

export function validateAssessmentAutoBlock(content) {
  const block = getAutoSummaryBlock(content);
  if (!block) return null;
  const hashMatch = block.match(/<!-- AUTO:HASH ([a-f0-9]{16}|pending) -->/);
  if (!hashMatch) return null;
  const body = block
    .split(/\r?\n/)
    .filter((line) => !/AUTO:BEGIN|AUTO:END|AUTO:HASH/.test(line))
    .join("\n");
  if (hashMatch[1] === "pending") {
    const fields = new Map();
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^-\s*([^:：]+)[：:]\s*(.*)$/);
      if (match) fields.set(match[1].trim(), match[2].trim());
    }
    const expected = new Map([
      ["评级", "待评估"],
      ["风险标签", "待评估"],
      ["总体状态", "pending"],
      ["搜索链路", "unknown"],
      ["详情链路", "unknown"],
      ["目录链路", "unknown"],
      ["正文链路", "unknown"],
      ["登录/Android/WebView", "待评估"],
      ["阻塞原因", "待评估"],
      ["待确认动作", "无"],
    ]);
    const allowedKeys = new Set(["站点 URL", ...expected.keys()]);
    const hasUnexpectedKey = [...fields.keys()].some((key) => !allowedKeys.has(key));
    const hasChangedValue = [...expected.entries()].some(([key, value]) => fields.get(key) !== value);
    if (!fields.has("站点 URL") || hasUnexpectedKey || hasChangedValue) {
      return "assessment.md 自动结论区被手动修改。AUTO:HASH pending 区块只能保留模板占位，结论必须由 record-assessment 根据 site-facts.json 生成。";
    }
    return null;
  }
  const expected = crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
  return expected === hashMatch[1] ? null : "assessment.md 自动结论区被手动修改。请重新运行 record-assessment 生成 AUTO 区块，不要手写结论。";
}

export function replaceAssessmentAutoSummary(content, autoSummary) {
  if (getAutoSummaryBlock(content)) {
    return content.replace(/<!-- AUTO:BEGIN summary -->[\s\S]*?<!-- AUTO:END summary -->/, autoSummary);
  }
  return [
    "# 网站可生成性评估",
    "",
    autoSummary,
    "",
    "## 证据说明",
    "",
    "## 分析备注",
    "",
    content.trim(),
    "",
  ].join("\n");
}

export function validateEvidenceNotes(content, facts) {
  const section = content.match(/## 证据说明([\s\S]*?)(?:\n## |\s*$)/);
  if (!section) return null;
  const evidenceIds = getEvidenceIds(facts);
  const badLines = section[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("<!--") && !line.startsWith("#"))
    .filter((line) => {
      const match = line.match(/evidence:([A-Za-z0-9_.:-]+)/);
      return !match || !evidenceIds.has(match[1]);
    });
  if (badLines.length === 0) return null;
  return `证据说明必须引用有效 evidence id（格式 evidence:<id>）。问题行: ${badLines.slice(0, 3).join(" | ")}`;
}

export function validateAssessmentRemarks(content, facts) {
  const search = facts?.links?.search || {};
  const searchBlocked = normalizeLinkStatus(search.status) === "blocked" || search.blocker;
  if (!searchBlocked) return null;

  const remarkSection = content.match(/## 分析备注([\s\S]*?)(?:\n## |\s*$)/);
  const text = remarkSection ? remarkSection[1] : content;
  const suggestsBypass = /(?:不依赖|绕过|替代).{0,16}(?:搜索|入口)|(?:搜索|入口).{0,16}(?:不需要|不用|可不用)|(?:排行榜|书库|排行|book[_ -]?id|书籍\s*ID|直达详情|直接输入)/i.test(text);
  if (!suggestsBypass) return null;

  return "搜索链路已阻塞时，assessment.md 不能建议用排行榜、书库、book_id、直达详情替代完整搜索链路。必须保留入口不完整/待复核结论。";
}

// ── official rule check ────────────────────────────────────────────────────

export function loadOfficialRulePack() {
  const pack = readJsonFile(OFFICIAL_RULE_PACK_PATH);
  return pack?.rules || [];
}

export function isJsonOrJsRule(value) {
  return typeof value === "string" && (
    value.startsWith("$.") ||
    value.startsWith("@json:") ||
    value.startsWith("<js>") ||
    value.startsWith("@js:") ||
    value.includes("{{")
  );
}

export function runOfficialRuleCheck(sources, state) {
  const rules = loadOfficialRulePack();
  const errors = [];
  const warnings = [];
  const checkedRuleIds = [];
  const addIssue = (rule, detail) => {
    const issue = {
      ruleId: rule.id,
      severity: rule.severity,
      message: detail || rule.message,
      sourceKind: rule.sourceKind,
      sourceUrl: rule.sourceUrl,
    };
    if (rule.severity === "warning") warnings.push(issue);
    else errors.push(issue);
  };

  for (const rule of rules) {
    checkedRuleIds.push(rule.id);
    for (const source of sources) {
      const jsonStr = JSON.stringify(source);
      if (rule.checkKind === "forbidField") {
        const [groupName, fieldName] = rule.target.split(".");
        if (source?.[groupName] && Object.prototype.hasOwnProperty.call(source[groupName], fieldName)) {
          addIssue(rule);
        }
      } else if (rule.checkKind === "forbidSearchUrlToken") {
        if (rule.tokens.some((token) => source.searchUrl?.includes(token))) {
          addIssue(rule);
        }
      } else if (rule.checkKind === "forbidSelectorTokens") {
        const token = rule.tokens.find((item) => jsonStr.includes(item));
        if (token) addIssue(rule, `${rule.message} 检测到: ${token}`);
      } else if (rule.checkKind === "cookieLoginShape") {
        if (state.loginFeatures.hasEnabledCookieJar || state.loginFeatures.hasAuthorization || source.enabledCookieJar) {
          if (!source.enabledCookieJar) addIssue(rule, "需要登录态的站点必须设置 enabledCookieJar: true。");
          if (!source.loginUrl) addIssue(rule, "enabledCookieJar 已启用但缺少 loginUrl。");
          if (!source.header || !String(source.header).includes("java.getCookie")) {
            addIssue(rule, "enabledCookieJar 已启用但 header 未使用 java.getCookie 注入 Cookie。");
          }
        }
      } else if (rule.checkKind === "webViewScope") {
        const fields = [];
        if (source.searchUrl && /webView|webview/i.test(source.searchUrl)) fields.push("searchUrl");
        if (source.ruleBookInfo?.tocUrl && /webView|webview/i.test(source.ruleBookInfo.tocUrl)) fields.push("ruleBookInfo.tocUrl");
        if (source.ruleSearch?.bookUrl && /webView|webview/i.test(source.ruleSearch.bookUrl)) fields.push("ruleSearch.bookUrl");
        if (fields.length > 0) addIssue(rule, `${rule.message} 问题字段: ${fields.join(", ")}`);
      } else if (rule.checkKind === "textFieldsNeedAction") {
        for (const group of [source.ruleSearch, source.ruleBookInfo, source.ruleToc]) {
          if (!group || typeof group !== "object") continue;
          for (const field of rule.fields || []) {
            const val = group[field];
            if (typeof val === "string" && val.length > 0 && !val.includes("@") && !isJsonOrJsRule(val)) {
              addIssue(rule, `${field}: "${val}" — ${rule.message}`);
              break;
            }
          }
        }
      } else if (rule.checkKind === "urlFieldsNeedHref") {
        for (const group of [source.ruleSearch, source.ruleToc, source.ruleBookInfo]) {
          if (!group || typeof group !== "object") continue;
          for (const field of rule.fields || []) {
            const val = group[field];
            if (
              typeof val === "string" &&
              val.length > 0 &&
              !val.includes("@href") &&
              !val.includes("@js") &&
              !isJsonOrJsRule(val) &&
              !val.startsWith("http") &&
              !val.startsWith("/") &&
              !val.startsWith("##")
            ) {
              addIssue(rule, `${field}: "${val}" — ${rule.message}`);
              break;
            }
          }
        }
      } else if (rule.checkKind === "webJsShouldReturn") {
        if (source.ruleContent?.webJs) {
          const webJs = String(source.ruleContent.webJs);
          if (!/return|while\s*\(|sleep|document\.querySelector|querySelector/.test(webJs)) {
            addIssue(rule);
          }
        }
      }
    }
  }

  return {
    version: "1.0",
    status: errors.length > 0 ? "failed" : "passed",
    source: "official-rule-pack",
    errors,
    warnings,
    checkedRuleIds,
  };
}

export function writeRuleCheck(runDir, ruleCheck) {
  writeJsonFile(path.join(runDir, "rule-check.json"), ruleCheck);
}

// ── freshness guards ───────────────────────────────────────────────────────

export function ensureAssessmentFactsFresh(state, runDir) {
  const recordedHash = state.phases.assess?.factsHash;
  if (!recordedHash) return null;
  const currentHash = fileSha256(path.join(runDir, "site-facts.json"));
  if (currentHash !== recordedHash) {
    return "site-facts.json 在 record-assessment 后发生变化。必须重新运行 record-assessment，并重新推进后续分析/生成/验证，不能用旧 assessment 交付。";
  }
  return null;
}

export function ensureRuleCheckSourceFresh(runDir, bookSourcePath) {
  const ruleCheck = readJsonFile(path.join(runDir, "rule-check.json"));
  if (!ruleCheck?.sourceHash) return null;
  const currentHash = fileSha256(bookSourcePath);
  if (currentHash !== ruleCheck.sourceHash) {
    return "book-source.json 在 generate 阶段 rule-check 后发生变化。必须重新完成 generate/official-rule-pack 校验，不能用旧 rule-check 继续验证或交付。";
  }
  return null;
}

// ── validator report analysis ──────────────────────────────────────────────

// validator 已经把页面分类/提取失败判定成结构化 errorCode（DebugService.classifyHtmlKindExt
// → ErrorCode）。这里只做 errorCode → blocker 类别的映射，不再用词表二次扫描 bodyPreview/title，
// 避免双层启发式叠加误判（例如正文里出现 "vip"/"验证码" 字样被误判为锁页）。
const ERROR_CODE_BLOCKER = {
  CONTENT_IS_CAPTCHA_PAGE: "captcha",
  CONTENT_IS_VIP_LOCK_PAGE: "vip",
  CONTENT_IS_LOGIN_PAGE: "login",
  COOKIE_REQUIRED: "login",
  COOKIE_PRESENT_BUT_UNAUTHORIZED: "login",
  CONTENT_IS_CSR_SHELL: "csr",
  CHAPTER_URL_MISSING_WEBVIEW: "csr",
  WEBJS_RETURN_EMPTY: "content_extraction",
  WEBJS_EXEC_ERROR: "content_extraction",
  WEBVIEW_RENDER_TIMEOUT: "content_extraction",
  CONTENT_SELECTOR_EMPTY: "content_extraction",
  CONTENT_TOO_SHORT: "content_extraction",
  ANDROID_PROBE_UNAVAILABLE: "android_unavailable",
  APP_REVIEW_REQUIRED: "app_review",
};

export function detectStepBlocker(step) {
  const code = step?.errorCode;
  if (code && ERROR_CODE_BLOCKER[code]) return ERROR_CODE_BLOCKER[code];
  // HTTP_BLOCKED 的具体类别由 validator 的 phase/状态码决定，归为反爬/网络阻断。
  if (code === "HTTP_BLOCKED") return "cloudflare";
  if (code) return "rule_or_network_error";
  return step?.status === "error" ? "rule_or_network_error" : null;
}

export function stepRenderKind(step) {
  if (!step) return null;
  if (stepUsedAndroidProbe(step) && (step.webViewHtmlPreview || step.webViewScreenshotBase64)) return "webview";
  const artifacts = step.debugArtifacts || {};
  if (stepUsedAndroidProbe(step) && (artifacts["response.rendered.html"] || artifacts["screenshot.png"])) return "webview";
  if (step.response?.bodyPreview) return "ssr_or_http";
  return null;
}

export function buildCapabilityMatrix(report, finalStatus) {
  const steps = report?.steps || [];
  const links = {};
  const blockers = [];
  const forcedMatch = typeof finalStatus === "string" ? finalStatus.match(/^blocked:(search|detail|toc|content):([A-Za-z0-9_:-]+)$/) : null;
  const forcedPhase = forcedMatch?.[1] || null;
  const forcedPhaseBlocker = forcedMatch?.[2] || null;
  for (const phase of LINK_PHASES) {
    const phaseSteps = steps.filter((step) => step.phase === phase);
    const failed = phaseSteps.find((step) => step.status === "error");
    const success = phaseSteps.find((step) => step.status === "success");
    const step = failed || success || null;
    const forcedBlocked = phase === "content" && typeof finalStatus === "string" && finalStatus.startsWith("blocked:android_webview_content_not_verified");
    const forcedByQualityGate = forcedPhase === phase;
    const blocker = forcedBlocked ? "android_webview_content_not_verified" : forcedByQualityGate ? forcedPhaseBlocker : detectStepBlocker(step);
    if (blocker) blockers.push(`${phase}:${blocker}`);
    links[phase] = {
      status: forcedBlocked || forcedByQualityGate ? "blocked" : success && !failed ? "success" : failed ? "blocked" : "unknown",
      blocker,
      render: phase === "content" ? stepRenderKind(step) : null,
      mode: step?.mode || null,
      androidBackend: step?.androidBackend || null,
      androidProbeUsed: stepUsedAndroidProbe(step),
      evidenceIds: step ? [`validator:${phase}`] : [],
    };
  }
  const allSuccess = LINK_PHASES.every((phase) => links[phase].status === "success");
  const anySuccess = LINK_PHASES.some((phase) => links[phase].status === "success");
  const overallStatus = typeof finalStatus === "string" && finalStatus.startsWith("blocked:")
    ? finalStatus
    : allSuccess && finalStatus === "passed"
    ? "full_pass"
    : anySuccess
      ? "partial_candidate"
      : finalStatus || "blocked";
  return {
    version: "1.0",
    status: finalStatus || "unknown",
    links,
    overall: {
      status: overallStatus,
      fullPass: overallStatus === "full_pass",
      blockers,
    },
  };
}

export function writeCapabilityMatrix(runDir, reportPath, finalStatus) {
  const report = readJsonFile(reportPath, {});
  const matrix = buildCapabilityMatrix(report, finalStatus);
  writeJsonFile(path.join(runDir, "capability-matrix.json"), matrix);
  return matrix;
}

// ── assessment validation ──────────────────────────────────────────────────

export function loadAndValidateAssessment(runDir, state) {
  const assessPath = path.join(runDir, "assessment.md");
  if (!fileExists(assessPath)) {
    return { ok: false, error: "assessment.md 不存在，请先完成评估。" };
  }

  const content = fs.readFileSync(assessPath, "utf-8");
  const autoError = validateAssessmentAutoBlock(content);
  if (autoError) return { ok: false, error: autoError };

  const factsResult = loadSiteFacts(runDir);
  if (!factsResult.ok) return factsResult;
  const facts = factsResult.facts;
  const evidenceError = validateEvidenceNotes(content, facts);
  if (evidenceError) return { ok: false, error: evidenceError };
  const remarksError = validateAssessmentRemarks(content, facts);
  if (remarksError) return { ok: false, error: remarksError };
  const derived = deriveAssessmentFromFacts(facts);

  const userChoiceMatch = content.match(/用户选择[：:]\s*([^\n\r]+)/);
  if (userChoiceMatch) {
    const choice = userChoiceMatch[1].trim();
    const isPlaceholder = choice.includes("/") || choice.includes("或") || choice.includes("待") || choice === "";
    if (!isPlaceholder) {
      const loginDecision = state.userDecisions?.login;
      const saysNoLogin = /不登录|无账号|匿名/.test(choice);
      const saysLogin = /登录分析|已登录|登录完成/.test(choice) && !saysNoLogin;
      if (saysNoLogin && loginDecision !== "no_account") {
        return { ok: false, error: "assessment.md 写了用户选择为不登录/无账号，但 run-state.json 没有 resolve-user-action --action no_account 记录。不要编用户选择。" };
      }
      if (saysLogin && loginDecision !== "completed") {
        return { ok: false, error: "assessment.md 写了用户选择为登录/已登录，但 run-state.json 没有 resolve-user-action --action login_completed 记录。不要编用户选择。" };
      }
    }
  }

  const autoSummary = renderAssessmentAutoSummary(state, facts, derived);
  const updatedContent = replaceAssessmentAutoSummary(content, autoSummary);
  fs.writeFileSync(assessPath, updatedContent, "utf-8");

  return {
    ok: true,
    rating: derived.rating,
    signals: derived.signals,
    content: updatedContent,
    facts,
    derived,
  };
}
