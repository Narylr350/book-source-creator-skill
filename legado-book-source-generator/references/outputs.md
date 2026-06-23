# 交付物格式

## 目录结构

```
outputs/<site-slug>/
  book-source.json          # 唯一默认用户交付物

runs/<site-slug>/
  assessment.md             # 可生成性评估（AUTO 结论 + AI 证据说明）
  site-facts.json           # probe/assessment 阶段机器事实
  analysis.md               # 网站分析（过程记录）
  validation-checklist.md   # 验收清单（过程记录）
  validator-report.json     # validator 验证报告
  capability-matrix.json    # record-validation 归一化链路能力矩阵
  rule-check.json           # official-rule-pack 静态规则审计结果
  lesson-check.json         # examples lesson 检查问题与回答
  validator-summary.md      # validator 验证摘要
```

- `outputs/` 只放可交付内容，即 `book-source.json`。
- `runs/` 放 AI 生成过程、自检、机器事实、分析记录，用于 AI 接力、故障回溯。
- 输出目录和文件完整性由 `bsg.mjs init` 创建、`bsg.mjs check` 验证。

## book-source.json 要求

- 顶层使用 JSON 数组
- 单个书源也要用数组包裹：`[ { ... } ]`
- 可选字段要么填有效值，要么删除，不得保留 `""`

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
node "<skill-dir>/scripts/bsg.mjs" validate --run .\runs\example-com --mode http
```

`audit-source.mjs` 只做静态审计、占位检测、嵌入式 JS 语法检查和搜索 URL 预览，不能据此判断最终运行可用性。
`bsg.mjs validate` 自动读取 book-source.json、分析关键词、检测 adb 设备决定 mode，并把结果写入 run 目录下的 `validator-report.json`。不要手写或复制旧报告。
