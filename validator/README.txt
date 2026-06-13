Legado 书源验证器 v1.0
========================

启动方式：
  双击 run.bat，或命令行执行 java -jar app\legado-source-validator.jar
  打开浏览器访问 http://localhost:1111

需要 Java 17 或更高版本。

用途：
  - 导入 book-source.json
  - 验证搜索、详情、目录、正文链路
  - 查看每步的请求、响应、抽取结果、正文预览

限制：
  - 不支持 Android WebView / webJs
  - 不支持登录态 / CookieJar
  - 遇到 Cloudflare / 验证码 / 登录页时标记"需 App 复核"

样例书源：
  examples/biquges-com-book-source.json — 蚂蚁文学，搜索"凡人修仙传"可验证全链路
