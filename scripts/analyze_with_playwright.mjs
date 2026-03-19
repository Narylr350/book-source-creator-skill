#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

function parseArgs(argv) {
  const args = {
    headless: false,
    manualLogin: false,
    save: '',
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--headless') {
      args.headless = true;
      continue;
    }
    if (token === '--manual-login') {
      args.manualLogin = true;
      continue;
    }
    if (token === '--save') {
      args.save = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    positional.push(token);
  }

  args.url = positional[0];
  return args;
}

async function prompt(message) {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(message);
  rl.close();
  return answer.trim();
}

async function importPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    console.error('未检测到 playwright 依赖。请先安装: npm i playwright');
    throw error;
  }
}

async function collectSelectors(page, candidates) {
  const result = {};
  for (const [name, selector] of Object.entries(candidates)) {
    const locator = page.locator(selector);
    const count = await locator.count();
    result[name] = {
      selector,
      count,
    };
    if (count > 0) {
      result[name].sampleText = (await locator.first().innerText().catch(() => '')).slice(0, 120);
    }
  }
  return result;
}

async function analyze(url, options) {
  const { chromium } = await importPlaywright();
  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
  });
  const page = await context.newPage();
  const requests = [];

  page.on('response', (response) => {
    const resourceType = response.request().resourceType();
    if (['xhr', 'fetch', 'document'].includes(resourceType)) {
      requests.push({
        status: response.status(),
        method: response.request().method(),
        resourceType,
        url: response.url(),
      });
    }
  });

  const notes = [];

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const loginIndicators = await collectSelectors(page, {
      loginButton: 'a[href*="login"], button:has-text("登录"), button:has-text("Sign in"), .login, .signin',
      passwordInput: 'input[type="password"]',
      searchInput: 'input[type="search"], input[name*="search"], input[name*="keyword"], input[placeholder*="搜索"]',
      bookLinks: 'a[href*="book"], a[href*="novel"], .book-link, .novel-link',
      chapterLinks: 'a[href*="chapter"], a[href*="read"], .chapter a',
      contentContainer: '#content, .content, .read-content, .chapter-content',
    });

    const title = await page.title();
    const currentUrl = page.url();

    if (loginIndicators.passwordInput.count > 0 || loginIndicators.loginButton.count > 0) {
      notes.push('检测到登录相关元素，建议优先确认是否需要登录后再分析。');
    }

    if (options.manualLogin) {
      notes.push('已启用人工登录流程。');
      console.log('浏览器已打开。若网站需要登录，请由人类在浏览器中完成登录。');
      await prompt('登录完成后按 Enter 继续分析。');
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    const finalSignals = await collectSelectors(page, {
      searchInput: 'input[type="search"], input[name*="search"], input[name*="keyword"], input[placeholder*="搜索"]',
      resultItems: '.book-item, .novel-item, .book-list li, .search-result li',
      tocItems: '.chapter-list li, .directory li, .volume-list li',
      contentContainer: '#content, .content, .read-content, .chapter-content',
    });

    const report = {
      url,
      initialTitle: title,
      finalUrl: currentUrl,
      notes,
      loginIndicators,
      finalSignals,
      capturedRequests: requests.slice(0, 30),
    };

    return { report, browser };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    console.error('用法: node scripts/analyze_with_playwright.mjs <网站URL> [--manual-login] [--save analysis.json] [--headless]');
    process.exit(1);
  }

  const normalizedUrl = args.url.startsWith('http') ? args.url : `https://${args.url}`;

  try {
    const { report, browser } = await analyze(normalizedUrl, args);
    console.log(JSON.stringify(report, null, 2));

    if (args.save) {
      const savePath = path.resolve(args.save);
      await fs.writeFile(savePath, JSON.stringify(report, null, 2), 'utf8');
      console.log(`分析结果已保存到: ${savePath}`);
    }

    if (!args.headless) {
      const answer = await prompt('按 Enter 关闭浏览器，或输入 keep 保持浏览器打开: ');
      if (answer.toLowerCase() !== 'keep') {
        await browser.close();
      }
      return;
    }

    await browser.close();
  } catch (error) {
    console.error(`分析失败: ${error.message}`);
    process.exit(1);
  }
}

await main();
