Legado 书源验证器 — 测试样例
================================

## 正例：biquges-com（蚂蚁文学）

文件：`examples/biquges-com-book-source.json`
关键词：`凡人修仙传`
站点：biquges.com → 301 重定向到 mayiwsk.com

| 步骤 | 预期状态 | 预期结果 |
|------|---------|---------|
| 搜索 | success | resultCount ≥ 1, firstBook 含"凡人修仙" |
| 详情 | success | name, author, intro 有值 |
| 目录 | success | chapterCount ≥ 100 |
| 正文 | success | contentLength > 100, preview 含"二愣子" |

已验证通过（2026-06-13）：search=50, detail=OK, toc=2565, content=OK

---

## 反爬负例：69shuba-com

文件：`legado-book-source-generator/examples/69shuba-com/book-source.json`
关键词：`凡人修仙传`
站点：69shuba.com（Cloudflare Turnstile 反爬）

| 步骤 | 预期状态 | 预期结果 |
|------|---------|---------|
| 搜索 | error | error 含 "Cloudflare" 或 "Turnstile" 或 "验证" |

已验证通过（2026-06-13）：响应含 `challenges.cloudflare.com/turnstile`，错误信息正确标记

---

## 复杂待测：163zw

文件：`legado-book-source-generator/examples/163zw/book-source.json`
关键词：待定（需查站点实际书名）
站点：163zw.com

| 步骤 | 预期状态 | 预期结果 |
|------|---------|---------|
| 搜索 | 待测 | 可能 HTTP 502（站点不稳定） |

当前状态：未测试，站点可能不可用。待站点恢复后补测。

---

## 使用方式

### 浏览器测试
1. 启动 `run.bat`
2. 打开 `http://localhost:1111`
3. 粘贴书源 JSON，点"导入"
4. 输入关键词，点"运行"

### API 测试（AI 用）
```bash
curl -X POST http://localhost:1111/api/debug/run \
  -H "Content-Type: application/json" \
  -d '{"sourceJson": [...], "sourceUrl": "https://...", "keyword": "..."}'
```

返回格式：
```json
{
  "ok": true,
  "phases": {"search": "success", "detail": "success", "toc": "success", "content": "success"},
  "summary": {"resultCount": 50, "firstBook": "...", "chapterCount": 2565, "contentPreview": "..."},
  "steps": [...]
}
```
