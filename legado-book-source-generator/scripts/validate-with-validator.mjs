#!/usr/bin/env node
/* eslint-env node */

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
 *   mode: http | browser | android (默认 http)
 * 
 * 输出:
 *   打印 JSON 报告到 stdout
 *   如果指定 --output <dir>，则写入 <dir>/validator-report.json
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const VALIDATOR_URL = process.env.VALIDATOR_URL || 'http://localhost:1111';

async function checkValidator() {
  try {
    const res = await fetch(`${VALIDATOR_URL}/api/sources`, { method: 'GET', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function runDebug(sourceJson, sourceUrl, keyword, mode = 'http', debugDir = null) {
  const body = { sourceJson, sourceUrl, keyword, mode };
  if (debugDir) body.debugDir = debugDir;
  const res = await fetch(`${VALIDATOR_URL}/api/debug/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  return res.json();
}

export function determineStatus(result) {
  if (!result.ok) return { status: 'error', reason: result.error };
  
  const steps = result.steps || [];
  
  // 优先使用服务端 finalStatus（P8.5 状态门禁）
  // 但任何顶层结论都不能丢失 step 里的硬错误原因。
  if (result.finalStatus) {
    const hardError = steps.find(s => s.status === 'error' && !s.needsAppReview);
    if (result.finalStatus === 'failed' && hardError) {
      return { status: 'failed', reason: `${hardError.phase}: ${hardError.error}`, phase: hardError.phase };
    }
    if (['needs_app_review', 'validator_limitation'].includes(result.finalStatus)) {
      if (hardError) {
        return { status: 'failed', reason: `${hardError.phase}: ${hardError.error}`, phase: hardError.phase };
      }
    }
    const warnings = result.compatibilityWarnings || [];
    const warningDesc = warnings.map(w => w.description).join('; ');
    return {
      status: result.finalStatus,
      reason: warningDesc || null,
      warnings: warnings
    };
  }
  
  // fallback: 客户端判定（旧版 validator 兼容）
  const phases = result.phases || {};

  // 记 failIfHardError：如果有不标记 needsAppReview 的步骤真挂了，就返回 failed
  function failIfHardError() {
    const hardError = steps.find(s => s.status === 'error' && !s.needsAppReview);
    if (hardError) return { status: 'failed', reason: `${hardError.phase}: ${hardError.error}` };
    return null;
  }

  // 检查 needsAppReview（之前先看有没有硬错误被掩盖）
  const beforeAppReview = failIfHardError();
  if (beforeAppReview) return beforeAppReview;
  for (const step of steps) {
    if (step.needsAppReview) {
      return { status: 'needs_app_review', reason: step.reviewReason || step.error };
    }
  }

  // 检查 compatibilityWarnings
  const warnings = result.compatibilityWarnings || [];
  if (warnings.length > 0 && Object.values(phases).every(s => s === 'success')) {
    return { status: 'validator_limitation', reason: warnings.map(w => w.description).join('; '), warnings };
  }

  // 全部成功
  if (Object.values(phases).every(s => s === 'success')) {
    return { status: 'passed', reason: null };
  }

  // 检查 Cloudflare/验证码（仅检查失败步骤，不扫描成功步的页面文字）
  // "登录" 在中文站页面中极其常见，不在此处检测；由服务端 hasAnonymousLoginFailure 处理
  const beforeCloudflare = failIfHardError();
  if (beforeCloudflare) return beforeCloudflare;
  for (const step of steps) {
    if (step.status !== 'error') continue;
    const err = step.error || '';
    const rawStep = (result.steps || []).find(s => s.phase === step.phase);
    const rawBody = rawStep?.response?.bodyPreview || '';
    if (/Cloudflare|Turnstile|challenge|captcha|验证码|极验|geetest/i.test(err + rawBody)) {
      const match = (err + rawBody).match(/Cloudflare|Turnstile|challenge|captcha|验证码|极验|geetest/i);
      return { status: 'needs_app_review', reason: match ? match[0] + ' 检测' : err };
    }
  }

  // 有失败
  for (const step of steps) {
    if (step.status === 'error') {
      return { status: 'failed', reason: step.error, phase: step.phase, ruleHits: step.ruleHits };
    }
  }

  return { status: 'failed', reason: 'Unknown failure' };
}

export function extractSummary(result) {
  const summary = result.summary || {};
  const steps = result.steps || [];
  
  return {
    resultCount: summary.resultCount || 0,
    firstBook: summary.firstBook || '',
    chapterCount: summary.chapterCount || 0,
    contentPreview: (summary.contentPreview || '').slice(0, 200),
    phases: result.phases || {},
    ruleHitsCount: steps.reduce((acc, s) => acc + (s.ruleHits?.length || 0), 0),
    failedFields: steps
      .filter(s => s.status === 'error')
      .flatMap(s => (s.ruleHits || []).filter(r => !r.success).map(r => r["field"]))
  };
}

export function normalizeCookieFile(cookies) {
  if (!cookies || typeof cookies !== 'object' || Array.isArray(cookies)) {
    throw new Error('cookies.json 必须是对象');
  }

  if (typeof cookies.domain === 'string' && typeof cookies.cookie === 'string') {
    if (!cookies.domain.includes('.') || !cookies.cookie.includes('=')) {
      throw new Error('cookies.json 的 {domain,cookie} 格式无效');
    }
    return [{ domain: cookies.domain, cookie: cookies.cookie }];
  }

  const entries = Object.entries(cookies);
  if (entries.length === 0) {
    throw new Error('cookies.json 为空');
  }
  if (entries.length === 1 && entries[0][0] === 'domain' && typeof entries[0][1] === 'string' && entries[0][1].includes('=')) {
    throw new Error('cookies.json 写成了 {"domain":"cookie_string"}，缺少真实域名键');
  }

  return entries.map(([domain, cookie]) => {
    if (!domain.includes('.') || typeof cookie !== 'string' || !cookie.includes('=')) {
      throw new Error('cookies.json 应为 {"www.example.com":"a=b; c=d"}，或 {"domain":"www.example.com","cookie":"a=b; c=d"}');
    }
    return { domain, cookie };
  });
}

export function mapReportStep(s) {
  return {
    phase: s.phase,
    status: s.status,
    mode: s.mode,
    error: s.error,
    // ── 诊断字段 (P11) ──
    errorCode: s.errorCode,
    subphase: s.subphase,
    failedField: s.failedField,
    allowedFixes: s.allowedFixes || [],
    forbiddenFixes: s.forbiddenFixes || [],
    evidence: s.evidence || {},
    debugArtifacts: s.debugArtifacts,
    webViewHtmlPreview: s.webViewHtmlPreview,
    webViewScreenshotBase64: s.webViewScreenshotBase64,
    // ── 原有字段 ──
    needsAppReview: s.needsAppReview,
    ruleHits: s.ruleHits || [],
    extracted: s.extracted || {},
    probeAvailable: s.probeAvailable,
    probeDevice: s.probeDevice,
    androidWebViewVersion: s.androidWebViewVersion,
    androidBackend: s.androidBackend,
    androidProbeUsed: s.androidProbeUsed,
    compatibilityWarnings: s.compatibilityWarnings,
    reviewReason: s.reviewReason,
    request: s.request ? {
      url: s.request.url,
      method: s.request.method,
      headers: s.request.headers,
      body: s.request.body,
    } : null,
    response: s.response ? {
      code: s.response.code,
      bodyLength: s.response.bodyLength,
      bodyPreview: s.response.bodyPreview,
      headers: s.response.headers,
      rendered: s.response.rendered,
    } : null,
    preview: s.preview?.slice(0, 200),
    sessionMode: s.sessionMode,
  };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('用法: node validate-with-validator.mjs <source-json-file> <keyword> [http|browser|android] [--output {dir}] [--cookie=<file>]');
    process.exit(1);
  }
  
  const sourceFile = args[0];
  const keyword = args[1];
  const outputIdx = args.indexOf('--output');
  const modeIdx = args.findIndex(a => ['http', 'browser', 'android'].includes(a));
  const mode = modeIdx >= 0 ? args[modeIdx] : 'http';
  const debugDirIdx = args.indexOf('--debug-dir');
  const debugDir = debugDirIdx >= 0 ? args[debugDirIdx + 1] : null;
  const outputDir = outputIdx >= 0 ? args[outputIdx + 1] : null;
  const cookieArg = args.find(a => a.startsWith('--cookie='));
  const cookieFile = cookieArg ? cookieArg.split('=')[1] : null;
  
  // 加载 Cookie
  if (cookieFile) {
    try {
      const cookieEntries = normalizeCookieFile(JSON.parse(readFileSync(cookieFile, 'utf-8')));
      for (const { domain, cookie } of cookieEntries) {
        await fetch(`${VALIDATOR_URL}/api/cookie/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, cookie })
        });
      }
      console.error(`已加载 ${cookieEntries.length} 个域的 Cookie`);
    } catch (e) {
      console.error(`Cookie 文件加载失败: ${e.message}`);
      process.exit(1);
    }
  }
  
  // 检查 validator
  const running = await checkValidator();
  if (!running) {
    const report = {
      _generatedBy: 'validate-with-validator.mjs',
      _schemaVersion: '1.0',
      _runDir: outputDir || null,
      _sourceHash: null,
      status: 'skipped',
      reason: 'Validator 未运行，请先启动: node scripts/bsg.mjs validator-start 或 java -jar legado-source-validator.jar',
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
  const sourceHash = createHash('sha256').update(sourceJson).digest('hex');
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
  
  // 创建 debugDir（如果指定）
  if (debugDir) {
    mkdirSync(debugDir, { recursive: true });
    console.error(`调试产物目录: ${debugDir}`);
  }

  // 调用 validator
  console.error(`验证中: ${sourceUrl} keyword="${keyword}" mode=${mode}`);
  const result = await runDebug(sourceJson, sourceUrl, keyword, mode, debugDir);
  
  // 判定状态
  const { status, reason, phase } = determineStatus(result);
  const summary = extractSummary(result);
  
  // Debug: log detection info
  // noinspection JSUnresolvedReference
  if (process.env.DEBUG) {
    const rawSteps = result.steps || [];
    for (const s of rawSteps) {
      console.error(`[DEBUG] step ${s.phase}: bodyPreview length=${s.response?.["bodyPreview"]?.length}, has turnstile=${s.response?.["bodyPreview"]?.includes('turnstile')}`);
    }
    console.error(`[DEBUG] status=${status}, reason=${reason}`);
  }
  
  // 构建报告
  const report = {
    _generatedBy: 'validate-with-validator.mjs',
    _schemaVersion: '1.0',
    _runDir: outputDir || null,
    _sourceHash: sourceHash,
    status,
    reason,
    phase,
    sourceUrl,
    keyword,
    mode,
    timestamp: new Date().toISOString(),
    summary,
    phases: result.phases || {},
    steps: (result.steps || []).map(mapReportStep),
    raw: result,
    finalStatus: result.finalStatus,
    compatibilityWarnings: result.compatibilityWarnings
  };
  
  // 输出
  console.log(JSON.stringify(report, null, 2));
  
  if (outputDir) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'validator-report.json'), JSON.stringify(report, null, 2));
    console.error(`报告已写入: ${join(outputDir, 'validator-report.json')}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => {
    console.error('执行失败:', e.message);
    process.exit(1);
  });
}
