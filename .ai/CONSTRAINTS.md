# Constraints

## 硬约束（不可违反）

1. **`bsg.mjs deliver --run <run-dir>` 返回 ok 是书源生成任务完成的唯一标志**。没有第三种状态。绕过 deliver 交 JSON 文件视为未完成。
2. **validator 等价于阅读 App**。validator 过不了 = 阅读 App 也过不了。不存在"validator 过不了但 App 能过"的中间地带。
3. **验证码/Cloudflare/付费墙不是 `needs_app_review`**。App 同样会触发。这些是 `failed` 或 `degraded`。`needs_app_review` 仅用于 validator 能力不足（如 sourceRegex 嗅探）。
4. **`run-state.json` 由命令写入，禁止手动编辑**。有 SHA256 签名校验。
5. **修改 `book-source.json` 后必须重新通过 rule-check 和 validator**，不能复用旧报告。
6. **结论强度必须匹配证据强度**。源码和真实工具输出优先于推理。代理工具的实测不等价于目标工具的实测。
7. **最终交付结论优先来自 Android/真机**。桌面 HTTP/Browser 只能辅助写规则。没有设备时如实降级标注。
8. **不绕过验证码、Cloudflare、付费墙、DRM**。只标记阻塞并报告限制。

## 工作规则

- 每次改动只动必要范围，匹配既有风格；不顺手重构无关代码。
- 不要为一次性代码创建抽象。不要添加未要求的灵活性。
- 项目特定事实写入仓库文档或项目 `AGENTS.md`，不存入对话记忆。
- 临时文件放入 Windows temp 目录或用完删除。软件进程用后关闭。
- 涉及 WebView、webJs、登录态时 Android/真机证据优先；没有 Android 环境时只能降级说明。
- 环境不可用时 AI 先尝试可逆修复；涉及凭据、权限、全局安装时再提示用户。

## 红旗（源自 SKILL.md）

A. **证据强度要匹配结论强度**。未验证的不当已验证，弱证据不下强结论。
B. **书源最终在阅读 App 跑**。最高权威证据来自 Android/真机，不用低权威环境冒充交付结论。
C. **判定站点性质用对证据类型**。判 SSR/CSR 看 HTTP 原始响应（浏览器看到的是渲染后 DOM）。反复探测反爬端点会累积触发风控。
