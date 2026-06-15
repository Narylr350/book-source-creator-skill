# 交付物格式

## 输出目录规则

**输出目录必须是用户任务工作目录，不写入 skill 安装目录。**

- 默认输出根目录：当前工作目录的 `outputs/` 和 `runs/`
- 如果用户明确指定输出目录：写到用户指定目录
- 如果当前目录是 skill 安装目录、`~/.claude/skills`、`~/.codex/skills`：禁止写入，必须切到用户工作目录或询问输出目录

**禁止出现：**
- `legado-book-source-generator/outputs/`
- `legado-book-source-generator/runs/`
- `~/.claude/skills/legado-book-source-generator/outputs/`
- `~/.codex/skills/legado-book-source-generator/outputs/`

## 目录结构

```
outputs/<site-slug>/
  book-source.json          # 唯一默认用户交付物

runs/<site-slug>/
  assessment.md             # 可生成性评估（过程记录）
  analysis.md               # 网站分析（过程记录）
  validation-checklist.md   # 验收清单（过程记录）
  validator-report.json     # validator 验证报告
  validator-summary.md      # validator 验证摘要
```

- `outputs/` 只放可交付内容，即 `book-source.json`。
- `runs/` 放 AI 生成过程、自检、分析记录，用于 AI 接力、故障回溯，不作为默认交付给用户的文件。

## book-source.json 要求

- 顶层使用 JSON 数组
- 单个书源也要用数组包裹：`[ { ... } ]`
- 交付前必须完成以下验证：
  1. `npm run validate` — JSON 结构校验
  2. `node scripts/validate-with-validator.mjs` — 真实链路验证（search→detail→toc→content）
- 只有 validator 报告 `status=passed` 才能标"可用"

## 可用脚本

```powershell
# 创建 outputs/<site-slug>/book-source.json
npm run scaffold -- .\outputs https://example.com

# 创建 runs/<site-slug>/ 过程文档
npm run scaffold-run -- .\runs https://example.com

# JSON 结构校验
npm run validate -- .\outputs\example-com\book-source.json

# 静态审计（不等于真实验证）
npm run audit -- .\outputs\example-com\book-source.json --keyword 凡人修仙 --page 1

# 真实链路验证（需 validator 运行中）
node scripts/validate-with-validator.mjs .\outputs\example-com\book-source.json 凡人修仙 http --output .\runs\example-com
```

`audit-source.mjs` 只做静态审计、占位检测、嵌入式 JS 语法检查和搜索 URL 预览，不能据此判断最终运行可用性。
`validate-with-validator.mjs` 调用 validator API 跑真实链路，输出 `validator-report.json`。
