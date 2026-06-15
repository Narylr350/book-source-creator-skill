# Validator 集成

## 概述

Validator 是本地书源预验证工具，运行在 `http://localhost:1111`。Skill 生成书源后，先跑 validator 验证，再决定交付或回修。

## 内置运行包

本 skill 自带 validator 前后端运行包：

```text
validator/
  run.bat
  app/legado-source-validator.jar
  examples/
```

启动方式：

```powershell
cd legado-book-source-generator/validator
.\run.bat
```

启动后打开 `http://localhost:1111` 可使用浏览器调试台；脚本和 Skill 验证流程调用同一个后端 API。

## API 接口

### POST /api/debug/run

单次验证：传入书源 JSON + 关键词，返回完整步骤详情。

```bash
curl -X POST http://localhost:1111/api/debug/run \
  -H "Content-Type: application/json" \
  -d '{"sourceJson": "<书源JSON>", "sourceUrl": "https://...", "keyword": "关键词", "mode": "http"}'
```

参数：
- `sourceJson`：书源 JSON 字符串（数组或单对象均可）
- `sourceUrl`：书源的 bookSourceUrl
- `keyword`：搜索关键词
- `mode`：`http` | `browser` | `auto`

返回：
```json
{
  "ok": true,
  "phases": {"search": "success", "detail": "success", "toc": "success", "content": "success"},
  "summary": {"resultCount": 50, "firstBook": "...", "chapterCount": 2565, "contentPreview": "..."},
  "steps": [
    {
      "phase": "search",
      "status": "success",
      "mode": "http",
      "request": {"url": "...", "method": "GET", "headers": {}, "body": null},
      "response": {"code": 200, "contentType": "...", "bodyPreview": "...", "bodyLength": 12345},
      "ruleHits": [
        {"field": "name", "rule": "Default:td.odd a", "value": "凡人修仙传", "success": true}
      ],
      "extracted": {"resultCount": 50, "firstBook": {...}}
    }
  ]
}
```

### POST /api/debug/smoke

批量验证：跑全部回归 case，返回汇总报告。

```bash
curl -X POST http://localhost:1111/api/debug/smoke \
  -H "Content-Type: application/json" \
  -d '{}'
```

返回：
```json
{
  "ok": true,
  "total": 7, "pass": 7, "fail": 0, "error": 0, "skip": 0,
  "results": [...]
}
```

## 状态判定

| 状态 | 含义 | Skill 动作 |
|------|------|-----------|
| `passed` | 全链路 success，所有字段有值 | 交付书源 |
| `failed` | 某阶段 error，有可修证据 | AI 自动回修 |
| `needs_app_review` | needsAppReview=true 或命中 App-only 行为 | 停止自动修，标记需复核 |
| `validator_limitation` | validator 不支持的规则能力（如 @js 动态 URL） | validator 无法验证该能力；预期需要 App/WebView 复核。当前不是 full pass，不能标可用。 |
| `failed_unresolved` | AI 回修 3 次后仍未通过 | 标记未解决，需人工检查 |
| `blocked` | validator 未运行 | 阻塞，要求启动 validator，除非用户明确选择"仅生成未验证草稿" |

## 判定逻辑

```
if 全 phases == "success":
    status = "passed"
elif step.needsAppReview == true:
    status = "needs_app_review"
elif step.error 含 "Cloudflare|Turnstile|验证码|登录|WebView":
    status = "needs_app_review"
elif step.error 含 "已知限制|不支持|@js 动态 URL":
    status = "validator_limitation"
elif step.ruleHits 有字段失败:
    status = "failed"  // AI 可修
elif step.error 含 URL/编码/规则错误:
    status = "failed"  // AI 可修
else:
    status = "needs_app_review"  // 保守判定
```

回修 3 次后仍未通过 → `failed_unresolved`

## 前置检查与生命周期管理

### 探测

调用 validator 前，先检查是否运行：

```bash
curl -s http://localhost:1111/api/sources >nul 2>&1 && echo Running || echo Not running
```

已有服务则复用，不重复启动。

### 启动

**禁止无提示隐藏启动。**

- **用户手动启动**：双击 `validator/run.bat`
  - 可见窗口，标题显示 `Legado Source Validator - http://localhost:1111`
  - Ctrl+C 或关窗口停止
- **AI 启动**：
  - 前台运行：`java -jar validator/app/legado-source-validator.jar`
  - 后台启动：记录 PID 到 `runs/<site-slug>/validator.pid`
  - 必须在回复中说明：服务地址、启动方式、停止方式、PID

### 停止

- **AI 本次启动的** → 验证结束后负责关闭
- **用户原本开的** → 不要关
- 停止方式：
  - `validator/stop.bat`（按端口停止，给人/AI 用）
  - `taskkill /PID <pid> /F`（按 PID 停止）

### 获取 PID

```powershell
for /f "tokens=5" %a in ('netstat -aon ^| findstr :1111 ^| findstr LISTENING') do echo PID: %a
```
