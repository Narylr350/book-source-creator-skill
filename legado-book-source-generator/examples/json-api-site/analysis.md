# 网站分析

## 搜索

- 页面入口或触发方式: GET /api/search?q={{key}}&page={{page}}
- 请求链路或接口来源: REST API，返回JSON
- 稳定抓取依据: 响应结构固定，结果在 `data.list` 数组中
- 风险点: 无
- Legado 规则建议: bookList=`$.data.list[*]`, name=`$.title`, bookUrl=`$.id` (需拼接完整URL)

## 详情

- 页面入口或触发方式: GET /api/book/{{bookId}}
- 请求链路或接口来源: REST API，返回JSON
- 稳定抓取依据: 响应结构固定，元数据在 `data` 对象中
- 风险点: 无
- Legado 规则建议: name=`$.data.title`, author=`$.data.author`, coverUrl=`$.data.cover`, intro=`$.data.intro`

## 目录

- 页面入口或触发方式: GET /api/book/{{bookId}}/chapters
- 请求链路或接口来源: REST API，返回JSON
- 稳定抓取依据: 响应结构固定，章节在 `data.chapters` 数组中
- 风险点: 无
- Legado 规则建议: chapterList=`$.data.chapters[*]`, chapterName=`$.title`, chapterUrl=`$.id` (需拼接完整URL)

## 正文

- 页面入口或触发方式: GET /api/chapter/{{chapterId}}
- 请求链路或接口来源: REST API，返回JSON
- 稳定抓取依据: 响应结构固定，正文在 `data.content` 字段中
- 风险点: 无
- Legado 规则建议: content=`$.data.content`
