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
- `header` — JSON 字符串形式的请求头；UA 完整性要求见 `legado-source-behavior.md`
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

- `name` — 必填
- `tocUrl` — 常规建议填写；如果目录嵌在详情页，允许留空，但必须在 `analysis.md` 里说明依据

### `ruleToc`

- `chapterList`
- `chapterName`
- `chapterUrl`
- `nextTocUrl` — 目录分页入口，返回下一页 URL 或 URL 数组；没有真实分页证据时不要编造

### `ruleContent`

- `content`

## 生成建议

- 登录站点优先补 `loginUrl`，必要时补 `header`。
- 默认不启用发现：除非用户明确要求发现页，否则设定 `enabledExplore=false`，并且不生成 `exploreUrl` / `ruleExplore`。
- 搜索、详情、目录、正文的规则字段命名必须和 Legado 源码保持一致。
- 能用静态规则表达时，不要加 JS。
- XPath、CSS、JSONPath、Regex 都要以 validator 实测命中为准；选择器语法不确定时先做局部验证，不要把浏览器控制台可用语法直接当成阅读规则语法。
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
