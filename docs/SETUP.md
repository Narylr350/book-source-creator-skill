# Browser MCP、Validator 与 Android Probe 环境配置

## Browser MCP（必需）

书源生成开始前必须具备可导航网页、获取页面快照并执行交互的 Browser MCP。它负责首轮站点观察和 search/detail/toc/content 链路取证。

执行者应先检查当前客户端的 MCP 配置并完成安装或连接。只有以下步骤需要本人参与：

- 批准 MCP 安装或权限请求
- 按客户端要求重启或重新加载
- 当前客户端不支持浏览器工具时，选择支持 Browser MCP 的客户端

配置完成后先打开用户提供的目标 URL，确认导航、snapshot 和页面交互均可用，再开始 search/detail/toc/content 链路取证。

---

## validator（HTTP / Browser 验证）

必需：

- Node.js 18+
- Java 17+
- 可访问目标网站的网络环境

启动（以下路径适用于 Release 包；clone 仓库开发的见 `validator/` 根目录下的同名 bat）：

```powershell
cd .\legado-book-source-generator\validator
.\run.bat
```

启动命令会输出本次 validator 的 `url`。浏览器打开该地址；端口由工具自动选择。

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

传统 JSON 书源默认兼容原版最后版本。该版本没有可供工具调用的完整书源开发 API，因此本项目使用 Android Probe 复核 WebView 行为。Probe 是一个轻量 Android APK，只运行一个 WebView，并通过 `/render` 接口让 validator 自动完成渲染、JS 执行、截图和正文提取。

社区维护版阅读 App 另有原生 MCP，可直接保存、读回、调试和校验 JavaScript 单文件书源。它是可选目标，不替代默认 JSON 流程；只有用户明确面向社区维护版且 App MCP 可用时才使用。

**四者关系：**
- **validator HTTP 模式**：验证传统 JSON 书源的非 CSR 链路
- **validator Android Probe**：复核传统 JSON 书源涉及的 Android WebView 行为
- **社区维护版 App MCP**：执行并验证 JavaScript 单文件书源
- **阅读 App 人工验收**：确认真实阅读体验、交互和长期行为

Probe 运行在真实 Android WebView 上，比桌面 Browser 模式更接近阅读 App WebView 环境，但仍不等于阅读 App 100% 通过。

## 社区维护版阅读 App MCP（JavaScript 单文件书源，可选）

目标 App 需要启用 `MCP service`，默认端口为 `1236`。连接了唯一一台 adb 设备时，`app-mcp` 会自动建立临时端口转发并在命令结束后移除；无需查设备 IP 或启动额外服务。多设备环境可传 `--serial <adb-serial>`，不使用 adb 时可传 `--url http://<设备IP>:1236/mcp`。

App 配置了 Web/MCP 访问令牌时，在当前进程设置 `LEGADO_MCP_TOKEN`。令牌不写入 run 目录、issue、日志或调试包。AI 先自动运行 `app-mcp status`；只有 App 服务未开启、设备未授权、需要选择设备或需要本人提供令牌时才暂停。

`validate-js` 会调用目标 App 的 `save_source`、`get_source`、`debug_source` 和 `check_source`，默认验证后删除 App 内临时书源。缺少 App MCP 时不使用本地 validator 替代 JavaScript 单文件书源验证。


`android --run` 会先统一电脑和模拟器的代理状态，并用中性 HTTPS 页面检查设备网络。本机 HTTP/HTTPS 代理和带可用 HTTP/mixed 监听端口的 TUN 可自动映射到模拟器；真机、SOCKS、带凭据代理或无法映射的 TUN 会明确停在网络配置步骤，不会把超时误判成目标站问题。

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
