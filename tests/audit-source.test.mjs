import test from "node:test";
import assert from "node:assert/strict";

import {
  auditSourceRules,
  buildSearchPreview,
  collectEmbeddedJsSyntaxErrors,
} from "../legado-book-source-generator/scripts/lib/source-audit.mjs";

test("auditSourceRules flags placeholder and risky rule fields", () => {
  const audit = auditSourceRules({
    bookSourceName: "Demo",
    bookSourceUrl: "https://example.com",
    searchUrl: "https://example.com/search?q={{key}}",
    ruleSearch: {
      bookList: "书籍列表规则",
      name: "@css:.title@text",
      bookUrl: "@js:'/book/' + result",
    },
  });

  assert.deepEqual(audit.sections.ruleSearch.placeholderFields, ["bookList"]);
  assert.deepEqual(audit.sections.ruleSearch.riskyFields, ["bookUrl"]);
});

test("buildSearchPreview replaces Legado variables for quick inspection", () => {
  const preview = buildSearchPreview(
    "https://example.com/search?q={{key}}&page={{page}}",
    "凡人修仙传",
    "3",
  );

  assert.equal(preview, "https://example.com/search?q=凡人修仙传&page=3");
});

test("collectEmbeddedJsSyntaxErrors flags invalid regex escaping in embedded JS", () => {
  const errors = collectEmbeddedJsSyntaxErrors({
    ruleContent: {
      content:
        "<js>\n" +
        "body = body\n" +
        "  .replace(/<div[^>]*class=\"chapter-separator\"[\\\\s\\\\S]*?<\\\\/div>/gi, '');\n" +
        "</js>",
    },
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /ruleContent\.content/);
});

test("auditSourceRules reports embedded JS syntax status in the audit summary", () => {
  const audit = auditSourceRules({
    bookSourceName: "Demo",
    bookSourceUrl: "https://example.com",
    searchUrl: "https://example.com/search?q={{key}}",
    ruleContent: {
      content:
        "<js>\n" +
        "result = String(result || '').replace(/<br\\s*\\/?>/gi, '\\n');\n" +
        "result;\n" +
        "</js>",
    },
  });

  assert.deepEqual(audit.jsSyntaxErrors, []);
});
