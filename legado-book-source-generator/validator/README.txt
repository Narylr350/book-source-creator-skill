Legado 书源验证器 v1.0
========================

启动方式：
  node scripts/bsg.mjs validator-start，或命令行执行 java -jar app\legado-source-validator.jar
  打开浏览器访问 http://localhost:1111

需要：
  - Java 17 或更高版本
  - Android WebView Probe 可选需要 adb；运行 node scripts/bsg.mjs login 自动下载到 tools\platform-tools

用途：
  - 导入 book-source.json
  - 验证搜索、详情、目录、正文链路
  - 查看每步的请求、响应、抽取结果、正文预览

限制：
  - Android WebView / webJs 需 Android Probe 和已连接设备或模拟器
  - 不支持登录态 / CookieJar
  - 遇到 Cloudflare / 验证码 / 登录页时标记"需 App 复核"

Android Probe：
  1. 连接 Android 真机并打开 USB 调试，或启动 Android 模拟器
  2. 运行 node scripts/bsg.mjs login（自动下载 adb、安装 Probe APK、建立端口转发）
  3. 在手机上完成登录后，运行 node scripts/bsg.mjs resolve-user-action --action login_completed

bsg.mjs login 会从 Google 官方地址下载 Windows Platform-Tools（如本机无 adb），
解压到 validator\tools\platform-tools，不写入系统目录。

停止 Probe：
  node scripts/bsg.mjs validator-stop

样例书源：
  examples/biquges-com-book-source.json — 蚂蚁文学，搜索"凡人修仙传"可验证全链路
