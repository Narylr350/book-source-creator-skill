# Validation

## 脚本层测试

```powershell
cd legado-book-source-generator
npm test
```

覆盖：CLI 黑盒测试、状态管理、结构校验、文档契约。44 个测试。

## Validator 测试与构建

```powershell
cd validator
.\gradlew.bat test --console=plain --no-daemon
.\gradlew.bat jar --console=plain --no-daemon
```

覆盖：CookieStore eTLD+1 归一、RuleValidator dry-run、搜索空 errorCode、P8 回归测试。

构建产物部署：`validator/build/libs/legado-source-validator.jar` → `legado-book-source-generator/validator/app/legado-source-validator.jar`

## Android Probe 构建

```powershell
cd android-probe
.\gradlew.bat assembleDebug --console=plain --no-daemon
```

产物：`app/build/outputs/apk/debug/app-debug.apk`，复制到 `legado-book-source-generator/validator/android-probe.apk`

## 阅读 App 调试构建（含源码修改）

```powershell
cd external/legado-2024
.\gradlew.bat assembleDebug --console=plain --no-daemon
```

产物：`app/build/outputs/apk/app/debug/legado_app_*.apk`。用于验证阅读 App 行为与 validator 行为的一致性。

## 书源交付验证

1. `node bsg.mjs validate --run runs/<slug> [--keyword <kw>] [--book-url <url>] [--mode http|browser|android]`
2. `node bsg.mjs record-validation --run runs/<slug> --status <passed|failed|degraded>`
3. `node bsg.mjs deliver --run runs/<slug>`
4. `node bsg.mjs validator-stop`

deliver 返回 ok 是完成的唯一标志。

## Dry-run 规则校验

`POST /api/validate-rules` 验证 chapterUrl `##$##` 格式、searchUrl webView 误用、header JS 执行。rule-check 自动调用。

## 文档改动验证

文档-only 改动至少检查 git diff，确认只影响预期文件。不提交 superpowers/specs/plans 等 AI 工作文档。
