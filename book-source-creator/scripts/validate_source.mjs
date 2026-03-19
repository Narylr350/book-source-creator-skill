#!/usr/bin/env node

import {
  loadSourceFile,
  validateSourceObject,
  formatValidationReport,
} from './lib/book_source_tools.mjs';

async function main() {
  const [, , filePath, ...rest] = process.argv;
  const jsonOutput = rest.includes('--json');

  if (!filePath) {
    console.error('用法: node scripts/validate_source.mjs <书源文件路径> [--json]');
    process.exit(1);
  }

  try {
    const { sources, absolutePath } = await loadSourceFile(filePath);
    const reports = sources.map((source) => validateSourceObject(source));
    const valid = reports.every((report) => report.valid);

    if (jsonOutput) {
      console.log(JSON.stringify({ file: absolutePath, valid, reports }, null, 2));
    } else {
      console.log(`验证文件: ${absolutePath}`);
      reports.forEach((report, index) => {
        console.log('');
        console.log(formatValidationReport(report, sources.length > 1 ? index : null));
      });
    }

    process.exit(valid ? 0 : 1);
  } catch (error) {
    console.error(`加载失败: ${error.message}`);
    process.exit(1);
  }
}

await main();
