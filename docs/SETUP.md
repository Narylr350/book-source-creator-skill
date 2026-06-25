# Validator 与 Android Probe 环境配置

## validator（HTTP / Browser 验证）

必需：

- Java 17+
- 可访问目标网站的网络环境

启动（以下路径适用于 Release 包；clone 仓库开发的见 `validator/` 根目录下的同名 bat）：

```powershell
cd .\legado-book-source-generator\validator
.\run.bat
```

浏览器打开 `http://localhost:1111`。

停止：

```powershell
# run.bat 窗口里按 Ctrl+C
# 或者
.\stop.bat
```

---

## Android WebView Probe（可选）

用于复核带 `webView:true` / `webJs` 的书源链路。

### 为什么需要 Android APK？直接用阅读 App 不行吗？

阅读 App **是**最终验证目标——书源生成后必须导入阅读 App 实测。但阅读 App 无法以编程方式被 AI 自动调用：它没有 API 接口，不能从命令行触发"搜索→打开详情→加载目录→翻页阅读"的自动化流程。

Android Probe 解决的就是这个 gap——它是一个轻量的 Android APK，只运行一个 WebView，暴露 HTTP API（`/render`）。validator 通过 ADB 连接手机上的 Probe，自动完成 WebView 渲染、JS 执行、截图和正文提取，**全程无需人工操作**。

**三者关系：**
- **validator HTTP 模式**：快速验证非 CSR 的搜索/详情/目录链路
- **validator Android Probe**：接管手机 WebView 自动验证 CSR 正文（代替人工点来点去）
- **阅读 App**：最终人工验收——书源导入后正常搜索、阅读，确认体验正常

Probe 运行在真实 Android WebView 上，比桌面 Browser 模式更接近阅读 App WebView 环境，但仍不等于阅读 App 100% 通过。

需要：

- 一台打开 USB 调试的 Android 真机，或一个已启动的 Android 模拟器
- `adb`（可用 Release 包内的 `setup-adb.bat` 自动下载）
- Release 包内置的 `validator\android-probe.apk`

### 手机端设置（用户操作，约 2 分钟）

**第一步：开启开发者选项**

1. 打开手机 **设置 → 关于手机**
2. 连续点击 **"版本号"** 7 次，直到提示"已进入开发者模式"

**第二步：开启 USB 调试**

1. 打开手机 **设置 → 开发者选项**（通常在"更多设置"或"系统和更新"下）
2. 打开 **"USB 调试"** 开关
3. 部分手机还需打开 **"USB 安装"** 或 **"USB 调试（安全设置）"**

**第三步：连接电脑**

1. 用 USB 数据线连接手机和电脑
2. 手机会弹出 **"是否允许 USB 调试"** 对话框，勾选"始终允许"后点确定
3. 如果没有弹出，运行 `adb devices`，手机会出现授权提示

| 品牌 | 开发者选项位置 | 注意事项 |
|------|--------------|---------|
| 小米/Xiaomi | 设置 → 我的设备 → 全部参数 → 连点 MIUI 版本 | 还需在开发者选项中开 "USB 调试（安全设置）" |
| 华为/Huawei | 设置 → 关于手机 → 连点版本号 | 部分机型还需开启"仅充电模式下允许 ADB 调试" |
| 三星/Samsung | 设置 → 关于手机 → 软件信息 → 连点版本号 | 无额外设置 |
| OPPO/OnePlus | 设置 → 关于手机 → 版本信息 → 连点版本号 | 无额外设置 |
| vivo | 设置 → 更多设置 → 关于手机 → 连点软件版本号 | 部分机型需登录 vivo 账号 |

**验证连接成功：**

```powershell
adb devices
```

输出应显示设备 ID 和 `device` 状态。如果显示 `unauthorized`，在手机上确认授权弹窗。

### adb 自动查找顺序

validator 会按顺序自动查找：

1. `validator\tools\platform-tools\adb.exe`（`setup-adb.bat` 安装位置）
2. `ANDROID_HOME\platform-tools\adb.exe`
3. `ANDROID_SDK_ROOT\platform-tools\adb.exe`
4. `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`
5. `PATH` 里的 `adb`

Windows 上常见 ADB 路径：

```text
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
```

### 自动安装 adb

```powershell
cd .\legado-book-source-generator\validator
.\setup-adb.bat
```

`setup-adb.bat` 会从 Google 官方地址下载 Windows Platform-Tools，并解压到当前 Release 包的 `validator\tools\platform-tools\`。它不会把 `adb.exe` 提交进仓库，也不会写入系统目录。

### 手动配置

```powershell
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx ANDROID_SDK_ROOT "$env:LOCALAPPDATA\Android\Sdk"
setx PATH "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools"
```

设置用户环境变量后，新开的终端/程序才会继承。

### 安装并启动 Probe

```powershell
cd .\legado-book-source-generator\validator
.\setup-android-probe.bat
```

脚本会执行：

- 检查 `adb`，缺失时自动调用 `setup-adb.bat`
- 查找连接设备
- 安装 `android-probe.apk`
- 启动 `io.legado.probe/.WebViewProbeActivity`
- 建立 `localhost:18888 -> device:18888` 端口转发

### 没有设备时

validator 会返回：

```text
validator_limitation
Android Probe 不可用: No Android devices connected
```

这不是书源失败，而是当前电脑没有可用 Android WebView 复核环境。
