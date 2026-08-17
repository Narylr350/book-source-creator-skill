Legado 书源生成与验证工具
==========================

一个用于生成和验证 Legado/阅读书源的 **AI Skill**，内置本地 validator。

## 这是什么

本目录是一个 **Claude Code / Codex Skill**。主要使用方式是让 AI 读取 `SKILL.md`，完成 Browser MCP 站点观察、可生成性评估、网站分析、书源生成、对应后端验证、回修和最终交付审计。

默认任务：**"帮我给 https://xxx.com 生成书源"**，输出兼容原版最后版本和社区维护版的 `book-source.json`。

社区版任务：**"帮我给 https://xxx.com 生成社区版 JavaScript 书源，并导入社区版阅读验证"**，输出 `book-source.js`，由支持该能力的社区维护版 App MCP 验证。

内置 validator 和 CLI 脚本用于调试、演示和手动验证。validator 启动时自动选择可用的本机端口。

## 给 AI 用（主要）

让 Claude Code / Codex 加载本目录作为 skill 目录，然后告诉 AI 目标站点 URL 即可。

## 给人类用（调试/手动验证）

查看当前工具和下一步：

```powershell
node scripts\bsg.mjs toolbox
node scripts\bsg.mjs status --run "<run-dir>"
```

传统 JSON 书源使用本地 validator；JavaScript 单文件书源使用社区版 App MCP。生成产物位于 `outputs\<站点>\book-source.json` 或 `outputs\<站点>\book-source.js`，过程报告位于 `runs\<站点>\`。

只有 `deliver --run "<run-dir>"` 返回 `passed` 才表示完整验证流程结束。

## 运行环境

必需：

- Node.js 18+
- Java 17+
- 能访问目标网站的网络环境

可选：

- adb / Android SDK Platform Tools：使用 Android WebView Probe 或社区版 App MCP 的 adb 连接时需要

Windows 常见 adb 路径：

%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe

validator 会自动查找 validator\tools\platform-tools、ANDROID_HOME、ANDROID_SDK_ROOT、上述默认路径和 PATH 里的 adb。

自动安装 adb：

```powershell
validator\setup-adb.bat
```

该脚本会从 Google 官方地址下载 Windows Platform-Tools，并解压到 `validator\tools\platform-tools`。它不会把 adb.exe 写入系统目录。

如果需要手动配置：

setx ANDROID_HOME "%LOCALAPPDATA%\Android\Sdk"
setx ANDROID_SDK_ROOT "%LOCALAPPDATA%\Android\Sdk"
setx PATH "%PATH%;%LOCALAPPDATA%\Android\Sdk\platform-tools"

设置用户环境变量后，新开的终端/程序才会继承。

## Android WebView Probe

Android Probe 用于复核带 webView:true / webJs 的书源链路。

使用前准备：

1. 插入 Android 真机并打开 USB 调试，或启动 Android 模拟器
2. 确认 adb devices 能看到设备
3. 运行 `node scripts\bsg.mjs android-status` 检查设备，生成任务中由 AI 使用 `android --run "<run-dir>"` 完成后续准备

Android 包装命令会：

- 找不到 adb 时自动下载
- 安装 validator\android-probe.apk
- 启动 io.legado.probe/.WebViewProbeActivity
- 建立 localhost:18888 -> device:18888 端口转发

没有设备时，validator 会显示：

validator_limitation
Android Probe 不可用: No Android devices connected

这表示当前电脑没有 Android WebView 复核环境，不代表书源本身一定失败。

注意：

- Android Probe 是真实 Android WebView 复核，但不等于阅读 App 100% 通过。
- Browser 模式是桌面浏览器渲染，不等于 Android WebView。
- 本工具不会绕过验证码、登录、Cloudflare、付费墙、DRM 或其他访问控制。

## 登录态 / Cookie 验证

validator 支持导入和管理 Cookie，用于验证需要登录态或 CookieJar 的书源。

**Cookie 持久化**：Cookie 自动保存到 `validator-cookies.json`，重启不丢失。也可通过环境变量 `COOKIE_STORE` 指定文件路径。

浏览器界面：

- 运行 `validator\run.bat`，打开启动结果中的 `url`
- 在 Cookie 区域填入域名和 Cookie
- 再运行 HTTP / Android / Auto 验证

CLI：

node scripts\bsg.mjs validate --run runs\<slug> [--keyword 关键词] [--mode http|browser|android]

cookies.json 格式：

{
  "novalpie.cc": "auth_token=xxx; other=value"
}

Android Probe 渲染后，WebView 的 Set-Cookie 会自动回存到本地 CookieStore，后续 HTTP 请求自动携带。

注意：

- Cookie 只用于本地验证，不会写入 book-source.json。
- 不要把 Cookie、token、登录头提交到仓库或发给别人。
- 匿名验证通过但存在 loginUrl、enabledCookieJar 或 Authorization 时，状态应为 anonymous_candidate，不能标可用。webJs / webView 只说明渲染或验证路径，不等于登录态。

## 社区版 JavaScript 单文件书源

显式选择社区版目标时，目标 App 需要开启 `MCP service`。AI 会运行：

```powershell
node scripts\bsg.mjs app-mcp status
node scripts\bsg.mjs app-mcp help-js
node scripts\bsg.mjs app-mcp validate-js --source "<book-source.js>" --keyword "<测试关键词>" --report "<run-dir>\app-mcp-report.json"
```

唯一在线 adb 设备会自动建立临时端口转发。多设备使用 `--serial`，网络直连使用 `--url`。需要在 App 中保留验证源时增加 `--keep-source`。

JavaScript 书源修改后先重新运行 `run --run "<run-dir>"` 更新合同检查，再重新执行 App 验证。旧报告不能复用。

## 结果状态说明

- passed：validator 全链路通过（search→detail→toc→content）
- anonymous_candidate：匿名验证通过，但站点存在登录态/Cookie/token 依赖，不能标可用，需登录态或 App 复核
- degraded：技术链路通过但阅读体验降级（如章节 URL 不可区分）
- validator_limitation：validator 不支持该能力，需 App/WebView 复核
- needs_app_review：validator 无法自动确认且已由 record-validation 收敛为需 App 实测的硬边界；不是验证码、Cloudflare、登录失败、付费墙或规则错误的兜底标签
- failed：AI 回修后仍未通过，需人工检查

## 当前已知限制

- validator 已支持通过 Android Probe 调用真实 Android WebView 复核部分 webView:true / webJs 场景，但需要已连接的 Android 设备或模拟器。
- Android Probe 通过只代表该设备 WebView 环境下通过，不等于阅读 App 100% 通过。
- validator Cookie 支持本地持久化（`validator-cookies.json`），重启不丢失；Android Probe 渲染后自动回存 Set-Cookie。
- anonymous_candidate 不是可用通过，只表示匿名链路可作为候选，仍需登录态或 App 复核。
- Cloudflare、验证码、付费墙、会员权限、DRM、强风控等访问控制不会也不应被绕过；具体状态以 record-validation / capability-matrix 为准，不能手工改写成需复核。
- validator passed 只代表当前技术链路跑通，不代表质量通过、长期可用、合法可用或阅读体验完整。
- 多章节 URL 为空、不可区分、全部指向同一全文页、伪章节等情况应标记 degraded。

## 目录结构

```
legado-book-source-generator\
  SKILL.md                    # AI Skill 主文件
  references\                 # 参考文档（工作流、策略、模板等）
  scripts\                    # 辅助脚本
  tests\                      # 测试
  validator\                  # 内置 validator
    android-probe.apk         # Android WebView Probe
    app\                      # JAR 文件
    examples\                 # 测试样例（sources/cases/candidates）
```

## 免责声明

- 本项目不是 Legado/阅读 官方项目，与原 App 作者、维护者及任何站点无从属、授权或背书关系。
- 本项目只用于辅助分析用户有权访问的网站结构，并生成/验证书源规则。
- 本项目不提供、不托管、不分发任何小说正文内容。
- 本项目不提供绕过验证码、登录限制、付费墙、会员权限、DRM、反爬或访问控制的能力。
- 对需要登录、验证码、Cloudflare、Android WebView、webJs、CookieJar、付费或 App-only 行为的站点，工具只能按 validator / record-validation 证据降级或阻塞，不能保证可用。
- 使用者应自行确认目标站点的服务条款、版权状态、访问权限和当地法律法规。
- 生成的书源仅供个人学习、调试和兼容性验证；不得用于侵权传播、批量抓取、商业分发或规避平台限制。
- AI 生成结果可能错误；validator passed 只代表当前链路验证通过，不代表长期可用、合法可用或阅读体验完整。
