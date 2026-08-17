# 社区版 JavaScript 书源

JavaScript 单文件书源是面向支持该能力的社区维护版阅读 App 的可选目标。默认仍生成传统 `book-source.json`，用于兼容原版最后版本和社区维护版。

## 什么时候使用

明确使用社区维护版，并且站点需要 JavaScript 处理复杂请求、动态正文或社区版扩展能力时，可以选择该目标。

任务示例：

```text
给 https://example.com 生成社区版 JavaScript 书源，并导入社区版阅读验证。
```

没有明确选择社区版时，Skill 使用默认传统 JSON 目标。`book-source.js` 不保证兼容原版最后版本。

## 准备 App

需要：

- 支持 JavaScript 单文件书源和原生 MCP 的社区维护版阅读 App
- 在 App 设置中开启 `MCP service`
- 电脑可通过局域网访问 App MCP 地址，或设备可通过 adb 转发连接
- App 启用访问令牌时，由当前进程提供 `LEGADO_MCP_TOKEN`
- AI 客户端已配置 Browser MCP，用于站点观察

只有开启 App 服务、提供令牌，以及使用 adb 时的设备授权或多设备选择需要本人参与。环境检查、连接、生成和验证由 AI 执行。

## 生成流程

AI 会执行以下步骤：

1. 用 Browser MCP 打开目标站点，记录搜索、详情、目录、正文证据。
2. 使用 `community-js` 初始化任务。
3. 连接目标 App，并读取该版本实时提供的 JavaScript 契约。
4. 生成 `outputs/<网站名>/book-source.js`。
5. 在 App 中保存并读回书源，调试搜索、详情、目录和正文。
6. 运行 App 校验，记录 `app-mcp-report.json`。
7. 通过 `record-validation` 收敛验证结果。
8. 通过 `deliver` 完成最终交付审计。

App MCP 是 JavaScript 单文件书源的验证后端。本地 validator、Browser MCP 或 Android Probe 不能替代 App 验证。

## 手动命令

以下命令主要用于维护和排错。`<skill-dir>` 指安装后的 `legado-book-source-generator` 目录。

初始化：

```powershell
node "<skill-dir>/scripts/bsg.mjs" init "https://example.com" --cwd "<工作目录>" --target community-js
```

局域网直连并确认 App 能力：

```powershell
node "<skill-dir>/scripts/bsg.mjs" app-mcp status --url "http://<设备IP>:1236/mcp"
node "<skill-dir>/scripts/bsg.mjs" app-mcp help-js --url "http://<设备IP>:1236/mcp"
```

也可以设置环境变量，后续命令会复用该地址：

```powershell
$env:LEGADO_MCP_URL = "http://<设备IP>:1236/mcp"
node "<skill-dir>/scripts/bsg.mjs" app-mcp status
```

局域网不可达或只通过 USB 连接时，直接运行命令会使用唯一在线 adb 设备建立临时转发：

```powershell
node "<skill-dir>/scripts/bsg.mjs" app-mcp status
```

多设备环境指定设备：

```powershell
node "<skill-dir>/scripts/bsg.mjs" app-mcp status --serial "<adb-serial>"
```

生成脚本后运行 App 验证：

```powershell
node "<skill-dir>/scripts/bsg.mjs" app-mcp validate-js `
  --source "<工作目录>/outputs/<网站名>/book-source.js" `
  --keyword "<测试关键词>" `
  --report "<工作目录>/runs/<网站名>/app-mcp-report.json"
```

默认会在验证结束后删除 App 内的临时书源。需要保留到 App 继续检查时增加 `--keep-source`：

```powershell
node "<skill-dir>/scripts/bsg.mjs" app-mcp validate-js --source "<book-source.js>" --keyword "<测试关键词>" --report "<app-mcp-report.json>" --keep-source
```

最后收敛并交付：

```powershell
node "<skill-dir>/scripts/bsg.mjs" record-validation --run "<run-dir>" --status passed
node "<skill-dir>/scripts/bsg.mjs" deliver --run "<run-dir>"
```

## 回修

App 验证失败时，根据 `app-mcp-report.json` 修正 `book-source.js`。修改后再次运行：

```powershell
node "<skill-dir>/scripts/bsg.mjs" run --run "<run-dir>"
```

`run` 会按当前脚本哈希重新完成 JavaScript 合同检查。旧 App 报告不会复用；必须重新运行 `app-mcp validate-js`，再执行 `record-validation` 和 `deliver`。

## 通过条件

完整通过需要同时满足：

- App 已保存并读回当前脚本
- 搜索、详情、目录、正文四条链路有成功证据
- App `check_source` 明确通过
- `app-mcp-report.json` 对应当前脚本哈希
- `record-validation` 返回 `passed`
- `deliver` 返回 `passed`

该结论只表示当前 App 版本、当前站点状态和当前验证样本下技术链路通过，不代表原版兼容、永久可用、合法可用或阅读体验完整。

## 常见问题

### App MCP 无法连接

确认 App 已启动并开启 `MCP service`。局域网直连时检查电脑能否访问设备 IP，并通过 `--url` 或 `LEGADO_MCP_URL` 指定地址；该方式不需要 adb。使用 adb 转发时再检查设备授权，多设备时指定 `--serial`。App 要求令牌时，在当前进程设置 `LEGADO_MCP_TOKEN`。

### 验证超时

查看 `app-mcp-report.json` 中失败的链路。优先修正生成脚本的请求或解析逻辑，不把超时改写为通过，也不切换到本地 validator 代替 App 结论。

### 如何把书源留在 App

验证时使用 `--keep-source`。报告会标记 `sourceRetainedInApp: true`，之后可以在 App 内继续搜索和阅读检查。

### 可以把 Token 或 Cookie 提交到 issue 吗

不可以。提交调试材料前删除 Cookie、Token、账号凭据和其他个人信息。
