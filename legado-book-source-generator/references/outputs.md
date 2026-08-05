# 交付物格式

## 目录结构

```
outputs/<site-slug>/
  book-source.json          # 唯一默认用户交付物

runs/<site-slug>/
  assessment.md             # 可生成性评估（AUTO 结论 + AI 证据说明）
  site-facts.json           # Browser MCP 站点观察与 assessment 机器事实
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

## 当前工具箱入口

```powershell
# 创建 runs/<site-slug>/ 和 outputs/<site-slug>/book-source.json
node "<skill-dir>/scripts/bsg.mjs" init https://example.com --cwd .

# 查看当前状态、待人工动作和下一步
node "<skill-dir>/scripts/bsg.mjs" status --run .\runs\example-com

# 生成 book-source.json 后，让 run 写入 rule-check.json
node "<skill-dir>/scripts/bsg.mjs" run --run .\runs\example-com

# 真实链路验证（需 validator 运行中）
node "<skill-dir>/scripts/bsg.mjs" validate --run .\runs\example-com --mode http

# 将 validator-report.json 收敛为最终状态、能力矩阵和修复上下文
node "<skill-dir>/scripts/bsg.mjs" record-validation --run .\runs\example-com --status <validator-report.status>

# 最终交付审计
node "<skill-dir>/scripts/bsg.mjs" deliver --run .\runs\example-com
```

旧的 `project-helper.mjs` / `audit-source.mjs` 独立 CLI 已退役；不要用旧脚本创建输出、验证 JSON 或判断可用性。
`bsg.mjs validate` 自动读取 book-source.json、分析关键词、检测 adb 设备决定 mode，并把结果写入 run 目录下的 `validator-report.json`。不要手写或复制旧报告。
