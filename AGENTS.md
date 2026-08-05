# 项目维护指令

## 会话导出工具

仓库根目录 `tools/` 存放项目维护和问题审计工具，不属于 `legado-book-source-generator` 的运行时，也不进入 Skill 发布包。

### OpenCode

```powershell
node tools/export-opencode-session.mjs D:\path\to\workspace
node tools/export-opencode-session.mjs --session <session-id> --out $env:TEMP\opencode-audit
```

工具会导出 OpenCode 原始 JSON，并生成便于审计的 `.clean.md`。默认输出位于 Windows 临时目录。`--sanitize` 依赖 OpenCode 自身的脱敏结果，可能删除详细审计所需的信息；需要完整上下文时应保留本地原始导出，不得发布。

### Claude Code

```powershell
node tools/export-claude-session.mjs D:\path\to\workspace
node tools/export-claude-session.mjs --session <session-id> --out $env:TEMP\claude-audit
```

工具从 Claude Code 的 `projects` 会话目录定位 JSONL，并通过 `claude-code-log` 导出 Markdown。默认输出位于 Windows 临时目录。`legado-book-source-generator/scripts/lib/debug-bundle.mjs` 只负责 Skill 运行工件打包，不作为通用会话导出入口。

### 敏感信息边界

会话导出可能包含提示词、命令、文件内容、Cookie、Token、账号凭据和本机路径。原始导出只能保存在本机临时目录或明确的私有位置，不得提交到 Git、附加到公开 issue、写入 release，或未经检查直接发送给第三方。审计完成后删除不再需要的导出文件。
