#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

function baseTemplate() {
  return {
    bookSourceName: '',
    bookSourceUrl: '',
    bookSourceType: 0,
    bookSourceGroup: '',
    bookUrlPattern: '',
    customOrder: 0,
    enabled: true,
    enabledExplore: false,
    header: '',
    loginUrl: '',
    bookSourceComment: '',
    lastUpdateTime: 0,
    weight: 0,
    exploreUrl: '',
    searchUrl: '',
    ruleSearch: {},
    ruleExplore: {},
    ruleBookInfo: {},
    ruleToc: {},
    ruleContent: {},
  };
}

function mergeAnalysis(analysis) {
  const template = baseTemplate();
  template.lastUpdateTime = Math.floor(Date.now() / 1000);

  if (analysis.name) template.bookSourceName = analysis.name;
  if (analysis.url) template.bookSourceUrl = analysis.url;
  if (analysis.group) template.bookSourceGroup = analysis.group;

  if (analysis.login?.url) {
    template.loginUrl = analysis.login.url;
  }

  if (analysis.search?.url) {
    template.searchUrl = analysis.search.url;
  }
  if (analysis.search?.rules) {
    template.ruleSearch = { ...analysis.search.rules };
  }

  if (analysis.explore?.url) {
    template.exploreUrl = analysis.explore.url;
    template.enabledExplore = true;
  }
  if (analysis.explore?.rules) {
    template.ruleExplore = { ...analysis.explore.rules };
  }

  if (analysis.book_info?.rules) {
    template.ruleBookInfo = { ...analysis.book_info.rules };
  }
  if (analysis.toc?.rules) {
    template.ruleToc = { ...analysis.toc.rules };
  }
  if (analysis.content?.rules) {
    template.ruleContent = { ...analysis.content.rules };
  }

  return template;
}

async function interactiveTemplate() {
  const rl = readline.createInterface({ input, output });
  const template = baseTemplate();

  template.bookSourceName = (await rl.question('书源名称: ')).trim() || '示例书源';
  template.bookSourceUrl = (await rl.question('网站URL: ')).trim() || 'https://example.com';
  template.bookSourceGroup = (await rl.question('分组（可选）: ')).trim();
  template.bookSourceComment = (await rl.question('注释（可选）: ')).trim();

  const loginNeeded = (await rl.question('该网站是否需要登录后再分析？(y/n): ')).trim().toLowerCase() === 'y';
  if (loginNeeded) {
    template.loginUrl = (await rl.question('登录URL（可选）: ')).trim();
  }

  const hasSearch = (await rl.question('是否支持搜索？(y/n): ')).trim().toLowerCase() === 'y';
  if (hasSearch) {
    template.searchUrl = (await rl.question('搜索URL（使用{{key}}表示关键词）: ')).trim() || '/search?q={{key}}';
  }

  const hasExplore = (await rl.question('是否需要发现功能？(y/n，默认n): ')).trim().toLowerCase() === 'y';
  template.enabledExplore = hasExplore;
  if (hasExplore) {
    template.exploreUrl = (await rl.question('发现URL（使用{{page}}表示页码）: ')).trim() || '/list?page={{page}}';
  }

  template.enabled = (await rl.question('默认启用书源？(y/n，默认y): ')).trim().toLowerCase() !== 'n';
  template.lastUpdateTime = Math.floor(Date.now() / 1000);

  rl.close();
  return template;
}

async function main() {
  const [, , firstArg, secondArg] = process.argv;

  if (firstArg === '--example') {
    console.log(JSON.stringify(mergeAnalysis({
      name: '示例小说网站',
      url: 'https://novel.example.com',
      search: {
        url: '/search?q={{key}}&page={{page}}',
        rules: {
          bookList: '@css:.book-list li',
          name: '@css:.book-title@text',
          author: '@css:.book-author@text',
          coverUrl: '@css:.book-cover img@src',
          bookUrl: '@css:.book-link@href',
        },
      },
    }), null, 2));
    return;
  }

  let template;
  if (firstArg === '--analysis' && secondArg) {
    const analysisPath = path.resolve(secondArg);
    const analysis = JSON.parse(await fs.readFile(analysisPath, 'utf8'));
    template = mergeAnalysis(analysis);
  } else {
    template = await interactiveTemplate();
  }

  console.log(JSON.stringify(template, null, 2));
}

await main();
