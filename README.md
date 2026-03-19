# book-source-creator-skill

仓库地址：`https://github.com/Narylr350/book-source-creator-skill`

这是一个用于为 Legado 阅读器创建、调试和验证书源的技能仓库。仓库根目录用于说明如何使用，真正的技能包放在 [`book-source-creator/`](./book-source-creator/) 目录里，这样不会和技能本身的 `README.md` 冲突。

这个 skill 已在 Codex 环境中测试成功。其他 AI 工具目前没有系统测试过，所以不承诺在其他工具里能直接得到同样结果。

## 需要什么

- 一个支持技能机制的 Codex 环境
- 可用的浏览器分析能力，核心依赖是 Browser MCP
- 目标小说网站 URL
- 如果站点需要登录，需要能由人类协助完成登录
- 如果要运行辅助脚本，建议有 Node.js；只看技能文档则不强依赖本地脚本
- 一个用于最终导入验证的 Legado 阅读器

## 仓库结构

```text
book-source-creator-skill/
  README.md                     # 仓库级使用说明
  book-source-creator/          # 技能本体
    SKILL.md
    README.md
    scripts/
    references/
    tests/
```

技能详细说明见 [`book-source-creator/README.md`](./book-source-creator/README.md)，技能入口说明见 [`book-source-creator/SKILL.md`](./book-source-creator/SKILL.md)。

## 如何使用

把 [`book-source-creator/`](./book-source-creator/) 整个目录放到你的技能目录中即可。

常见做法示例：

```text
~/.cc-switch/skills/book-source-creator/
~/.codex/skills/book-source-creator/
```

安装后，在需要为 Legado 阅读器创建、调试或验证书源时调用这个 skill。

## 标准流程

这个 skill 的推荐流程是：

1. 先判断目标站点是否需要登录。
2. 如果需要登录，优先在登录态下分析；如果登录需要扫码、验证码、短信或人工确认，应立即请求人类协助。
3. 在写任何规则前，先输出一份“网站可生成性评估”。
4. 再使用 Browser MCP 分析搜索、详情、目录、正文四段链路。
5. 根据真实页面结构和请求链路生成书源。
6. 用辅助脚本做结构校验和规则审计。
7. 最后导入 Legado 做实际可用性验证。

## 网站可生成性评估模板

在正式写规则前，建议先输出：

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

允许使用的评级：

- `可直接生成`
- `可生成但高风险`
- `需登录后再评估`
- `不建议生成`

其中 `需登录后再评估` 和 `不建议生成` 不是硬阻断，但如果继续做，必须明确标记为 `高风险` 并说明理由。

## 示例

### 示例 1：输入

```text
请为 https://www.163zw.com/ 创建一个 Legado 书源，并验证搜索、详情、目录和正文。
```

### 示例 2：期望执行过程

```text
1. 判断是否需要登录
2. 输出网站可生成性评估
3. 用 Browser MCP 验证搜索入口和结果列表
4. 进入详情页，确认书名、作者、简介、封面、目录入口
5. 进入目录，确认是否分页
6. 进入正文，确认是否多页、是否有广告、是否需要拼接
7. 生成书源 JSON
8. 做结构校验和规则审计
9. 导入 Legado 实测
```

### 示例 3：163中文网实测结论

这个仓库对应的 skill 已经实际用于 `163中文网` 书源生成与验证：

- 搜索、详情、目录、正文链路都已通过 Browser MCP 实测
- 目录存在分页，已纳入规则设计
- 正文存在单章多页，已纳入规则设计
- 在当前测试样本下，`163中文网` 书源未发现明显问题

这里的“未发现问题”是指在 Codex + Browser MCP + Legado 导入验证这一轮里没有发现明显故障，不代表站点未来不会改版。

## 脚本说明

技能附带的脚本在 [`book-source-creator/scripts/`](./book-source-creator/scripts/)：

- `analyze_with_playwright.mjs`：辅助分析真实页面
- `validate_source.mjs`：校验书源 JSON 结构
- `test_rules.mjs`：审计规则风险和占位问题
- `generate_template.mjs`：生成模板

同名 `.py` 文件是兼容入口，会转调到对应的 `.mjs` 脚本。

脚本是辅助工具，不是判断中心。如果脚本结果和真实页面表现冲突，应以 Browser MCP 看到的真实页面和请求证据为准。

## 测试状态

已验证：

- Codex 环境下可正常使用这个 skill
- Browser MCP 驱动的网站分析流程可跑通
- Node 版本辅助脚本可运行
- `163中文网` 的样例书源已经过一轮实际验证，当前未见明显问题

未验证：

- 其他 AI 工具中的兼容性
- 所有小说站点的通用成功率
- 所有登录态站点的行为一致性
