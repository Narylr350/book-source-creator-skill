# Validation

## 脚本测试

```powershell
cd legado-book-source-generator
npm test
```

## Validator

```powershell
cd validator
.\gradlew.bat test --console=plain --no-daemon

# 构建 JAR
.\gradlew.bat jar --console=plain --no-daemon
# 部署到 skill 目录
Copy-Item build\libs\legado-source-validator.jar ..\legado-book-source-generator\validator\app\ -Force
```

## Android Probe

```powershell
cd android-probe
.\gradlew.bat assembleDebug --console=plain --no-daemon
```

## 阅读 App（含源码修改调试）

```powershell
cd external/legado-2024
.\gradlew.bat assembleDebug --console=plain --no-daemon
adb install -r app\build\outputs\apk\app\debug\legado_app_*.apk
```

## Release

```powershell
node --test tests/release-workflow.test.mjs
.\validator\package-release.ps1
```

手动触发 `.github/workflows/release.yml` 只构建并上传测试 artifact；推送与 `package.json` 版本一致的 `v*` tag 才发布 GitHub Release。每个版本必须先提交 `release-notes/<tag>.md`。

## 文档改动

文档-only 改动至少检查 `git diff`，确认只影响预期文件。不提交 `docs/superpowers/`。
