# Legado / 阅读 书源生成 Skill

用于让 AI 生成 Legado（阅读 App）书源。

给 AI 一个小说网站地址，它会尝试分析网站结构，生成阅读可导入的书源，并检查搜索、详情、目录、正文等链路是否能跑通。默认生成兼容原版最后版本和社区维护版的 `book-source.json`；明确选择社区维护版时，也可以生成 JavaScript 单文件书源 `book-source.js`。

**这是一个给 Claude Code / Codex 等 AI 使用的“阅读书源生成 Skill”。**

> 本项目不是阅读官方项目，也不是书源分享包。它不提供小说内容，不内置可用书源，也不绕过验证码、付费墙、Cloudflare、DRM 或其他访问控制。

## 适合谁

适合：

* 想用 AI 生成阅读书源
* 不想手搓复杂的书源规则
* 想知道 AI 写出来的书源到底能不能跑
* 想分析一个网站能不能做成阅读书源
* 想调试搜索、目录、正文抓取失败的问题

如果只是想找现成书源，这个项目不适合。
本项目不提供现成书源，也不是书源合集。

## 快速开始

到 [GitHub Releases](https://github.com/Narylr350/book-source-creator-skill/releases) 下载最新压缩包：

```text
legado-book-source-generator-*.zip
```

解压后，把里面的 `legado-book-source-generator` 文件夹放到 AI 工具的 skills 目录。

常见路径：

| 工具          | 安装位置                                               |
| ----------- | -------------------------------------------------- |
| Claude Code | `~/.claude/skills/legado-book-source-generator/`   |
| Codex       | `$CODEX_HOME/skills/legado-book-source-generator/` |
| 其他工具        | 对应工具的 skills 目录                                    |

装好后，不建议手动配置 Java、adb、模拟器或本地验证环境。
直接把任务交给 AI，让它先检查环境、补齐依赖、运行工具、生成书源、验证结果。

任务示例：

```text
给 https://example.com 生成书源。
```

默认目标是传统 JSON。需要使用社区维护版的 JavaScript 书源能力时，明确写出目标：

```text
给 https://example.com 生成社区版 JavaScript 书源，并导入社区版阅读验证。
```

通常不需要手动运行脚本。
AI 应该自己调用工具、分析网站、生成书源、检查结果，并在遇到缺失环境时优先尝试完成配置，而不是只返回配置步骤。

只有下面这些情况通常需要本人参与：

* 授权安装软件或修改系统环境变量
* 插入 Android 手机并打开 USB 调试
* 在模拟器或手机上确认 adb 授权
* 登录自己有权访问的账号
* 处理验证码、付费、权限或站点访问限制
* 确认是否接受降级结果

## 选择输出格式

| 目标 | 产物 | 验证后端 | 适用范围 |
| --- | --- | --- | --- |
| 默认传统书源 | `outputs/<网站名>/book-source.json` | 本地 validator，必要时配合 Android Probe | 原版最后版本和社区维护版 |
| 社区版 JavaScript 书源 | `outputs/<网站名>/book-source.js` | 社区维护版阅读 App MCP | 明确使用支持 JavaScript 单文件书源的社区版 |

未指定目标时使用传统 JSON。JavaScript 单文件书源不是兼容性升级，不应假定可以导入原版最后版本。

社区版目标需要已安装并启动社区维护版阅读 App、开启 `MCP service`，并通过 adb 或显式 MCP 地址连接。AI 会读取目标 App 当前提供的 JavaScript 契约，生成脚本后在 App 内完成保存、读回、四链路调试和校验。

完整使用方法见 [社区版 JavaScript 书源指南](docs/COMMUNITY_JS.md)。

## 产物

成功后，最终文件位于 `outputs/<网站名>/`。过程报告位于 `runs/<网站名>/`，包括站点观察、验证报告和最终交付审计。

只有 `deliver` 返回 `passed` 才表示当前验证流程完成。局部 HTTP、Browser、Android Probe 或 App 调试成功都不能单独写成完整通过。

如果失败，Skill 内置工具会尽量告诉 AI 卡在哪一步，例如：

* 搜索没有结果
* 目录没有解析出来
* 正文规则匹配失败
* 网站返回验证码
* 页面需要登录
* 页面需要 WebView 渲染
* 站点存在付费/VIP 限制

失败原因会作为下一步修复依据，避免只得到一句“可能不可用”。

## 它不能做什么

* 不提供现成小说内容
* 不提供现成可用书源合集
* 不绕过验证码
* 不绕过登录限制
* 不绕过付费墙、会员权限、DRM
* 不绕过 Cloudflare、强反爬或其他访问控制
* 不保证站点长期可用
* 不保证所有网站都能生成成功

如果目标网站本身限制访问、需要付费、需要验证码或强反爬，本项目不会协助绕过这些限制。

## 也能验证已有书源

如果只是想验证一个已有书源，可以启动压缩包里的本地验证服务：

```text
validator/run.bat
```

启动命令会输出本次使用的本机地址。打开输出中的 `url`，然后导入书源、输入关键词并运行检查。端口由工具自动选择，避免与 Windows 保留端口或其他本机服务冲突。

## 需要 Android 手机/模拟器吗？

大多数普通网站不需要。

如果网站正文是前端 JS 渲染的，普通 HTTP 检查可能只能拿到空白页面。这时可以连接 Android 真机或模拟器，让工具用手机 WebView 辅助验证。

需要时会提示。无需先研究模拟器安装，让 AI 检查当前环境，并尽量完成 adb、模拟器或 Android Probe 的准备工作。

如果不使用模拟器，可能需要准备：

* Android 真机和一根能连接电脑的数据线

详细说明见：

* [docs/SETUP.md](docs/SETUP.md)
* [legado-book-source-generator/references/android-probe-guide.md](legado-book-source-generator/references/android-probe-guide.md)

## 需要 Browser MCP / 浏览器访问能力吗？

需要。Browser MCP 是站点分析的前置能力，用于观察真实页面、交互路径、渲染结果和网络请求。

未配置 Browser MCP 时，AI 应先完成安装或配置；只有授权、客户端重启或更换支持浏览器工具的客户端需要本人操作时才暂停。配置完成后，第一项站点操作是打开用户提供的目标 URL，并通过页面、交互和网络请求完成四链路取证。Android Probe 负责后续 Android/WebView、登录态和 App 行为复核。

## 常见问题

### 这是书源仓库吗？

不是。

这是生成和验证书源的工具，不提供现成书源。

### 生成的书源一定能用吗？

不一定。

工具会尽量检查搜索、目录、正文等链路，但目标站点可能改版、加反爬、限制访问或下线。

### 为什么 AI 生成失败？

常见原因包括：

* 目标网站结构复杂
* 正文需要 WebView 渲染
* 搜索接口被限制
* 目录分页特殊
* 网站返回验证码
* 内容需要登录或付费
* 目标站点改版、加盾或临时不可访问
* 当前使用的 AI 模型能力不足，没能正确分析网站、调用工具或根据失败原因继续修复

这个 Skill 已经尽量把流程拆成明确步骤，并通过本地检查工具告诉 AI 卡在哪里。但最终效果仍然依赖 AI 模型本身的网页分析、代码修改、工具调用和长上下文能力。

如果模型反复失败，可以尝试换更强的模型，或者把失败提示和 `runs/<网站名>/` 目录内容提交 issue，帮助改进文档和流程。

### 可以用来批量抓小说吗？

不可以。

本项目只用于个人学习、调试和兼容性验证，不用于批量抓取、内容分发或规避平台限制。

## 文档和开发者入口

日常使用入口：

* [docs/SETUP.md](docs/SETUP.md)
* [docs/COMMUNITY_JS.md](docs/COMMUNITY_JS.md)

`SETUP.md` 记录 Browser MCP、Java、validator、adb、Android 真机/模拟器和 Android Probe；`COMMUNITY_JS.md` 记录社区版 JavaScript 单文件书源的连接、生成、验证、回修和保留方法。

如果想了解底层行为边界，可以看：

* [legado-book-source-generator/references/webview-behavior-matrix.md](legado-book-source-generator/references/webview-behavior-matrix.md)
* [legado-book-source-generator/references/legado-source-behavior.md](legado-book-source-generator/references/legado-source-behavior.md)

其中：

* [legado-book-source-generator/references/webview-behavior-matrix.md](legado-book-source-generator/references/webview-behavior-matrix.md)：对比阅读 App、Android Probe、Validator HTTP 模式在 WebView、Cookie、UA、TLS、sourceRegex 等行为上的差异。
* [legado-book-source-generator/references/legado-source-behavior.md](legado-book-source-generator/references/legado-source-behavior.md)：记录已经从阅读源码或明确实现中确认过的书源规则行为边界。

项目主要目录：

```text
legado-book-source-generator/    # AI Skill 主目录
validator/                       # 本地书源验证器源码
android-probe/                   # Android WebView 辅助验证源码
docs/                            # 安装、架构和行为边界说明
```

更多 AI Skill 入口和规则说明见：

* [legado-book-source-generator/SKILL.md](legado-book-source-generator/SKILL.md)
* [legado-book-source-generator/references/workflow.md](legado-book-source-generator/references/workflow.md)
* [legado-book-source-generator/references/policies.md](legado-book-source-generator/references/policies.md)
* [legado-book-source-generator/references/failure-diagnosis.md](legado-book-source-generator/references/failure-diagnosis.md)
* [legado-book-source-generator/references/validator-integration.md](legado-book-source-generator/references/validator-integration.md)

## 提交问题

如果 AI 已经明确判断目标站点因为验证码、登录限制、付费墙、Cloudflare、DRM、强反爬或站点访问限制而无法生成书源，这通常不是 Skill 的 bug。请不要提交“帮我绕过限制 / 让这个站点可用”这类 issue。

若 AI 判断可能有误，或者工具给出的失败原因不清楚、前后矛盾、无法继续排查，可以提交 issue。

提交时建议附上：

* 目标网站
* 使用的 AI 工具
* 失败时的提示
* 生成过程里的 `runs/<网站名>/` 目录内容

提交前请先检查并删除可能包含账号、Cookie、Token 或个人信息的内容。
不要提交包含 Cookie、Token、账号凭据的文件。

## 免责声明

本项目不是 Legado / 阅读官方项目，与原 App 作者、维护者及任何站点无从属、授权或背书关系。

本项目只用于辅助分析用户有权访问的网站结构，并生成、验证书源规则。

本项目不提供、不托管、不缓存、不分发任何小说正文内容。

本项目不内置可用侵权书源集合，不是书源分享包。

本项目不提供绕过验证码、登录限制、付费墙、会员权限、DRM、Cloudflare、反爬或其他访问控制的能力。

使用者应自行确认目标站点的服务条款、版权状态、访问权限和当地法律法规。

生成的书源仅供个人学习、调试和兼容性验证；不得用于侵权传播、批量抓取、商业分发或规避平台限制。

AI 生成结果可能错误；检查通过只代表当前技术链路在本工具可验证范围内跑通，不代表长期可用、合法可用或阅读体验完整。

请不要发布或分享含 Cookie、Token、账号凭据的调试产物或书源文件。
