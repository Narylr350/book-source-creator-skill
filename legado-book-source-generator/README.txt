Legado 书源生成与验证工具
==========================

一个用于生成和验证 Legado/阅读书源的 AI Skill，内置本地 validator。

## 这是什么

- AI 辅助分析小说站点结构，自动生成 Legado 书源 JSON
- 内置本地 validator，可在电脑浏览器中验证书源的搜索、详情、目录、正文链路
- 验证失败时 AI 自动回修规则，只有硬边界（验证码/登录/Cloudflare/WebView/付费）才需人工复核

## 快速开始

1. 解压本 zip
2. 双击 validator\run.bat，等待窗口显示服务地址
3. 浏览器打开 http://localhost:1111
4. 让 Claude/Codex 使用本目录作为 skill 目录
5. 给出小说站点 URL，AI 会自动生成书源并验证
6. 生成的书源在 outputs\<站点>\book-source.json

## 停止服务

- 在 run.bat 窗口按 Ctrl+C
- 或双击 validator\stop.bat

## 结果状态说明

- passed：validator 全链路通过（search→detail→toc→content）
- degraded：技术链路通过但阅读体验降级（如章节 URL 不可区分）
- validator_limitation：validator 不支持该能力，需 App/WebView 复核
- needs_app_review：验证码、登录、Cloudflare、WebView、付费等需人工或 App 复核
- failed：AI 回修后仍未通过，需人工检查

## 目录结构

```
legado-book-source-generator\
  SKILL.md                    # AI Skill 主文件
  references\                 # 参考文档（工作流、策略、模板等）
  scripts\                    # 辅助脚本
  tests\                      # 测试
  validator\                  # 内置 validator
    run.bat                   # 启动服务
    stop.bat                  # 停止服务
    app\                      # JAR 文件
    examples\                 # 测试样例（sources/cases/candidates）
```

## 免责声明

- 本项目不是 Legado/阅读 官方项目，与原 App 作者、维护者及任何站点无从属、授权或背书关系。
- 本项目只用于辅助分析用户有权访问的网站结构，并生成/验证书源规则。
- 本项目不提供、不托管、不分发任何小说正文内容。
- 本项目不提供绕过验证码、登录限制、付费墙、会员权限、DRM、反爬或访问控制的能力。
- 对需要登录、验证码、Cloudflare、Android WebView、webJs、CookieJar、付费或 App-only 行为的站点，工具只能标记需复核，不能保证可用。
- 使用者应自行确认目标站点的服务条款、版权状态、访问权限和当地法律法规。
- 生成的书源仅供个人学习、调试和兼容性验证；不得用于侵权传播、批量抓取、商业分发或规避平台限制。
- AI 生成结果可能错误；validator passed 只代表当前链路验证通过，不代表长期可用、合法可用或阅读体验完整。
