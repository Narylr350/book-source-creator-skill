# Tech Baseline

## 技术栈

| 层 | 技术 | 用途 |
|---|------|------|
| Skill CLI | Node.js 18+ (ESM) | `bsg.mjs` 工具箱、状态管理、静态审计、rule-check、deliver 门禁 |
| Validator | Kotlin/JVM + Gradle | 阅读书源引擎 JVM 移植。OkHttp HTTP 请求已改用 curl（绕 JSSE TLS 指纹检测） |
| Cookie 持久化 | CookieStore + eTLD+1 归一 | okhttp PublicSuffixDatabase，www/wap/m 子域共享 |
| JS 执行 | Rhino | header `<js>` 块、webJs、`@js:` 规则 |
| CSS/JSONPath/Regex | Jsoup / Gson / java.util.regex | 书源规则解析，对齐 Legado AnalyzeByJSoup/ByJSonPath/ByRegex |
| Android Probe | Kotlin + Android Gradle | WebView 渲染、webJs 执行、CSR 正文、CookieManager，通过 adb 连接 |
| WebView 渲染 | Android WebView + evaluateJavascript | BackstageWebView 对齐，cookie 回存 CookieStore |
| HTTP 请求 | curl (OpenSSL) | 替代 OkHttp，避免 PC JVM JSSE TLS 指纹被反爬检测 |
| Android 调试 | `external/legado-2024` | 阅读 App 源码参考，debug WebSocket API |

## 关键依赖

- **Node.js 18+**：`bsg.mjs` 脚本、`npm test`
- **Java 17+**：validator JAR 运行
- **Gradle + Kotlin**：validator 开发构建
- **Android SDK + Gradle**：Probe 开发构建
- **adb**：Probe 连接和端口转发
- **curl**：validator HTTP 请求（Windows 10+ 自带）

## 架构约定

1. **不把 validator 改成纯 Node**：会降低与阅读规则语义和 Android WebView 行为的贴近度
2. **不把项目退化成纯文档 skill**：`record-validation` 和 `deliver` 是降低返工的核心门禁
3. **validator ≈ 阅读 App 书源引擎**：JVM 移植了 webBook/analyzeRule/rhino，不是另写半成品
4. **HTTP 请求用 curl**：PC JVM 的 JSSE TLS 指纹与 Android BoringSSL 不同，部分站点（如 ciweimao）通过 JA3 检测拦截
5. **Cookie 按 eTLD+1 归一**：匹配阅读 App 的 `NetworkUtils.getSubDomain`，www/wap/m 共享一份
6. **Probe cookie 落渲染域**：Probe WebView cookie 按域隔离，移动 UA 登录可能被站点重定向到 wap 子域

## 目录结构

```
legado-book-source-generator/   # AI Skill 目录（SKILL.md + references + scripts + tests + validator）
validator/                       # validator 源码（Kotlin/Gradle，阅读引擎 JVM 移植）
android-probe/                   # Android WebView Probe 源码（Kotlin/Gradle）
external/legado-2024/            # 阅读 App 源码参考
docs/                            # 文档（行为矩阵、环境配置、specs）
.ai/                             # AI 项目基线
```

## 已知坑

1. **sourceRegex 死参数**：validator `BookContent.kt` 接受 sourceRegex 但不使用，Probe 也不实现
2. **Probe WebView cookie 按域隔离**：移动 UA → wap，桌面 UA → 根域，通过书源 header UA 控制
3. **curl 依赖**：Windows 需 `curl.exe`，PowerShell 需用 `curl.exe` 而非 `curl` 别名
4. **signState 校验**：`run-state.json` 有 SHA256 签名，禁止手动编辑
