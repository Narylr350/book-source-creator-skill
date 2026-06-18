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

### URL 模板：JS 块 vs JSONPath

**JS 块 `{{ }}`**：块内的 JS 代码先执行，产生 URL 字符串，然后 `,{"webView":true}` 等选项放在块**外部**。阅读的 `AnalyzeUrl` 会在 JS 块执行后把 URL 和 options 分开解析。

```json
"chapterUrl": "{{var m = baseUrl.match(/novels\\/(\\d+)/); '/reader?novel=' + m[1] + '&chapter=' + result.id}},{\"webView\":true}"
```

**JSONPath `{{$.field}}`**：整个字符串是 URL 模板，`{{$.field}}` 被 JSONPath 替换为字段值。`,` 后面的内容被视为 URL 的一部分，**不会被解析为 options**。validator 现已自动清洗 probe 请求中残留的 options 文本（v0.4.1+），但如果你看到章节 URL 末尾带 `,{"webView":true}`，这是 JSONPath 模板的正常行为——不影响 Legado App 内使用（App 的 AnalyzeUrl 会正确剥离）。

**结论**：优先使用 JSONPath 模板（更简洁），`{"webView":true}` 可以直接放在 URL 模板末尾。validator/probe 会自动处理清洗。

### `@css:` 规则中的 `@action` 链式限制

**平台限制**（Legado 源码行为）：`@css:` 模式下，`getStringList` 使用 `lastIndexOf('@')` 取最后一个 `@` 作为 action 边界。这意味着：

- ✅ `@css:selector@text` — 单 action，正常工作
- ✅ `@css:selector@href` — 单 action，正常工作  
- ❌ `@css:selector@href@js:...` — 多 action 链，**取最后一个 `@js:` 为 action，前面的 `@href` 被错误当成 CSS 选择器**，导致 Jsoup 解析失败（`SelectorParseException`）

**绕行方案**：用 `##$##` 或 `<js>` 替代 `@js:` 链式 action：

```text
# 不兼容：
@css:dt a@href@js:result.indexOf('http') === 0 ? result : 'https://example.com' + result

# 兼容写法（非 @css: 模式，用 class/tag @ 链 + ##$##<js>）：
class.item@tag.dt@tag.a@href##$##<js>result.indexOf('http') === 0 ? result : 'https://example.com' + result</js>
```

这是 Legado 源码本身的解析器限制，不是 validator 独有的 bug。

### result 变量在 JS 上下文中的差异

在 `<js>` 块中，`result` 的类型取决于上下文：
- **chapterName JS**：`result` 是解析后的 JSON 对象，支持 `result.chapterNumber`、`result.title` 等字段访问（Legado App 行为）
- **validator 的 chapterName JS**：`result` 是**字符串**（未解析的 JSON 文本），点号字段访问返回 `undefined`
- **chapterUrl JS**：`result` 也是字符串，`result.id` 返回 `undefined`

**推荐**：在 validator 兼容的规则中，优先使用 JSONPath（如 `$.title`、`$.id`、`$.novelId`）替代 JS 模板中的 `result.field`。JSONPath 在 validator 和 Legado App 两端行为一致。

### Jsoup 选择器限制

Legado 底层使用 Jsoup 解析 HTML，只支持标准 CSS 选择器。以下 **jQuery 扩展选择器在 Legado 中无效**：

| ❌ 无效（jQuery） | ✅ 替代（标准 CSS / Jsoup） |
|-------------------|---------------------------|
| `:contains('文本')` | 用 `@text` action：`.class@text##^文本` 或在 `<js>` 中 `result.includes('文本')` |
| `:has(selector)` | 反向写：`selector` 先定位，再 `.parent()` 或用 parent selector `> ` |
| `:first` / `:last` | `:first-child` / `:last-child` / `:nth-child(1)` / `:nth-last-child(1)` |
| `:eq(n)` | `:nth-child(n+1)` |
| `:text` | `@text` action |
| `:input` | `input, select, textarea, button` |
| `:visible` / `:hidden` | 无法直接替代，在 `<js>` 中用 `element.style.display` 判断 |

**注意**：Legado 的 `ruleSearch.bookList` / `ruleBookInfo` / `ruleToc.chapterList` / `ruleContent.content` 中的 CSS 选择器都走 Jsoup，受到以上限制。只有 `<js>` 块中的 `document.querySelector()` 可以用浏览器完整 CSS。

### POST 搜索语法

Legado 的 POST 搜索用 URL options，不是 PHP 风格的参数拼接：

```json
// ✅ 正确：URL + JSON options
"searchUrl": "https://example.com/search.php,{\"body\":\"searchkey={{key}}\",\"method\":\"POST\"}"

// ❌ 错误：不是 ;post= 也不是 form data 拼接
"searchUrl": "https://example.com/search.php;post=searchkey={{key}}"
```

### WebView 的适用边界

`webView:true` 解决的是 **CSR 页面渲染**——前端框架（Nuxt/Vue/React）生成的空壳 HTML 需要 JS 执行后才能提取正文。**WebView 不能绕过 Cloudflare Turnstile、验证码或 IP 封禁**。遇到反爬导致的 403/503，应尝试换 UA header、降低请求频率或换镜像站。

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
- `tocUrl` **只支持单个 URL**（不能像 `nextTocUrl` 那样用数组）
- `nextTocUrl` 支持单个 URL 或 URL 数组
- 若 JS 返回 `[]`、`null` 或 `""`，表示停止继续加载下一页

这意味着：

- 目录分页不一定要硬拼单个下一页
- 当站点存在多分支目录链路时，可以显式返回数组
- 停止条件必须明确，避免目录死循环
- `tocUrl` 不能使用数组，多来源目录需在详情页预处理中合并

## 5. 正文规则重点

正文部分官方教程给出的直接生产提示有三条：

### `content`

- 正文图片链接可以附带请求头
- 可通过拼接 `src + "," + JSON.stringify(options)` 的形式给图片单独带 header

### `nextContentUrl`

- 正文分页规则（同章内容跨多页）
- 支持单个 URL 或 URL 数组
- 返回 `[]`、`null` 或 `""` 表示没有下一页
- **注意与目录跳章区分**：`nextContentUrl` 是同章翻页，目录 `chapterUrl` 是跳到下一章。两者混用会导致章节错乱

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

**在规则表达式中附加 `,{"webView":true}` 的正确写法：**

官方教程特别指出：不要在 CSS/XPath/JSONPath 规则表达式中直接拼接。正确写法是通过 `##$##` 或 `@js:` 在规则结果后追加：

```text
# 错误：
tag.a@href,{\"webView\":true}

# 正确写法1：用 ##$## 在结果后追加
tag.a@href##$##,{\"webView\":true}

# 正确写法2：用 @js: 拼接
tag.a@href@js:result+',{\"webView\":true}'
```

在 `chapterUrl` 的 URL 模板中（如 `/book/{{$.novelId}}/{{$.id}},{\"webView\":true}`），直接放在模板末尾是合法的——因为这不是规则表达式，而是 URL 模板字符串。

### `webJs` 返回值约束

**官方硬约束：`webJs` 必须有返回值（不为空）。** 如果 `webJs` 返回空字符串，Legado 会进入无限重试循环直到超时。返回的字符串会被用作后续 `content` 规则处理的输入。

这意味着：
- `webJs` 中必须有明确的 `return` 或最后一行是表达式值
- 必须确保目标 DOM 元素存在后再返回内容（加 `while` + `java.sleep` 重试循环）
- 不能假设页面加载完成时内容就已经渲染好（CSR 页面需要额外等待）

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
