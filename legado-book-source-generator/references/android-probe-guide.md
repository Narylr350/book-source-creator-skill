# Android Probe 指南

本文件在 `nextAction: android_check` 或 assess 阶段检测到 CSR/WebView 需求时由 `readNext` 加载。

## 何时必须用

- 正文页是 CSR（`__nuxt` / `__next` / `<div id="app">`）
- 正文需要 WebView 渲染
- HTTP fetch 只返回 JS 空壳

## 操作顺序

```bash
node "<skill-dir>/scripts/bsg.mjs" android-status
node "<skill-dir>/scripts/bsg.mjs" validator-start
node "<skill-dir>/scripts/bsg.mjs" login --run <run-dir>
node "<skill-dir>/scripts/bsg.mjs" validate --run <run-dir> --mode android
```

`bsg.mjs login` 是单入口脚本：检测 adb，必要时安装 adb，安装 APK，启动 Probe，检查 `/ping`。

## 登录优先级

| 场景 | 登录方式 | 验证方式 |
|------|---------|---------|
| adb 在线（真机或模拟器） | Probe 原生登录 `/login` | `mode=android` |
| adb 不可用 | Browser MCP 登录 + Cookie 提取 | `mode=http` + `cookies.json` |

Probe 登录和 `mode=android` 是两件事：

- Probe 登录：证明登录态来自手机或模拟器环境
- `mode=android`：证明 validator 走过 Android 通道

两者都需要，缺一不行。

## 给用户的登录步骤

1. 手机或模拟器屏幕会弹出目标站点的网页登录页。
2. 请用户在手机或模拟器页面里输入账号密码，完成短信、验证码、滑块或扫码。
3. 看到登录成功页面、用户名、会员中心或站点首页后，让用户回复“已完成登录”。
4. 用户回复后检查 `/cookie-check`，确认 Cookie 后运行：

```bash
node "<skill-dir>/scripts/bsg.mjs" resolve-user-action --run <run-dir> --action login_completed
```

不要提前确认登录完成。

## 禁止事项

- 不问用户直接跑 `bsg.mjs login`
- `bsg.mjs login` 失败后手工 `adb install` 绕过
- HTTP mode 通过但源含 `webView:true` / `webJs` 时标 passed
- adb 在线时用 Browser Cookie 代替 Probe 登录
