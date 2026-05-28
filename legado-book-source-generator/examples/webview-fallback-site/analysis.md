# 网站分析

## 搜索

- 页面入口或触发方式: GET https://webview-example.com/search?q={{key}}
- 请求链路或接口来源: 直接HTTP GET请求
- 稳定抓取依据: 返回完整HTML，结果列表在 `.search-results .book-item` 下
- 风险点: 无
- Legado 规则建议: bookList=`.search-results .book-item`, name=`.book-title`, bookUrl=`a@href`

## 详情

- 页面入口或触发方式: GET https://webview-example.com/book/{{bookId}}
- 请求链路或接口来源: 直接HTTP GET请求
- 稳定抓取依据: 返回完整HTML，元数据在 `.book-detail` 下
- 风险点: 无
- Legado 规则建议: name=`.book-title`, author=`.book-author`, coverUrl=`.book-cover img@src`, intro=`.book-desc`

## 目录

- 页面入口或触发方式: GET https://webview-example.com/book/{{bookId}}/catalog
- 请求链路或接口来源: 直接HTTP GET请求
- 稳定抓取依据: 返回完整HTML，章节列表在 `.chapter-list a` 下
- 风险点: 无
- Legado 规则建议: chapterList=`.chapter-list a`, chapterName=`text`, chapterUrl=`@href`

## 正文

- 页面入口或触发方式: GET https://webview-example.com/chapter/{{chapterId}}
- 请求链路或接口来源: 直连接口失败（签名验证），WebView渲染成功
- 稳定抓取依据: Browser MCP实测WebView可稳定渲染正文，内容在 `.chapter-content` 下
- 风险点: 签名验证可能更新，WebView渲染可能因站点改版失效
- Legado 规则建议: 使用WebView模式，content=`.chapter-content`，添加 `{"webView": true}` 标记
