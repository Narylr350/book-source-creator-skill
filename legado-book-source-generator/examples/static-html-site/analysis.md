# 网站分析

## 搜索

- 页面入口或触发方式: GET https://static-example.com/search?q={{key}}
- 请求链路或接口来源: 直接HTTP GET请求
- 稳定抓取依据: 返回完整HTML，结果列表在 `.book-list .book-item` 下
- 风险点: 无
- Legado 规则建议: bookList=`.book-list .book-item`, name=`.book-title`, bookUrl=`a@href`

## 详情

- 页面入口或触发方式: GET https://static-example.com/book/{{bookId}}
- 请求链路或接口来源: 直接HTTP GET请求
- 稳定抓取依据: 返回完整HTML，元数据在 `.book-info` 下
- 风险点: 无
- Legado 规则建议: name=`.book-title`, author=`.book-author`, coverUrl=`.book-cover img@src`, intro=`.book-intro`

## 目录

- 页面入口或触发方式: GET https://static-example.com/book/{{bookId}}/chapters
- 请求链路或接口来源: 直接HTTP GET请求
- 稳定抓取依据: 返回完整HTML，章节列表在 `.chapter-list li a` 下
- 风险点: 无
- Legado 规则建议: chapterList=`.chapter-list li a`, chapterName=`text`, chapterUrl=`@href`

## 正文

- 页面入口或触发方式: GET https://static-example.com/chapter/{{chapterId}}
- 请求链路或接口来源: 直接HTTP GET请求
- 稳定抓取依据: 返回完整HTML，正文内容在 `.content` 下
- 风险点: 无
- Legado 规则建议: content=`.content`
