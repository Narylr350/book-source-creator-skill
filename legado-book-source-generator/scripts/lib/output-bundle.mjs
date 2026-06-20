import fs from "node:fs";
import path from "node:path";
import { deriveSiteSlug } from "./slug.mjs";

export function initializeOutputBundle(rootDir, siteUrl) {
  const bundleDir = path.join(rootDir, deriveSiteSlug(siteUrl));
  fs.mkdirSync(bundleDir, { recursive: true });

  const filePath = path.join(bundleDir, "book-source.json");
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "[]\n", "utf8");
  }

  return bundleDir;
}

export function initializeRunBundle(rootDir, siteUrl) {
  const bundleDir = path.join(rootDir, deriveSiteSlug(siteUrl));
  fs.mkdirSync(bundleDir, { recursive: true });

  const templates = {
    "assessment.md": [
      "# 网站可生成性评估",
      "",
      "<!-- AUTO:BEGIN summary -->",
      "<!-- AUTO:HASH pending -->",
      "- 站点 URL: " + siteUrl,
      "- 评级: 待评估",
      "- 风险标签: 待评估",
      "- 总体状态: pending",
      "- 搜索链路: unknown",
      "- 详情链路: unknown",
      "- 目录链路: unknown",
      "- 正文链路: unknown",
      "- 登录/Android/WebView: 待评估",
      "- 阻塞原因: 待评估",
      "- 待确认动作: 无",
      "<!-- AUTO:END summary -->",
      "",
      "## 证据说明",
      "",
      "<!-- AI 可写；每条事实说明必须引用 site-facts 或 validator-report 的 evidence id，例如 evidence:search-1。 -->",
      "",
      "## 分析备注",
      "",
      "<!-- AI 可写当前判断、selector 来源、修正原因；不得修改 AUTO 区块结论。 -->",
      "",
    ].join("\n"),
    "analysis.md": [
      "# 网站分析",
      "",
      "## 搜索",
      "",
      "- 页面入口或触发方式: ",
      "- 请求链路或接口来源: ",
      "- 稳定抓取依据: ",
      "- 风险点: ",
      "- Legado 规则建议: ",
      "",
      "## 详情",
      "",
      "- 页面入口或触发方式: ",
      "- 请求链路或接口来源: ",
      "- 稳定抓取依据: ",
      "- 风险点: ",
      "- Legado 规则建议: ",
      "",
      "## 目录",
      "",
      "- 页面入口或触发方式: ",
      "- 请求链路或接口来源: ",
      "- 稳定抓取依据: ",
      "- 风险点: ",
      "- Legado 规则建议: ",
      "",
      "## 正文",
      "",
      "- 页面入口或触发方式: ",
      "- 请求链路或接口来源: ",
      "- 稳定抓取依据: ",
      "- 风险点: ",
      "- Legado 规则建议: ",
      "",
    ].join("\n"),
    "validation-checklist.md": [
      "# Legado 验收清单",
      "",
      "1. 导入 `book-source.json`",
      "2. 验证搜索结果可返回目标书籍",
      "3. 验证详情页元数据可展示",
      "4. 验证目录可正常加载",
      "5. 验证至少两章正文可正常打开",
      "6. 记录失败链路并回修规则",
      "",
    ].join("\n"),
  };

  for (const [filename, content] of Object.entries(templates)) {
    const filePath = path.join(bundleDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf8");
    }
  }

  const jsonTemplates = {
    "site-facts.json": {
      version: "1.0",
      siteUrl,
      links: {
        search: { status: "unknown", blocker: null, render: null, evidenceIds: [] },
        detail: { status: "unknown", blocker: null, render: null, evidenceIds: [] },
        toc: { status: "unknown", blocker: null, render: null, evidenceIds: [] },
        content: { status: "unknown", blocker: null, render: null, evidenceIds: [] },
      },
      evidence: [],
    },
    "capability-matrix.json": {
      version: "1.0",
      status: "pending",
      links: {
        search: { status: "unknown", blocker: null, render: null, evidenceIds: [] },
        detail: { status: "unknown", blocker: null, render: null, evidenceIds: [] },
        toc: { status: "unknown", blocker: null, render: null, evidenceIds: [] },
        content: { status: "unknown", blocker: null, render: null, evidenceIds: [] },
      },
      overall: { status: "pending", fullPass: false, blockers: [] },
    },
    "rule-check.json": {
      version: "1.0",
      status: "pending",
      source: "official-rule-pack",
      errors: [],
      warnings: [],
      checkedRuleIds: [],
    },
    "lesson-check.json": {
      version: "1.0",
      status: "pending",
      triggeredLessons: [],
      answers: [],
    },
  };

  for (const [filename, data] of Object.entries(jsonTemplates)) {
    const filePath = path.join(bundleDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
    }
  }

  return bundleDir;
}
