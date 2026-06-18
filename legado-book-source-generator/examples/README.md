# 样例目录

本目录存放书源样例，包括真实站点闭环样例和按模式分类的教学模板。

## 当前样例

**真实站点：**
- `163zw/`: 163中文网完整闭环（评估+分析+书源+验收）
- `69shuba-com/`: 69书吧冒烟测试样例（POST搜索、目录嵌详情页、纯静态HTML）

**模式模板：**
- `static-html-site/`: 静态HTML（纯CSS选择器提取）
- `json-api-site/`: JSON API（REST接口，JSONPath提取）
- `webview-fallback-site/`: WebView回退（正文需WebView渲染）
- `login-required-site/`: 需登录站点（loginUrl + enabledCookieJar）

## 使用规则

- 样例用于说明交付结构与规则组织方式。
- 真实站点样例不构成对目标站点长期可用性的保证。
- 模式模板使用虚构域名，仅演示规则写法，不可直接导入使用。
- 样例不替代目标站点的 Browser MCP 实测。
- 当目标站点因为签名、加密、CSR 空壳或浏览器渲染而接近被判成 `不建议生成` 时，必须先回看样例与 `references/reference-source-patterns.md`，确认是否存在可复用的 fallback 模式。

## 样例分类说明

| 样例 | 类型 | 复杂度 | 关键特征 |
|------|------|--------|----------|
| 163zw | 真实闭环 | 中 | 完整评估+分析+书源+验收，CSS选择器+JS内容处理 |
| 69shuba-com | 真实站点 | 低 | POST搜索、目录嵌详情页、纯静态HTML |
| static-html-site | 模板 | 低 | CSS选择器直接提取 |
| json-api-site | 模板 | 低 | REST接口，JSONPath提取 |
| webview-fallback-site | 模板 | 中 | 正文需WebView，chapterUrl用##\$##拼接选项 |
| login-required-site | 模板 | 中 | loginUrl + enabledCookieJar + header |
