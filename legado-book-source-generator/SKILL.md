---
name: legado-book-source-generator
description: Use when 用户要求为任意网站生成书源、生成阅读书源、分析小说站点、生成 Legado/阅读规则。强制触发词：书源、生成书源、帮我生成、book source、legado、阅读书源、小说站点分析。如果用户给出了一个 URL 并要求生成或分析，必须加载此 skill。
---

# Legado 书源生成

拿到 URL 后，运行 init。此后只跟着 `nextAction` 走，不要自行判断下一步。

```bash
node "<skill-dir>/scripts/bsg.mjs" init <url> [--cwd <输出目录>]
```

每步完成后运行 `advance`。`nextAction` 告诉你下一步做什么，`readNext` 告诉你要读哪些文件。读完对应文件再执行。

出错时读响应里的 `correctiveAction` 字段和 stderr 的 `## 下一步` 段落，不要猜，不要重试同一命令。

## 三条硬规则

**1. `run-state.json` 由命令写入，禁止手动编辑。**

**2. validate 阶段禁止修改 `book-source.json`。** 要改规则必须先回 generate 阶段。状态机检测到 hash 变化会自动回退，`correctiveAction` 会告诉你下一步。

**3. `requiredUserAction` 非 null 时停止自动操作，等用户确认后再运行 `resolve-user-action`。**

## 红旗

出现以下想法时停止自动发挥，读命令返回的 `correctiveAction` / `requiredUserAction`：

- “搜索被验证码拦了，所以用排行榜/书库代替搜索。”
- “电脑端能看到正文，所以阅读 App 一定可用。”
- “adb/Probe 麻烦，先用 HTTP 验证。”
- “validate 阶段发现问题，直接改 book-source.json。”
- “规则错误可以标 needs_app_review / validator_limitation。”

这些情况必须由脚本门禁或用户确认解除，不能靠经验跳过。

## 输出

- `outputs/<site-slug>/book-source.json` — 唯一交付物
- `runs/<site-slug>/` — 过程记录

deliver 完成后必须运行 `validator-stop` 关闭 validator。
