# Tech Baseline

## 技术栈

| 层 | 路径 | 技术 | 构建方式 |
|---|------|------|---------|
| Skill CLI | `legado-book-source-generator/scripts/` | Node.js 18+ ESM | `npm test` |
| Validator | `validator/src/` | Kotlin/Gradle | `./gradlew.bat jar` |
| Android Probe | `android-probe/` | Kotlin/Android Gradle | `./gradlew.bat assembleDebug` |
| Community App MCP | 社区维护版阅读 App | MCP 2025-03-26 / JavaScript | App 内运行时验证 |
| 阅读源码参考 | `external/legado-2024/` | Kotlin/Android Gradle | `./gradlew.bat assembleDebug` |

## 关键环境

- Node.js 18+
- Java 17+
- adb（用于 Probe 连接）
- curl（Windows 10+ 自带，validator HTTP 请求用）
- 社区维护版阅读 App MCP（仅显式 community JS 目标）

## 目录约定

```
legado-book-source-generator/   # Skill 发布内容：SKILL.md + references + scripts + tests + validator/
  validator/app/                 # validator JAR 部署位置
validator/                       # validator 源码（不发布，构建用）
android-probe/                   # Probe 源码（不发布，构建用）
external/legado-2024/            # 阅读 App 源码参考（不发布）
docs/                            # 项目文档（行为矩阵、环境配置）
.ai/                             # AI 维护基线
```

## 构建发布链

1. `validator/`：`.\gradlew.bat jar` → 产物部署到 `legado-book-source-generator/validator/app/`
2. `android-probe/`：`.\gradlew.bat assembleDebug` → APK 复制到同目录
3. `release/`：`package-release.ps1` 从 Skill `package.json` 读取默认版本并打包 zip
4. `.github/workflows/release.yml`：手动触发只构建测试 artifact；推送匹配 `v*` 的 tag 时，读取 `release-notes/<tag>.md` 自动创建 GitHub Release
