---
name: legado-book-source-generator
description: Use when 用户要求为任意网站生成书源、生成阅读书源、分析小说站点、生成 Legado/阅读规则。强制触发词：书源、生成书源、帮我生成、book source、legado、阅读书源、小说站点分析。如果用户给出了一个 URL 并要求生成或分析，必须加载此 skill。
---

# Legado 书源生成

拿到 URL 后运行 init。之后默认只运行 run。

```bash
node "<skill-dir>/scripts/bsg.mjs" init <url> [--cwd <输出目录>]
node "<skill-dir>/scripts/bsg.mjs" run --run <run-dir>
```

`run` 返回什么就做什么：

- `readNext`：先读这些文件。
- `writeTarget`：只写这个目标文件，写完继续 `run`。
- `nextCommand`：只执行这个命令，完成后继续 `run`。
- `requiredUserAction`：停止自动操作，等用户确认后再 `resolve-user-action`。
- `correctiveAction`：按它修，不要猜，不要重试同一命令。

## 三条硬规则

**1. `run-state.json` 由命令写入，禁止手动编辑。**

**2. validate 阶段禁止修改 `book-source.json`。** 要改规则必须先回 generate 阶段。状态机检测到 hash 变化会自动回退，`correctiveAction` 会告诉你下一步。

**3. `requiredUserAction` 非 null 时停止自动操作，等用户确认后再运行 `resolve-user-action`。**

## 红旗

出现以下想法时停止自动发挥，读命令返回的 `correctiveAction` / `requiredUserAction`：

- “某条必需链路失败，所以用未验证的替代入口继续。”
- “为了判断 SSR/CSR，先用浏览器 evaluate / JS 自动探测搜索页或登录页。”
- “JS/浏览器探测后出现验证码，所以直接断言站点天然验证码。”
- “桌面浏览器或 HTTP 能看到内容，所以 Android WebView / 阅读 App 一定可用。”
- “Android 真机或模拟器可用，但先用 HTTP 验证交付。”
- “Android 设备在线或已确认 ready，所以 Android 入口复核已经完成。”
- “mode=android 跑过，即使 probe_unavailable，也算 Android Probe 证据。”
- “validate 阶段发现问题，直接改 book-source.json。”
- “规则错误或验证器缺证据可以标 needs_app_review / validator_limitation 通过。”

这些情况必须由脚本门禁或用户确认解除，不能靠经验跳过。

## 专家命令

`advance`、`record-assessment`、`validate`、`record-validation`、`deliver`、`login` 等命令仍可用于调试，但主流程优先使用 `run`。除非 `run.nextCommand` 明确要求，不要自行组合这些命令。

## 输出

- `outputs/<site-slug>/book-source.json` — 唯一交付物
- `runs/<site-slug>/` — 过程记录

deliver 完成后必须运行 `validator-stop` 关闭 validator。
