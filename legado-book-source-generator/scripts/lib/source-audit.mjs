import fs from "node:fs/promises";
import path from "node:path";

const PLACEHOLDER_TEXT = new Set([
  "书籍列表规则",
  "书名规则",
  "作者规则",
  "封面规则",
  "详情页URL规则",
  "简介规则",
  "分类规则",
  "最新章节规则",
  "字数规则",
  "目录URL规则",
  "章节列表规则",
  "章节名称规则",
  "章节URL规则",
  "目录下一页规则",
  "正文内容规则",
  "正文下一页规则",
  "搜索URL规则",
]);

const RULE_GROUPS = [
  "ruleSearch",
  "ruleExplore",
  "ruleBookInfo",
  "ruleToc",
  "ruleContent",
];

function isRiskyRuleValue(value) {
  return (
    value.includes("<js>") ||
    value.startsWith("@js:") ||
    value.includes("##") ||
    value.startsWith(":") ||
    value.includes("{'webView': true}") ||
    value.includes('{"webView": true}') ||
    value.includes("java.")
  );
}

export async function loadSourceFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    absolutePath,
    raw,
    parsed,
    sources: Array.isArray(parsed) ? parsed : [parsed],
  };
}

export function buildSearchPreview(searchUrl, keyword = "测试", page = "1") {
  if (!searchUrl || typeof searchUrl !== "string") {
    return "";
  }

  return searchUrl
    .replaceAll("{{key}}", keyword)
    .replaceAll("{{page}}", page);
}

export function auditSourceRules(source) {
  const sections = {};

  for (const groupName of RULE_GROUPS) {
    const group = source[groupName];
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      sections[groupName] = {
        totalFields: 0,
        placeholderFields: [],
        riskyFields: [],
        notes: [],
      };
      continue;
    }

    const placeholderFields = [];
    const riskyFields = [];

    for (const [fieldName, fieldValue] of Object.entries(group)) {
      if (typeof fieldValue !== "string") {
        continue;
      }

      const normalized = fieldValue.trim();
      if (!normalized) {
        continue;
      }

      if (PLACEHOLDER_TEXT.has(normalized)) {
        placeholderFields.push(fieldName);
      }
      if (isRiskyRuleValue(normalized)) {
        riskyFields.push(fieldName);
      }
    }

    const notes = [];
    if (placeholderFields.length > 0) {
      notes.push("存在占位字段，说明这些规则尚未被真实规则替换。");
    }
    if (riskyFields.length > 0) {
      notes.push("存在 JS、正则、WebView 或 java.* 相关规则，需结合站点实测再次确认。");
    }

    sections[groupName] = {
      totalFields: Object.keys(group).length,
      placeholderFields,
      riskyFields,
      notes,
    };
  }

  return {
    loginConfigured: Boolean(source.loginUrl),
    exploreConfigured: Boolean(source.enabledExplore || source.exploreUrl),
    searchPreview: buildSearchPreview(source.searchUrl),
    sections,
  };
}

export function formatAuditReport(source, audit) {
  const lines = [];
  lines.push(`书源: ${source.bookSourceName ?? "未知"}`);
  lines.push(`站点: ${source.bookSourceUrl ?? "未知"}`);
  lines.push(`登录配置: ${audit.loginConfigured ? "已配置" : "未配置"}`);
  lines.push(`发现配置: ${audit.exploreConfigured ? "已配置或已启用" : "未配置或未启用"}`);

  if (audit.searchPreview) {
    lines.push(`搜索预览: ${audit.searchPreview}`);
  }

  for (const [groupName, section] of Object.entries(audit.sections)) {
    lines.push("");
    lines.push(`${groupName}:`);
    lines.push(`  字段数: ${section.totalFields}`);
    lines.push(
      `  占位字段: ${section.placeholderFields.length > 0 ? section.placeholderFields.join(", ") : "无"}`,
    );
    lines.push(
      `  风险字段: ${section.riskyFields.length > 0 ? section.riskyFields.join(", ") : "无"}`,
    );

    for (const note of section.notes) {
      lines.push(`  说明: ${note}`);
    }
  }

  lines.push("");
  lines.push("提示: 本脚本只做静态审计、占位检测和搜索 URL 预览。");
  lines.push("提示: 本脚本不模拟 Legado 的完整规则执行，不据此判断书源最终可用性。");
  return lines.join("\n");
}
