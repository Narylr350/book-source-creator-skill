# 阅读官方规则摘录

本文件根据阅读官方教程 [书源规则：从入门到入土](https://mgz0227.github.io/The-tutorial-of-Legado/Rule/source.html) 提炼，只保留对生产书源最关键、最容易误判的规则点。

使用原则：

- 生成书源时，先以官方规则行为为主，再结合目标站实测决定字段和回退方案。
- 模式矩阵和样例只负责帮助判断“该走哪种实现”，不能覆盖官方规则定义。
- 若官方规则与经验写法冲突，以官方规则为准。

## 1. URL 规则与请求选项

官方教程明确支持在 URL 后拼接 JSON 选项对象。

常见形式：

```text
https://example.com,{"charset":"gbk","headers":{"User-Agent":"..."}} 
https://example.com,{"headers":{"User-Agent":"..."},"webView":true}
```

关键点：

- `webView` 是官方支持的正常能力，不是异常兜底语法。
- `webView` 非空时，阅读会改用 WebView 加载。
- `headers`、`charset`、`body` 等都属于请求选项的一部分。

## 2. `JSON.stringify()` 的约束

官方教程特别强调：

- 用 `JSON.stringify()` 生成请求选项时，JSON 对象里的 value 必须是 JavaScript 的 `String` 类型。
- 如果值是计算出来的，尽量用 `String()` 强转，再放进对象。

这条规则直接影响：

- 动态 header
- 动态 body
- 带 `webView` 的 URL 选项拼接

如果这里类型不对，书源看起来“语法没错”，实际会在阅读里失效。

## 3. 详情页预处理 `bookInfoInit`

官方教程对详情预处理给了很明确的边界：

- `bookInfoInit` 只能用 AllInOne 正则或 JS。
- AllInOne 正则必须以 `:` 开头。
- JS 返回值应该是一个 JSON 对象，然后在详情字段里按 key 去取。

这意味着：

- 如果详情页需要统一补字段、改 URL、提前算 `tocUrl`，优先考虑 `bookInfoInit`
- 但不要把和详情无关的重网络逻辑塞进去

## 4. 目录规则重点

官方教程中目录部分最值得在生产里直接记住的是：

- `chapterList` 首字符使用负号 `-` 可以反序
- `chapterUrl` 直接决定正文入口
- `nextTocUrl` 支持单个 URL
- `nextTocUrl` 支持 URL 数组
- 若 JS 返回 `[]`、`null` 或 `""`，表示停止继续加载下一页

这意味着：

- 目录分页不一定要硬拼单个下一页
- 当站点存在多分支目录链路时，可以显式返回数组
- 停止条件必须明确，避免目录死循环

## 5. 正文规则重点

正文部分官方教程给出的直接生产提示有三条：

### `content`

- 正文图片链接可以附带请求头
- 可通过拼接 `src + "," + JSON.stringify(options)` 的形式给图片单独带 header

### `book` / `chapter` 对象

在 JS 或 `{{}}` 中可以直接使用：

- `book.name`
- `book.author`
- `book.bookUrl`
- `book.tocUrl`
- `chapter.url`
- `chapter.title`
- `chapter.baseUrl`
- `chapter.index`

这适合做：

- 净化章节名拼接噪声
- 用当前书籍/章节上下文修正文案
- 相对链接补全

### `WebView`

官方教程原文直接提到：`{"webView":true}` 很方便。

生产上的含义是：

- 当章节页直连不稳定，但页面最终在浏览器或 WebView 中能稳定渲染时，`WebView` 应被优先视为正式候选方案
- 不要在还没评估 `WebView` 的情况下，直接跳到重型 JS 解密、签名复刻或 `不建议生成`

## 6. 变量读写

官方教程区分了两组变量接口：

- `@put` / `@get`
- `java.put` / `java.get`

边界：

- `@put` / `@get` 只能用于 JS 以外的规则
- `java.put` / `java.get` 只能用于 JS 中

如果混用，规则往往不会按预期生效。

## 7. 调试能力

官方教程明确建议善用阅读内置调试：

- 调试搜索
- 调试详情页
- 调试目录页
- 调试正文页

这对 skill 的约束是：

- 书源失效后的调试协作，应围绕阅读内置调试入口设计
- 让用户提供阶段性源码，比笼统描述“打不开”更有价值

## 8. 直接指导生成时的决策

基于官方规则，生成阶段优先按下面顺序判断：

1. 是否需要先让用户选择登录分析还是不登录分析
2. 是否能用稳定 API / JSON 直接完成
3. 是否能用稳定 HTML 直接完成
4. 是否应优先切到 `WebView`
5. 是否确实需要更重的 JS、解密或签名复刻

只要第 4 步还没被排除，就不应轻易给出 `不建议生成`。
