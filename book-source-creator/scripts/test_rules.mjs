#!/usr/bin/env node

import {
  loadSourceFile,
  auditSourceRules,
  buildSearchPreview,
  formatAuditReport,
} from './lib/book_source_tools.mjs';

function parseArgs(argv) {
  const args = { keyword: '测试', page: '1' };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--keyword') {
      args.keyword = argv[index + 1] ?? args.keyword;
      index += 1;
      continue;
    }

    if (token === '--page') {
      args.page = argv[index + 1] ?? args.page;
      index += 1;
      continue;
    }

    positional.push(token);
  }

  args.filePath = positional[0];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.filePath) {
    console.error('用法: node scripts/test_rules.mjs <书源文件路径> [--keyword 关键词] [--page 页码]');
    process.exit(1);
  }

  try {
    const { sources } = await loadSourceFile(args.filePath);
    const source = sources[0];
    const audit = auditSourceRules(source);

    if (typeof source.searchUrl === 'string' && source.searchUrl) {
      audit.searchPreview = buildSearchPreview(source.searchUrl, args.keyword, args.page);
    }

    console.log(formatAuditReport(source, audit));
    process.exit(0);
  } catch (error) {
    console.error(`审计失败: ${error.message}`);
    process.exit(1);
  }
}

await main();
