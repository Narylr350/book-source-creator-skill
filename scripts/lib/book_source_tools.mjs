import fs from 'node:fs/promises';
import path from 'node:path';

export const REQUIRED_FIELDS = [
  'bookSourceName',
  'bookSourceUrl',
  'bookSourceType',
];

export const OPTIONAL_TYPE_CHECKS = {
  bookSourceGroup: ['string', 'null'],
  bookUrlPattern: ['string', 'null'],
  loginUrl: ['string', 'null'],
  searchUrl: ['string', 'null'],
  exploreUrl: ['string', 'null'],
  weight: ['number', 'null'],
  customOrder: ['number', 'null'],
  enabled: ['boolean', 'null'],
  enabledExplore: ['boolean', 'null'],
  lastUpdateTime: ['number', 'null'],
};

export const RULE_FIELDS = {
  ruleSearch: ['bookList', 'name', 'author', 'coverUrl', 'bookUrl'],
  ruleExplore: ['bookList', 'name', 'author', 'coverUrl', 'bookUrl'],
  ruleBookInfo: ['name', 'author', 'coverUrl', 'intro', 'tocUrl'],
  ruleToc: ['chapterList', 'chapterName', 'chapterUrl'],
  ruleContent: ['content'],
};

const PLACEHOLDER_TEXT = new Set([
  '书籍列表规则',
  '书名规则',
  '作者规则',
  '封面规则',
  '详情页URL规则',
  '简介规则',
  '分类规则',
  '最新章节规则',
  '字数规则',
  '目录URL规则',
  '允许修改书名作者规则',
  '章节列表规则',
  '章节名称规则',
  '章节URL规则',
  'VIP标识规则',
  '更新时间规则',
  '目录下一页规则',
  '正文内容规则',
  '正文下一页规则',
  'WebView JavaScript',
  '资源正则规则',
]);

export async function loadSourceFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    absolutePath,
    raw,
    parsed,
    sources: Array.isArray(parsed) ? parsed : [parsed],
  };
}

export function buildSearchPreview(searchUrl, keyword = '测试', page = '1') {
  if (!searchUrl || typeof searchUrl !== 'string') {
    return '';
  }

  return searchUrl
    .replaceAll('{{key}}', keyword)
    .replaceAll('{{page}}', page);
}

export function validateSourceObject(source) {
  const errors = [];
  const warnings = [];

  for (const field of REQUIRED_FIELDS) {
    if (!(field in source)) {
      errors.push(`缺少必填字段: ${field}`);
      continue;
    }

    if (source[field] === '' || source[field] === null || source[field] === undefined) {
      warnings.push(`字段为空: ${field}`);
    }
  }

  if ('bookSourceType' in source && source.bookSourceType !== null && typeof source.bookSourceType !== 'number') {
    errors.push('字段类型错误: bookSourceType 应为 number');
  }

  for (const [field, acceptedTypes] of Object.entries(OPTIONAL_TYPE_CHECKS)) {
    if (!(field in source)) {
      continue;
    }

    const value = source[field];
    const valueType = value === null ? 'null' : typeof value;
    if (!acceptedTypes.includes(valueType)) {
      errors.push(`字段类型错误: ${field} 应为 ${acceptedTypes.join(' 或 ')}`);
    }
  }

  for (const [ruleGroup, expectedFields] of Object.entries(RULE_FIELDS)) {
    if (!(ruleGroup in source) || source[ruleGroup] === '' || source[ruleGroup] === null) {
      continue;
    }

    if (typeof source[ruleGroup] !== 'object' || Array.isArray(source[ruleGroup])) {
      errors.push(`${ruleGroup} 应为对象`);
      continue;
    }

    if (Object.keys(source[ruleGroup]).length === 0) {
      continue;
    }

    for (const field of expectedFields) {
      if (!(field in source[ruleGroup])) {
        warnings.push(`${ruleGroup} 缺少推荐字段: ${field}`);
      }
    }
  }

  for (const field of ['bookSourceUrl', 'searchUrl', 'exploreUrl', 'loginUrl']) {
    if (!(field in source) || !source[field]) {
      continue;
    }

    if (typeof source[field] !== 'string') {
      continue;
    }

    if (!source[field].startsWith('http://') && !source[field].startsWith('https://') && !source[field].startsWith('/')) {
      warnings.push(`${field} 看起来不是标准 URL 或相对路径: ${source[field]}`);
    }
  }

  if (typeof source.searchUrl === 'string' && source.searchUrl && !source.searchUrl.includes('{{key}}')) {
    warnings.push('searchUrl 中可能缺少 {{key}} 变量');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      sourceName: source.bookSourceName ?? '未知',
      sourceUrl: source.bookSourceUrl ?? '未知',
      configuredRuleGroups: Object.keys(RULE_FIELDS).filter((group) => group in source).length,
      totalRuleGroups: Object.keys(RULE_FIELDS).length,
    },
  };
}

export function auditSourceRules(source) {
  const sections = {};

  for (const [sectionName, sectionValue] of Object.entries(source)) {
    if (!sectionName.startsWith('rule')) {
      continue;
    }

    if (!sectionValue || typeof sectionValue !== 'object' || Array.isArray(sectionValue)) {
      sections[sectionName] = {
        totalFields: 0,
        placeholderFields: [],
        riskyFields: [],
        notes: ['该规则组为空或不是对象'],
      };
      continue;
    }

    const placeholderFields = [];
    const riskyFields = [];

    for (const [fieldName, fieldValue] of Object.entries(sectionValue)) {
      if (typeof fieldValue !== 'string') {
        continue;
      }

      const normalized = fieldValue.trim();
      if (!normalized) {
        continue;
      }

      if (PLACEHOLDER_TEXT.has(normalized)) {
        placeholderFields.push(fieldName);
      }

      if (
        normalized.includes('<js>') ||
        normalized.startsWith('@js:') ||
        normalized.includes('##') ||
        normalized.startsWith(':')
      ) {
        riskyFields.push(fieldName);
      }
    }

    const notes = [];
    if (placeholderFields.length > 0) {
      notes.push('存在占位规则，表示这些字段还没有被真实规则替换');
    }
    if (riskyFields.length > 0) {
      notes.push('存在 JS 或正则类规则，建议结合真实页面和接口再次人工确认');
    }

    sections[sectionName] = {
      totalFields: Object.keys(sectionValue).length,
      placeholderFields,
      riskyFields,
      notes,
    };
  }

  return {
    searchPreview: buildSearchPreview(source.searchUrl),
    loginConfigured: Boolean(source.loginUrl),
    sections,
  };
}

export function formatValidationReport(report, index = null) {
  const lines = [];
  if (index !== null) {
    lines.push(`书源 #${index + 1}`);
  }

  if (report.errors.length > 0) {
    lines.push('错误:');
    for (const error of report.errors) {
      lines.push(`  - ${error}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push('警告:');
    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  if (report.errors.length === 0 && report.warnings.length === 0) {
    lines.push('验证通过');
  }

  lines.push(`名称: ${report.stats.sourceName}`);
  lines.push(`URL: ${report.stats.sourceUrl}`);
  lines.push(`规则组: ${report.stats.configuredRuleGroups}/${report.stats.totalRuleGroups}`);
  return lines.join('\n');
}

export function formatAuditReport(source, audit) {
  const lines = [];
  lines.push(`书源: ${source.bookSourceName ?? '未知'}`);
  lines.push(`站点: ${source.bookSourceUrl ?? '未知'}`);
  lines.push(`登录配置: ${audit.loginConfigured ? '已配置 loginUrl' : '未配置 loginUrl'}`);

  if (audit.searchPreview) {
    lines.push(`搜索预览: ${audit.searchPreview}`);
  }

  for (const [sectionName, section] of Object.entries(audit.sections)) {
    lines.push('');
    lines.push(`${sectionName}:`);
    lines.push(`  字段数: ${section.totalFields}`);
    lines.push(`  占位字段: ${section.placeholderFields.length > 0 ? section.placeholderFields.join(', ') : '无'}`);
    lines.push(`  高风险字段: ${section.riskyFields.length > 0 ? section.riskyFields.join(', ') : '无'}`);

    for (const note of section.notes) {
      lines.push(`  说明: ${note}`);
    }
  }

  lines.push('');
  lines.push('提示: 这个脚本只做规则审计和预览，不模拟 Legado 的完整解析结果。');
  lines.push('提示: 真实是否可用，应结合浏览器页面、网络请求和 AI 对站点结构的分析来判断。');
  return lines.join('\n');
}
