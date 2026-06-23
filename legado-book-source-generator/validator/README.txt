Legado 书源验证器 v1.0
========================

启动方式：
  node "<skill-dir>/scripts/bsg.mjs" validator-start，或命令行执行 java -jar app\legado-source-validator.jar
  打开浏览器访问 http://localhost:1111

需要：
  - Java 17 或更高版本
  - Android WebView Probe 可选需要 adb；运行 node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir> 走单入口

用途：
  - 导入 book-source.json
  - 验证搜索、详情、目录、正文链路
  - 查看每步的请求、响应、抽取结果、正文预览
  - 输出 validator-report.json，供 bsg.mjs record-validation 收敛最终状态

限制：
  - Android WebView / webJs 需 Android Probe 和已连接设备或模拟器
  - 登录态 / CookieJar 需通过 cookies.json 或 Android Probe 证据进入报告
  - 遇到 Cloudflare / 验证码 / 登录页时记录 blocker；最终状态由 bsg.mjs record-validation 收敛

Android Probe：
  1. 连接 Android 真机并打开 USB 调试，或启动 Android 模拟器
  2. 运行 node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir>（检查设备、启动 Probe、打开登录页）
  3. 在手机上完成登录后，运行 node "<skill-dir>/scripts/bsg.mjs" android --run <run-dir> --login-completed

诊断入口：
  - Android/Probe 状态：node "<skill-dir>/scripts/bsg.mjs" android-status
  - Probe ping：http://127.0.0.1:18888/ping，应返回 pong
  - Probe info：http://127.0.0.1:18888/info
  - Probe Cookie：http://127.0.0.1:18888/cookie-check?domain=<目标域名>
  - Probe render：POST http://127.0.0.1:18888/render 必须带 JSON 字段 timeout，例如 {"url":"https://example.com","timeout":60000,"screenshot":false}
  - Validator API：http://localhost:1111/api/debug/run

调试原则：
  - adb、Probe API、curl 可以用于定位问题，但不能替代 bsg.mjs android / record-validation 的最终收敛
  - Probe 返回 Timeout after 0ms 时，先检查 /render 请求体是否漏传 timeout，不要直接判断 WebView 坏了
  - PC HTTP / Browser passed 只算开发辅助；Android 可用时最终 passed 必须来自 Android mode
  - screenshot 或 rendered HTML 只能证明页面渲染过，正文可用还要看 extracted/contentPreview/contentLength

如本机无 adb，Android 入口会提示安装/配置 Platform-Tools；工具解压到
validator\tools\platform-tools，不写入系统目录。

停止 Probe：
  node "<skill-dir>/scripts/bsg.mjs" validator-stop

样例书源：
  examples/biquges-com-book-source.json — 蚂蚁文学，搜索"凡人修仙传"可验证全链路
