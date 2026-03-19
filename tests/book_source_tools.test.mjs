import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSourceObject,
  auditSourceRules,
  buildSearchPreview,
} from '../scripts/lib/book_source_tools.mjs';

test('validateSourceObject reports missing required fields as errors', () => {
  const report = validateSourceObject({
    bookSourceName: 'Demo',
    bookSourceType: 0,
  });

  assert.equal(report.valid, false);
  assert.deepEqual(report.errors, ['缺少必填字段: bookSourceUrl']);
});

test('validateSourceObject accepts a minimal valid source', () => {
  const report = validateSourceObject({
    bookSourceName: 'Demo',
    bookSourceUrl: 'https://example.com',
    bookSourceType: 0,
  });

  assert.equal(report.valid, true);
  assert.deepEqual(report.errors, []);
});

test('validateSourceObject does not warn on empty optional rule groups', () => {
  const report = validateSourceObject({
    bookSourceName: 'Demo',
    bookSourceUrl: 'https://example.com',
    bookSourceType: 0,
    ruleExplore: {},
    ruleBookInfo: {},
    ruleToc: {},
    ruleContent: {},
  });

  assert.equal(report.valid, true);
  assert.deepEqual(report.warnings, []);
});

test('auditSourceRules flags placeholder rules instead of pretending to execute them', () => {
  const audit = auditSourceRules({
    searchUrl: 'https://example.com/search?q={{key}}',
    ruleSearch: {
      bookList: '书籍列表规则',
      name: '@css:.title@text',
    },
  });

  assert.equal(audit.sections.ruleSearch.totalFields, 2);
  assert.deepEqual(audit.sections.ruleSearch.placeholderFields, ['bookList']);
  assert.equal(audit.sections.ruleSearch.riskyFields.length, 0);
});

test('buildSearchPreview fills Legado variables for quick inspection', () => {
  const preview = buildSearchPreview(
    'https://example.com/search?q={{key}}&page={{page}}',
    '凡人修仙传',
    '3',
  );

  assert.equal(preview, 'https://example.com/search?q=凡人修仙传&page=3');
});
