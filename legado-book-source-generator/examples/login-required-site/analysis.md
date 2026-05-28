# 网站分析

## 搜索

- 页面入口或触发方式: GET https://login-example.com/search?q={{key}}
- 请求链路或接口来源: 直接HTTP GET请求，需携带登录Cookie
- 稳定抓取依据: 登录后返回完整HTML，结果列表在 `.search-list .book-item` 下
- 风险点: 未登录时返回403或跳转登录页
- Legado 规则建议: bookList=`.search-list .book-item`, name=`.book-title`, bookUrl=`a@href`

## 详情

- 页面入口或触发方式: GET https://login-example.com/book/{{bookId}}
- 请求链路或接口来源: 直接HTTP GET请求，需携带登录Cookie
- 稳定抓取依据: 登录后返回完整HTML，元数据在 `.book-info` 下
- 风险点: 未登录时返回403或跳转登录页
- Legado 规则建议: name=`.book-title`, author=`.book-author`, coverUrl=`.book-cover img@src`, intro=`.book-desc`

## 目录

- 页面入口或触发方式: GET https://login-example.com/book/{{bookId}}/catalog
- 请求链路或接口来源: 直接HTTP GET请求，需携带登录Cookie
- 稳定抓取依据: 登录后返回完整HTML，章节列表在 `.chapter-list a` 下
- 风险点: 未登录时返回403或跳转登录页
- Legado 规则建议: chapterList=`.chapter-list a`, chapterName=`text`, chapterUrl=`@href`

## 正文

- 页面入口或触发方式: GET https://login-example.com/chapter/{{chapterId}}
- 请求链路或接口来源: 直接HTTP GET请求，需携带登录Cookie
- 稳定抓取依据: 登录后返回完整HTML，正文内容在 `.chapter-content` 下
- 风险点: 未登录时返回403或跳转登录页
- Legado 规则建议: content=`.chapter-content`
