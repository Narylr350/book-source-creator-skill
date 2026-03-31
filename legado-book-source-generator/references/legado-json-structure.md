# Legado JSON 结构要点

以 Legado 源码中的 `BookSource`、`SearchRule`、`BookInfoRule`、`TocRule`、`ContentRule` 为准。

## 顶层必填字段

- `bookSourceUrl`
- `bookSourceName`
- `searchUrl`
- `ruleSearch`
- `ruleBookInfo`
- `ruleToc`
- `ruleContent`

## 导入文件格式

- 提供给阅读导入的 `book-source.json` 顶层必须是 JSON 数组。
- 即使当前只生成一个书源，也要写成 `[ { ... } ]`，不要直接输出单个对象。
- 辅助脚本可以校验单对象结构，但最终交付给阅读导入时必须是数组包装格式。

## 常见可选字段

- `bookSourceGroup`
- `bookUrlPattern`
- `header`
- `loginUrl`
- `loginUi`
- `loginCheckJs`
- `enabledCookieJar`
- `enabledExplore`
- `exploreUrl`

## 子规则最低要求

### `ruleSearch`

- `bookList`
- `name`
- `bookUrl`

### `ruleBookInfo`

- `name`
- `tocUrl`

### `ruleToc`

- `chapterList`
- `chapterName`
- `chapterUrl`

### `ruleContent`

- `content`

## 生成建议

- 登录站点优先补 `loginUrl`，必要时补 `header`。
- 默认不启用发现：除非用户明确要求发现页，否则设定 `enabledExplore=false`，并且不生成 `exploreUrl` / `ruleExplore`。
- 搜索、详情、目录、正文的规则字段命名必须和 Legado 源码保持一致。
- 能用静态规则表达时，不要加 JS。
- 默认不要在 `bookSourceComment` 中写调试说明。
- 只有用户明确要求保留限制说明，或进入故障回修阶段时，才考虑在 `bookSourceComment` 写入必要备注。

## 最小示例

```json
[
  {
    "bookSourceUrl": "https://example.com",
    "bookSourceName": "Example",
    "searchUrl": "https://example.com/search?q={{key}}",
    "ruleSearch": {
      "bookList": "$.items[*]",
      "name": "$.title",
      "bookUrl": "$.url"
    },
    "ruleBookInfo": {
      "name": "$.title",
      "tocUrl": "$.tocUrl"
    },
    "ruleToc": {
      "chapterList": "$.chapters[*]",
      "chapterName": "$.title",
      "chapterUrl": "$.url"
    },
    "ruleContent": {
      "content": "$.content"
    }
  }
]
```
