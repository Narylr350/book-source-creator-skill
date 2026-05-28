# 网站分析

## 搜索

- 页面入口或触发方式: POST https://www.69shuba.com/modules/article/search.php，表单提交 searchkey=关键词
- 请求链路或接口来源: 表单POST，返回完整HTML
- 稳定抓取依据: 搜索结果以列表形式展示，每条结果包含书名、作者、分类、状态、简介、最近章节
- 风险点: 无
- Legado 规则建议: searchUrl 用 POST，bookList 提取搜索结果列表项，name 提取书名链接，bookUrl 提取详情页链接

## 详情

- 页面入口或触发方式: GET https://www.69shuba.com/book/{id}.htm
- 请求链路或接口来源: 直接HTTP GET请求
- 稳定抓取依据: 返回完整HTML，包含书名(h1)、作者、分类、字数、状态、封面图、标签、目录列表
- 风险点: 无
- Legado 规则建议: name 提取 h1 书名，author 提取"作者："后的链接，coverUrl 提取封面图 src，intro 从简介tab提取

## 目录

- 页面入口或触发方式: 嵌在详情页 https://www.69shuba.com/book/{id}.htm 中
- 请求链路或接口来源: 与详情页同页，无需额外请求
- 稳定抓取依据: 章节列表以 ul > li > a 形式展示，每条包含章节名和日期
- 风险点: 无
- Legado 规则建议: tocUrl 留空（目录嵌在详情页），chapterList 提取章节链接列表，chapterName 提取链接文本，chapterUrl 提取链接 href

## 正文

- 页面入口或触发方式: GET https://www.69shuba.com/txt/{bookId}/{chapterId}
- 请求链路或接口来源: 直接HTTP GET请求
- 稳定抓取依据: 返回完整HTML，正文内容在页面内容区域，为纯文本段落
- 风险点: 无
- Legado 规则建议: content 提取正文内容区域的文本
