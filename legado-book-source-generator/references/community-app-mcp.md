# 社区维护版阅读 App MCP

JavaScript 单文件书源是面向社区维护版阅读 App 的可选输出格式。默认仍生成传统 `book-source.json`，以兼容原版最后版本及社区维护版。

## 使用条件

- 用户明确要求 JavaScript 单文件书源，或明确选择社区维护版目标。
- 目标 App 已启用 `MCP service`。
- App 的 Web/MCP 访问令牌已配置。
- MCP 提供 `save_source`、`get_source`、`debug_source`、`check_source`、`list_sources`、`delete_sources`。
- MCP resources 包含 `legado://help/jsHelp`。

缺少任一条件时停止配置，不切换到本地 validator、Browser MCP 或 Android Probe 伪造 JavaScript 单文件书源验证结果。

## 连接

电脑与设备处于可互访的局域网时，优先传 `--url http://<设备IP>:1236/mcp` 或设置 `LEGADO_MCP_URL` 直接连接，不需要 adb。局域网不可达、不方便使用设备 IP，或设备只通过 USB 连接时，直接运行 `app-mcp status`；检测到唯一一台在线 adb 设备后，命令会自动将电脑本地临时端口转发到设备 `1236`，并在命令结束后移除转发。多设备环境传 `--serial <adb-serial>`。

App 配置了访问令牌时，在当前进程设置 `LEGADO_MCP_TOKEN`。令牌不写入 run 目录、issue、日志或调试包。AI 先选择局域网直连或 adb 转发并完成连接；只有 App 服务未开启、需要本人提供令牌，或已选择 adb 路径但设备未授权、需要选择设备时才暂停。

连接成功必须返回：

- `backend: legado_app_mcp`
- 目标 App 的 `serverInfo`
- `missingTools: []`
- `missingResources: []`

生成前运行 `app-mcp help-js` 读取目标 App 当前版本提供的 `legado://help/jsHelp`。动态内容不复制到 run；不要用模型记忆、仓库副本或其他版本文档代替当前 App 契约。

## 验证 JavaScript 单文件书源

```powershell
node "<skill-dir>/scripts/bsg.mjs" app-mcp validate-js --source "<book-source.js>" --keyword "<测试关键词>" --report "<run-dir>/app-mcp-report.json"
```

命令必须在目标 App 中完成：

1. `save_source` 保存脚本。
2. `get_source` 读回并核对脚本；允许 App 管理 `lastUpdateTime`。
3. `debug_source` 取得搜索、详情、目录、正文四链路日志。搜索结果已提供 `tocUrl` 时，App 可明确记录跳过详情页；报告必须标记 `debug.detail.status: skipped_with_toc_url`，不能写成实际执行了详情解析。
4. `check_source` 返回该源明确通过。
5. 默认删除 App 内测试源，并通过 `list_sources` 确认没有残留。

输出报告写入当前 run 的 `app-mcp-report.json`，包括 run 目录、源文件 SHA-256、App 版本、协议版本、四链路状态、App 校验摘要和清理结果。报告不记录访问令牌、Cookie 或完整 HTTP 日志。

只有 `status: passed`、四链路全部为 `true`、`appCheck.passed: true` 且默认清理得到确认时，才可表述为当前社区版 App 验证通过。该结论不代表原版最后版本兼容、永久可用、合法可用或阅读体验完整。

`--keep-source` 仅在明确需要保留到 App 继续人工检查时使用；报告会标记 `sourceRetainedInApp: true`。
