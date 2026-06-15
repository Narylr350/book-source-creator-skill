#!/usr/bin/env node

/**
 * validate-with-validator.mjs
 * 
 * 调用 validator API 验证书源，输出 JSON 报告。
 * 
 * 用法:
 *   node scripts/validate-with-validator.mjs <source-json-file> <keyword> [mode]
 * 
 * 参数:
 *   source-json-file: 书源 JSON 文件路径
 *   keyword: 搜索关键词
 *   mode: http | browser | auto (默认 http)
 * 
 * 输出:
 *   打印 JSON 报告到 stdout
 *   如果指定 --output <dir>，则写入 <dir>/validator-report.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, basename, join } from 'path';

const VALIDATOR_URL = process.env.VALIDATOR_URL || 'http://localhost:1111';

async function checkValidator() {
  try {
    const res = await fetch(`${VALIDATOR_URL}/api/sources`, { method: 'GET', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function runDebug(sourceJson, sourceUrl, keyword, mode = 'http') {
  const res = await fetch(`${VALIDATOR_URL}/api/debug/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceJson, sourceUrl, keyword, mode }),
    signal: AbortSignal.timeout(120000)
  });
  return res.json();
}

function determineStatus(result) {
  if (!result.ok) return { status: 'error', reason: result.error };
  
  const steps = result.steps || [];
  const phases = result.phases || {};
  
  // 全部成功
  if (Object.values(phases).every(s => s === 'success')) {
    return { status: 'passed', reason: null };
  }
  
  // 检查 needsAppReview
  for (const step of steps) {
    if (step.needsAppReview) {
      return { status: 'needs_app_review', reason: step.reviewReason || step.error };
    }
  }
  
  // 检查 Cloudflare/验证码
  for (const step of steps) {
    const err = step.error || '';
    const body = step.response?.bodyPreview || '';
    if (/Cloudflare|Turnstile|challenge|验证码|登录|WebView/i.test(err + body)) {
      return { status: 'needs_app_review', reason: err };
    }
  }
  
  // 有失败但可修
  for (const step of steps) {
    if (step.status === 'error') {
      return { status: 'failed', reason: step.error, phase: step.phase, ruleHits: step.ruleHits };
    }
  }
  
  return { status: 'failed', reason: 'Unknown failure' };
}

function extractSummary(result) {
  const summary = result.summary || {};
  const steps = result.steps || [];
  
  return {
    resultCount: summary.resultCount || 0,
    firstBook: summary.firstBook || '',
    chapterCount: summary.chapterCount || 0,
    contentPreview: (summary.contentPreview || '').slice(0, 200),
    phases: result.phases || {},
    ruleHitsCount: steps.reduce((acc, s) => acc + (s.ruleHits?.length || 0), 0),
    failedFields: steps.flatMap(s => (s.ruleHits || []).filter(r => !r.success).map(r => r.field))
  };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('用法: node validate-with-validator.mjs <source-json-file> <keyword> [mode] [--output <dir>]');
    process.exit(1);
  }
  
  const sourceFile = args[0];
  const keyword = args[1];
  const mode = args[2] || 'http';
  const outputIdx = args.indexOf('--output');
  const outputDir = outputIdx >= 0 ? args[outputIdx + 1] : null;
  
  // 检查 validator
  const running = await checkValidator();
  if (!running) {
    const report = {
      status: 'skipped',
      reason: 'Validator 未运行，请先启动: run.bat 或 java -jar legado-source-validator.jar',
      timestamp: new Date().toISOString()
    };
    console.log(JSON.stringify(report, null, 2));
    if (outputDir) {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'validator-report.json'), JSON.stringify(report, null, 2));
    }
    process.exit(0);
  }
  
  // 读取书源
  const sourceJson = readFileSync(sourceFile, 'utf-8');
  let sourceUrl;
  try {
    const parsed = JSON.parse(sourceJson);
    sourceUrl = Array.isArray(parsed) ? parsed[0]?.bookSourceUrl : parsed.bookSourceUrl;
  } catch {
    console.error('无法解析书源 JSON');
    process.exit(1);
  }
  
  if (!sourceUrl) {
    console.error('书源中找不到 bookSourceUrl');
    process.exit(1);
  }
  
  // 调用 validator
  console.error(`验证中: ${sourceUrl} keyword="${keyword}" mode=${mode}`);
  const result = await runDebug(sourceJson, sourceUrl, keyword, mode);
  
  // 判定状态
  const { status, reason, phase, ruleHits } = determineStatus(result);
  const summary = extractSummary(result);
  
  // 构建报告
  const report = {
    status,
    reason,
    phase,
    sourceUrl,
    keyword,
    mode,
    timestamp: new Date().toISOString(),
    summary,
    phases: result.phases || {},
    steps: (result.steps || []).map(s => ({
      phase: s.phase,
      status: s.status,
      mode: s.mode,
      error: s.error,
      needsAppReview: s.needsAppReview,
      ruleHits: s.ruleHits || [],
      request: s.request ? { url: s.request.url, method: s.request.method } : null,
      response: s.response ? { code: s.response.code, bodyLength: s.response.bodyLength } : null
    })),
    raw: result
  };
  
  // 输出
  console.log(JSON.stringify(report, null, 2));
  
  if (outputDir) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'validator-report.json'), JSON.stringify(report, null, 2));
    console.error(`报告已写入: ${join(outputDir, 'validator-report.json')}`);
  }
}

main().catch(e => {
  console.error('执行失败:', e.message);
  process.exit(1);
});
