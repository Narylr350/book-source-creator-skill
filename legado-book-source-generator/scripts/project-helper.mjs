import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";


const REQUIRED_TOP_LEVEL_FIELDS = [
  "bookSourceUrl",
  "bookSourceName",
  "searchUrl",
  "ruleSearch",
  "ruleBookInfo",
  "ruleToc",
  "ruleContent",
];

const REQUIRED_RULE_FIELDS = {
  ruleSearch: ["bookList", "name", "bookUrl"],
  // tocUrl may be intentionally blank when the TOC is embedded in the detail page.
  ruleBookInfo: ["name"],
  ruleToc: ["chapterList", "chapterName", "chapterUrl"],
  ruleContent: ["content"],
};

const OUTPUT_FILENAMES = [
  "assessment.md",
  "analysis.md",
  "book-source.json",
  "validation-checklist.md",
];


export function deriveSiteSlug(siteUrl) {
  let host = "";
  try {
    host = new URL(siteUrl).host;
  } catch {
    host = siteUrl;
  }

  host = host.toLowerCase().trim();
  if (host.includes("@")) {
    host = host.split("@").at(-1);
  }
  if (host.includes(":")) {
    host = host.split(":")[0];
  }
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }

  const slug = host.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "site";
}


export function initializeOutputBundle(rootDir, siteUrl) {
  const bundleDir = path.join(rootDir, deriveSiteSlug(siteUrl));
  fs.mkdirSync(bundleDir, { recursive: true });

  const templates = {
    "assessment.md": [
      "# 网站可生成性评估",
      "",
      "- 目标站点: ",
      `- 站点 URL: ${siteUrl}`,
      "- 登录需求: ",
      "- 评级: ",
      "- 是否高风险: ",
      "- 继续生成理由: ",
      "- 阻塞点: ",
      "- 预期失效环节: ",
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
    "book-source.json": "[]\n",
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

  for (const filename of OUTPUT_FILENAMES) {
    const filePath = path.join(bundleDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, templates[filename], "utf8");
    }
  }

  return bundleDir;
}


function isBlank(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}


export function validateBookSource(source) {
  const errors = [];

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in source) || isBlank(source[field])) {
      errors.push(`Missing required top-level field: ${field}`);
    }
  }

  for (const [ruleName, fields] of Object.entries(REQUIRED_RULE_FIELDS)) {
    const ruleValue = source[ruleName];
    if (!(ruleName in source) || isBlank(ruleValue)) {
      continue;
    }
    if (typeof ruleValue !== "object" || Array.isArray(ruleValue)) {
      errors.push(`${ruleName} must be an object`);
      continue;
    }
    for (const field of fields) {
      if (!(field in ruleValue) || isBlank(ruleValue[field])) {
        errors.push(`Missing required nested field: ${ruleName}.${field}`);
      }
    }
  }

  return errors;
}


function readSource(jsonPath) {
  const payload = jsonPath
    ? fs.readFileSync(jsonPath, "utf8")
    : fs.readFileSync(0, "utf8");
  const data = JSON.parse(payload);
  if (Array.isArray(data)) {
    if (data.length === 0) {
      throw new Error("Book source payload must contain at least one source.");
    }
    return data;
  }
  if (!data || typeof data !== "object") {
    throw new Error("Book source payload must be a JSON object or a non-empty JSON array.");
  }
  return [data];
}


function printUsage() {
  console.error(
    "Usage:\n" +
      "  node project-helper.mjs scaffold-output <outputs-root> <site-url>\n" +
      "  node project-helper.mjs validate-source [book-source.json]",
  );
}


function main(argv) {
  const [command, ...rest] = argv;

  if (command === "scaffold-output") {
    if (rest.length !== 2) {
      printUsage();
      return 2;
    }
    const [rootDir, siteUrl] = rest;
    const bundleDir = initializeOutputBundle(rootDir, siteUrl);
    console.log(bundleDir);
    return 0;
  }

  if (command === "validate-source") {
    if (rest.length > 1) {
      printUsage();
      return 2;
    }
    try {
      const sources = readSource(rest[0]);
      const errors = [];
      for (const [index, source] of sources.entries()) {
        const sourceErrors = validateBookSource(source);
        for (const error of sourceErrors) {
          errors.push(sources.length > 1 ? `[${index}] ${error}` : error);
        }
      }
      if (errors.length > 0) {
        for (const error of errors) {
          console.error(error);
        }
        return 1;
      }
      console.log("Book source JSON is valid.");
      return 0;
    } catch (error) {
      console.error(`Failed to load JSON: ${error.message}`);
      return 2;
    }
  }

  printUsage();
  return 2;
}


if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
