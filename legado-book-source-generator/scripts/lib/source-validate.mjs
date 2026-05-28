const REQUIRED_TOP_LEVEL_FIELDS = [
  "bookSourceUrl",
  "bookSourceName",
  "searchUrl",
  "ruleSearch",
  "ruleBookInfo",
  "ruleToc",
  "ruleContent",
];

const REQUIRED_RULE_FIELDS = {
  ruleSearch: ["bookList", "name", "bookUrl"],
  // tocUrl: 常规建议填写；目录嵌在详情页时允许留空，但必须在 analysis.md 里说明依据。
  ruleBookInfo: ["name"],
  ruleToc: ["chapterList", "chapterName", "chapterUrl"],
  ruleContent: ["content"],
};

function isBlank(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function validateBookSource(source) {
  const errors = [];

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in source) || isBlank(source[field])) {
      errors.push(`Missing required top-level field: ${field}`);
    }
  }

  for (const [ruleName, fields] of Object.entries(REQUIRED_RULE_FIELDS)) {
    const ruleValue = source[ruleName];
    if (!(ruleName in source) || isBlank(ruleValue)) {
      continue;
    }
    if (typeof ruleValue !== "object" || Array.isArray(ruleValue)) {
      errors.push(`${ruleName} must be an object`);
      continue;
    }
    for (const field of fields) {
      if (!(field in ruleValue) || isBlank(ruleValue[field])) {
        errors.push(`Missing required nested field: ${ruleName}.${field}`);
      }
    }
  }

  return errors;
}
