# Legado书源创建技能

用于为 Legado 阅读器创建、调试和验证书源。这个技能默认遵循三条原则：

- AI 对页面结构、接口链路和规则语义的判断优先于脚本输出
- 网站可登录时，优先在登录态下分析
- 登录需要扫码、验证码、短信或人工确认时，应立即请求人类协助
- 正式生成书源前，必须先做网站可生成性评估

## 可生成性评估

在写规则前，先输出一份站点评估。评级只允许使用以下四类：

- `可直接生成`
- `可生成但高风险`
- `需登录后再评估`
- `不建议生成`

如果评级为 `需登录后再评估` 或 `不建议生成`，仍然允许继续，但必须明确标成 `高风险`，并说明继续生成的理由。

推荐输出模板：

```markdown
## 网站可生成性评估
- 目标站点：
- 登录状态：
- 搜索可用性：
- 详情可用性：
- 目录可用性：
- 正文可用性：
- 特殊风险：
- 可生成性评级：
- 是否继续生成：
- 继续生成理由 / 停止理由：
```

## 脚本现状

主脚本现在以 Node 为主：

- `scripts/analyze_with_playwright.mjs`
- `scripts/validate_source.mjs`
- `scripts/test_rules.mjs`
- `scripts/generate_template.mjs`

同名 `.py` 文件保留为兼容入口，会自动转调到对应的 `.mjs` 脚本。

## 依赖

```bash
npm i playwright
```

如果只使用 `validate_source.mjs`、`test_rules.mjs` 或 `generate_template.mjs`，不需要额外依赖。

## 推荐用法

```bash
# 分析网站，支持人工登录后继续
node scripts/analyze_with_playwright.mjs https://novel-site.com --manual-login --save analysis.json

# 基于分析结果生成模板
node scripts/generate_template.mjs --analysis analysis.json

# 审计规则，不伪装成完整 Legado 解析器
node scripts/test_rules.mjs my_source.json --keyword 凡人修仙传

# 验证书源结构
node scripts/validate_source.mjs my_source.json
```

兼容旧命令：

```bash
python scripts/analyze_with_playwright.py https://novel-site.com --manual-login
python scripts/test_rules.py my_source.json
python scripts/validate_source.py my_source.json
```

推荐执行顺序：

1. 先判断是否需要登录
2. 输出网站可生成性评估
3. 再分析搜索、详情、目录、正文
4. 最后生成和验证书源

## 脚本说明

### `analyze_with_playwright.mjs`

- 打开真实浏览器分析页面
- 可通过 `--manual-login` 让人类先完成登录
- 记录登录相关元素、搜索入口、候选结果区块和部分网络请求
- 适合需要登录态、动态内容或接口观察的站点

### `validate_source.mjs`

- 验证必填字段
- 验证常见字段类型
- 检查基础规则组结构
- 输出错误和警告，适合做结构体检

### `test_rules.mjs`

- 审计规则是否仍是占位文案
- 标记 JS/正则类高风险字段
- 预览 `searchUrl` 变量替换结果
- 不声称能完整执行 Legado 规则

### `generate_template.mjs`

- 支持交互式生成模板
- 支持基于 `analysis.json` 生成模板
- 默认禁用发现功能
- 可填写登录 URL

## 调试建议

- 先看真实页面和真实请求，再看脚本输出
- 脚本失败时先判断是脚本问题、环境问题还是站点行为变化
- 如果脚本结论和页面真实表现冲突，应以页面和接口证据为准
- 登录前后页面结构不同的站点，必须分别检查搜索、详情、目录和正文
- 评估结论为 `需登录后再评估` 或 `不建议生成` 时，继续生成必须明确标记为高风险

## 测试

```bash
node --test tests/book_source_tools.test.mjs
```
