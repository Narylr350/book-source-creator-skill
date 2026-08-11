Legado 书源验证器 v1.0
========================

启动方式：
  双击 run.bat；停止时双击 stop.bat
  启动结果会输出本次服务地址，浏览器打开其中的 url

需要：
  - Node.js 18 或更高版本
  - Java 17 或更高版本
  - Android WebView Probe 可选需要 adb；可双击 setup-adb.bat 自动下载到 tools\platform-tools

用途：
  - 导入 book-source.json
  - 验证搜索、详情、目录、正文链路
  - 查看每步的请求、响应、抽取结果、正文预览

限制：
  - Android WebView / webJs 需 Android Probe 和已连接设备或模拟器
  - 不支持登录态 / CookieJar
  - 遇到 Cloudflare / 验证码 / 登录页时标记"需 App 复核"

Android Probe：
  1. 双击 setup-adb.bat（如本机已有 adb 可跳过）
  2. 插入 Android 真机并打开 USB 调试，或启动 Android 模拟器
  3. 双击 setup-android-probe.bat

setup-adb.bat 会从 Google 官方地址下载 Windows Platform-Tools，
解压到当前目录 tools\platform-tools，不写入系统目录。

样例书源：
  examples/biquges-com-book-source.json — 蚂蚁文学，搜索"凡人修仙传"可验证全链路
