#!/usr/bin/env node

import {
  auditSourceRules,
  buildSearchPreview,
  formatAuditReport,
  loadSourceFile,
} from "./lib/source-audit.mjs";

function parseArgs(argv) {
  const args = {
    keyword: "测试",
    page: "1",
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--keyword") {
      args.keyword = argv[index + 1] ?? args.keyword;
      index += 1;
      continue;
    }
    if (token === "--page") {
      args.page = argv[index + 1] ?? args.page;
      index += 1;
      continue;
    }
    positional.push(token);
  }

  args.filePath = positional[0];
  return args;
}

function printUsage() {
  console.error(
    "Usage:\n" +
      "  node audit-source.mjs <book-source.json> [--keyword 关键词] [--page 页码]",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.filePath) {
    printUsage();
    process.exit(2);
  }

  try {
    const { sources } = await loadSourceFile(args.filePath);
    const reports = sources.map((source, index) => {
      const audit = auditSourceRules(source);
      if (typeof source.searchUrl === "string" && source.searchUrl) {
        audit.searchPreview = buildSearchPreview(source.searchUrl, args.keyword, args.page);
      }
      const header = sources.length > 1 ? [`# 书源 ${index + 1}`, ""] : [];
      return [...header, formatAuditReport(source, audit)].join("\n");
    });

    console.log(reports.join("\n\n"));
    process.exit(0);
  } catch (error) {
    console.error(`审计失败: ${error.message}`);
    process.exit(1);
  }
}

await main();
