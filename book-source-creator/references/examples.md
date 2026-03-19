# Legado书源示例

本文档包含各种类型的Legado书源示例，供参考和学习。

## 目录

1. [简单HTML网站书源](#简单html网站书源)
2. [JSON API书源](#json-api书源)
3. [需要登录的书源](#需要登录的书源)
4. [有声书源](#有声书源)
5. [漫画书源](#漫画书源)
6. [WebView书源](#webview书源)
7. [多规则组合书源](#多规则组合书源)

## 重要说明

### 关于发现功能
- **发现功能一般不使用**：大多数书源只需要搜索功能，不需要发现功能
- **默认设置**：建议将 `"enabledExplore": false` 作为默认设置
- **使用场景**：只有当网站有专门的推荐页、排行榜页或分类浏览页，且用户明确需要时才启用发现功能
- **配置原则**：优先保证搜索功能正常工作，发现功能作为可选补充

## 简单HTML网站书源

### 示例1：基础小说网站

```json
{
  "bookSourceName": "示例小说网",
  "bookSourceUrl": "https://novel.example.com",
  "bookSourceType": 0,
  "bookSourceGroup": "小说",
  "searchUrl": "/search?keyword={{key}}&page={{page}}",
  "ruleSearch": {
    "bookList": "@css:.book-item",
    "name": "@css:.book-title@text",
    "author": "@css:.book-author@text",
    "coverUrl": "@css:.book-cover img@src",
    "bookUrl": "@css:.book-link@href",
    "intro": "@css:.book-intro@text",
    "kind": "@css:.book-category@text",
    "lastChapter": "@css:.book-last-chapter@text",
    "wordCount": "@css:.book-word-count@text"
  },
  "ruleBookInfo": {
    "name": "@css:h1.book-title@text",
    "author": "@css:.book-meta .author@text",
    "coverUrl": "@css:.book-cover img@src",
    "intro": "@css:.book-description@html",
    "kind": "@css:.book-meta .category@text",
    "lastChapter": "@css:.book-meta .last-chapter@text",
    "wordCount": "@css:.book-meta .word-count@text",
    "tocUrl": "@css:#toc-link@href"
  },
  "ruleToc": {
    "chapterList": "@css:.chapter-list li",
    "chapterName": "@css:.chapter-title@text",
    "chapterUrl": "@css:.chapter-link@href",
    "nextTocUrl": "@css:.next-page@href"
  },
  "ruleContent": {
    "content": "@css:.chapter-content@html##<script[^>]*>.*?</script>##",
    "nextContentUrl": "@css:.next-chapter@href"
  },
  "enabled": true,
  "enabledExplore": false,  // 默认禁用发现功能
  "weight": 0
}
```

### 示例2：使用XPath的书源

```json
{
  "bookSourceName": "XPath示例书源",
  "bookSourceUrl": "https://xpath.example.com",
  "bookSourceType": 0,
  "searchUrl": "/search?q={{key}}",
  "ruleSearch": {
    "bookList": "@XPath://div[@class='book-list']/div",
    "name": "@XPath:.//h3/a/text()",
    "author": "@XPath:.//span[@class='author']/text()",
    "coverUrl": "@XPath:.//img/@src",
    "bookUrl": "@XPath:.//a/@href"
  },
  "ruleBookInfo": {
    "name": "@XPath://h1[@class='book-title']/text()",
    "author": "@XPath://div[@class='author']/text()",
    "coverUrl": "@XPath://img[@class='book-cover']/@src",
    "intro": "@XPath://div[@class='description']/html()",
    "tocUrl": "@XPath://a[@id='toc']/@href"
  },
  "ruleToc": {
    "chapterList": "@XPath://ul[@class='chapter-list']/li",
    "chapterName": "@XPath:.//a/text()",
    "chapterUrl": "@XPath:.//a/@href"
  },
  "ruleContent": {
    "content": "@XPath://div[@id='content']/html()"
  }
}
```

## JSON API书源

### 示例3：REST API书源

```json
{
  "bookSourceName": "JSON API书源",
  "bookSourceUrl": "https://api.novel.com",
  "bookSourceType": 0,
  "searchUrl": "/api/search?keyword={{java.encodeURI(key)}}&page={{page}}",
  "ruleSearch": {
    "bookList": "@json:$.data.books[*]",
    "name": "@json:$.name",
    "author": "@json:$.author",
    "coverUrl": "@json:$.cover",
    "bookUrl": "@json:$.url",
    "intro": "@json:$.description",
    "kind": "@json:$.category",
    "lastChapter": "@json:$.last_chapter",
    "wordCount": "@json:$.word_count"
  },
  "ruleBookInfo": {
    "name": "@json:$.book.name",
    "author": "@json:$.book.author",
    "coverUrl": "@json:$.book.cover",
    "intro": "@json:$.book.description",
    "kind": "@json:$.book.category",
    "lastChapter": "@json:$.book.last_chapter",
    "wordCount": "@json:$.book.word_count",
    "tocUrl": "@json:$.book.toc_url"
  },
  "ruleToc": {
    "chapterList": "@json:$.chapters[*]",
    "chapterName": "@json:$.title",
    "chapterUrl": "@json:$.url",
    "nextTocUrl": "@json:$.next_page"
  },
  "ruleContent": {
    "content": "@json:$.content"
  },
  "header": "{\"Content-Type\": \"application/json\"}"
}
```

## 需要登录的书源

### 示例4：需要Cookie的书源

```json
{
  "bookSourceName": "需要登录的书源",
  "bookSourceUrl": "https://member.novel.com",
  "bookSourceType": 0,
  "loginUrl": "https://member.novel.com/login",
  "searchUrl": "/api/search?q={{key}}",
  "ruleSearch": {
    "bookList": "@json:$.data",
    "name": "@json:$.title",
    "author": "@json:$.author",
    "bookUrl": "@json:$.id@js:'/book/'+result"
  },
  "ruleBookInfo": {
    "name": "@json:$.book.title",
    "author": "@json:$.book.author",
    "tocUrl": "@json:$.book.toc_url"
  },
  "ruleToc": {
    "chapterList": "@json:$.chapters",
    "chapterName": "@json:$.title",
    "chapterUrl": "@json:$.url@js:result+',{\"headers\":{\"Cookie\":\"'+java.getCookie(baseUrl)+'\"}}'"
  },
  "ruleContent": {
    "content": "@json:$.content"
  },
  "header": "{\"Cookie\": \"{{java.getCookie(baseUrl)}}\"}"
}
```

## 有声书源

### 示例5：音频书源

```json
{
  "bookSourceName": "有声小说",
  "bookSourceUrl": "https://audio.novel.com",
  "bookSourceType": 1,
  "searchUrl": "/search?keyword={{key}}",
  "ruleSearch": {
    "bookList": "@css:.audio-item",
    "name": "@css:.audio-title@text",
    "author": "@css:.audio-author@text",
    "coverUrl": "@css:.audio-cover img@src",
    "bookUrl": "@css:.audio-link@href"
  },
  "ruleBookInfo": {
    "name": "@css:h1.audio-title@text",
    "author": "@css:.audio-author@text",
    "coverUrl": "@css:.audio-cover img@src",
    "intro": "@css:.audio-description@html",
    "tocUrl": "@css:.toc-link@href"
  },
  "ruleToc": {
    "chapterList": "@css:.chapter-list li",
    "chapterName": "@css:.chapter-title@text",
    "chapterUrl": "@css:.chapter-play@href##$##,{\"webView\":true}",
    "isVip": "@css:.vip-icon@js:result?true:false"
  },
  "ruleContent": {
    "content": "<js>result</js>",
    "sourceRegex": ".*\\.(mp3|m4a).*"
  }
}
```

## 漫画书源

### 示例6：漫画网站

```json
{
  "bookSourceName": "漫画源",
  "bookSourceUrl": "https://comic.example.com",
  "bookSourceType": 0,
  "searchUrl": "/search?q={{key}}",
  "ruleSearch": {
    "bookList": "@css:.comic-item",
    "name": "@css:.comic-title@text",
    "author": "@css:.comic-author@text",
    "coverUrl": "@css:.comic-cover img@src",
    "bookUrl": "@css:.comic-link@href",
    "intro": "@css:.comic-desc@text",
    "kind": "@css:.comic-tags@text"
  },
  "ruleBookInfo": {
    "name": "@css:h1.comic-title@text",
    "author": "@css:.comic-author@text",
    "coverUrl": "@css:.comic-cover img@src",
    "intro": "@css:.comic-description@html",
    "kind": "@css:.comic-tags@text",
    "tocUrl": "@css:.chapter-list-link@href"
  },
  "ruleToc": {
    "chapterList": "@css:.chapter-list li",
    "chapterName": "@css:.chapter-title@text",
    "chapterUrl": "@css:.chapter-link@href##$##,{\"webView\":true}"
  },
  "ruleContent": {
    "content": "@css:.comic-images img@src@js:'<img src=\"'+result+'\">'",
    "webJs": "loadAllImages();"
  }
}
```

## WebView书源

### 示例7：需要JavaScript渲染

```json
{
  "bookSourceName": "WebView示例",
  "bookSourceUrl": "https://spa.novel.com",
  "bookSourceType": 0,
  "searchUrl": "/search/{{key}}",
  "ruleSearch": {
    "bookList": "@css:.book-item",
    "name": "@css:.book-name@text",
    "author": "@css:.book-author@text",
    "bookUrl": "@css:.book-link@href##$##,{\"webView\":true}"
  },
  "ruleBookInfo": {
    "name": "@css:h1.book-title@text",
    "author": "@css:.book-author@text",
    "tocUrl": "@css:.toc-link@href##$##,{\"webView\":true}"
  },
  "ruleToc": {
    "chapterList": "@css:.chapter-item",
    "chapterName": "@css:.chapter-title@text",
    "chapterUrl": "@css:.chapter-link@href##$##,{\"webView\":true}"
  },
  "ruleContent": {
    "content": "@css:.chapter-content@html",
    "webJs": "document.querySelector('.ads').remove(); return document.querySelector('.content').innerHTML;"
  }
}
```

## 多规则组合书源

### 示例8：复杂规则组合

```json
{
  "bookSourceName": "复杂规则示例",
  "bookSourceUrl": "https://complex.example.com",
  "bookSourceType": 0,
  "searchUrl": "/search?q={{key}}&page={{page}}",
  "ruleSearch": {
    "bookList": "@css:.result-item",
    "name": "@css:.title@text||@css:h3@text",
    "author": "@css:.author@text&&@css:.writer@text",
    "coverUrl": "@css:.cover img@src##https?://##https://proxy.example.com/##",
    "bookUrl": "@css:.link@href@js:baseUrl + result",
    "intro": "@css:.desc@html##<[^>]+>## ##\\s+## ",
    "kind": "<js>var kind = result; return kind ? kind.split('/')[0] : '';</js>",
    "lastChapter": "@css:.latest@text##.*?：(.*)##$1###"
  },
  "ruleBookInfo": {
    "name": "@css:h1@text##《(.*)》##$1###",
    "author": "@css:.info .author@text||@css:.meta .author@text",
    "coverUrl": "@css:.cover img@src",
    "intro": "@css:.intro@html##<div class=\"ad\">.*?</div>##",
    "tocUrl": "@css:.toc@href||@css:.chapter-list@href",
    "canReName": "@put:{name:\"@css:.alt-name@text\"}"
  },
  "ruleToc": {
    "chapterList": "-@css:.chapter-list li",
    "chapterName": "@css:.chapter-title@text##第(\\d+)章##第$1章 ##",
    "chapterUrl": "@css:.chapter-link@href@js:result.indexOf('http') === 0 ? result : baseUrl + result",
    "isVip": "@css:.vip@js:result ? 'VIP' : ''",
    "updateTime": "@css:.time@text@js:java.timeFormat(result)",
    "nextTocUrl": "@css:.next-page@href@js:result ? [result] : []"
  },
  "ruleContent": {
    "content": "@css:.content@html##<script[^>]*>.*?</script>## ##<div class=\"advertisement\">.*?</div>## ##\\n{3,}##\\n\\n",
    "nextContentUrl": "@css:.next@href@js:result ? [result] : []",
    "webJs": "removeAds(); formatText();"
  },
  "header": "{\"User-Agent\": \"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\", \"Referer\": \"{{baseUrl}}\"}",
  "bookUrlPattern": "https?://complex\\.example\\.com/book/\\d+"
}
```

## 规则说明

### 常用规则语法

1. **Jsoup Default**: `tag.div.0@class.content@text`
2. **CSS选择器**: `@css:.book-list li a@text`
3. **XPath**: `@XPath://div[@class="content"]/text()`
4. **JSONPath**: `@json:$.data.books[*].name`
5. **JavaScript**: `<js>result.replace(/\\s+/g, ' ')</js>`
6. **正则AllInOne**: `:href=\"(/chapter/[^\"]*)\"[^>]*>([^<]*)</a>`
7. **正则净化**: `##<script[^>]*>.*?</script>##`
8. **正则OnlyOne**: `##.*?：(.*)##$1###`

### 连接符号

1. **||**: 取第一个有效值
   ```json
   "name": "@css:.title@text||@css:h3@text"
   ```

2. **&&**: 合并所有值
   ```json
   "author": "@css:.author@text&&@css:.writer@text"
   ```

3. **%%**: 交替取值
   ```json
   "chapters": "list1%%list2%%list3"
   ```

### 特殊用法

1. **列表倒序**: 在规则前加 `-`
   ```json
   "chapterList": "-@css:.chapter-list li"
   ```

2. **变量使用**: 使用 `{{}}`
   ```json
   "searchUrl": "/search?q={{key}}&page={{page}}"
   ```

3. **JavaScript处理**:
   ```json
   "bookUrl": "@css:.link@href@js:baseUrl + result"
   ```

4. **正则替换**:
   ```json
   "coverUrl": "@css:.cover img@src##http://##https://##"
   ```

## 调试技巧

1. **逐步测试**: 先测试搜索，再测试详情，最后测试正文
2. **使用日志**: 在JavaScript中添加 `java.log()` 调试
3. **错误处理**: 使用try-catch处理异常
4. **备选规则**: 使用 `||` 提供备选方案

## 常见问题

1. **编码问题**: 添加 `"charset": "gbk"` 到URL选项
2. **登录问题**: 配置 `loginUrl` 和 `header`
3. **动态内容**: 使用 `"webView": true`
4. **反爬虫**: 添加合适的请求头

这些示例涵盖了大多数常见场景，可以根据实际网站结构进行调整。