# 交付物格式

## 输出目录

统一写到 `outputs/<site-slug>/`：

- `assessment.md`
- `analysis.md`
- `book-source.json`
- `validation-checklist.md`

## book-source.json 要求

- 顶层使用 JSON 数组
- 单个书源也要用数组包裹：`[ { ... } ]`
- 交付前至少运行一次 `validate-source`

## 可用脚本

```powershell
# 脚手架生成
npm run scaffold -- .\outputs https://example.com

# 校验 JSON
npm run validate -- .\outputs\example-com\book-source.json

# 静态审计
npm run audit -- .\outputs\example-com\book-source.json --keyword 凡人修仙 --page 1
```

`audit-source.mjs` 只做静态审计、占位检测、嵌入式 JS 语法检查和搜索 URL 预览，不能据此判断最终运行可用性。
