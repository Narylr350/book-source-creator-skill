import fs from "node:fs";
import path from "node:path";
import { deriveSiteSlug } from "./slug.mjs";

const OUTPUT_FILENAMES = [
  "assessment.md",
  "analysis.md",
  "book-source.json",
  "validation-checklist.md",
];

export function initializeOutputBundle(rootDir, siteUrl) {
  const bundleDir = path.join(rootDir, deriveSiteSlug(siteUrl));
  fs.mkdirSync(bundleDir, { recursive: true });

  const templates = {
    "assessment.md": [
      "# 网站可生成性评估",
      "",
      "- 目标站点: ",
      `- 站点 URL: ${siteUrl}`,
      "- 登录需求: ",
      "- 用户选择: 登录分析 / 不登录分析",
      "- 当前分析会话: 匿名 / 已登录 / 登录失败",
      "- 评级: 可直接生成 / 可生成但高风险 / 需登录后再评估 / 不建议生成",
      "- 是否高风险: 是 / 否",
      "- 官方规则对照: 已完成 / 未完成",
      "- 辅助文档对照: 已完成 / 未完成",
      "",
      "## 结论",
      "",
      "- 继续生成: 是 / 否",
      "- 继续生成理由: ",
      "",
      "## 关键依据",
      "",
      "- 搜索链路: ",
      "- 详情链路: ",
      "- 目录链路: ",
      "- 正文链路: ",
      "",
      "## 风险与阻塞",
      "",
      "- 反爬或验证码: ",
      "- 会员限制: ",
      "- 动态签名或加密: ",
      "- 支付限制: ",
      "- 其他阻塞点: ",
      "- `P15(WebView)` 是否已排除: ",
      "- 更低复杂度回退是否已排除: ",
      "",
      "## 预期失效环节",
      "",
      "- 若继续生成，最可能失败的链路: ",
      "- 失败原因: ",
      "",
    ].join("\n"),
    "analysis.md": [
      "# 网站分析",
      "",
      "## 搜索",
      "",
      "- 页面入口或触发方式: ",
      "- 请求链路或接口来源: ",
      "- 稳定抓取依据: ",
      "- 风险点: ",
      "- Legado 规则建议: ",
      "",
      "## 详情",
      "",
      "- 页面入口或触发方式: ",
      "- 请求链路或接口来源: ",
      "- 稳定抓取依据: ",
      "- 风险点: ",
      "- Legado 规则建议: ",
      "",
      "## 目录",
      "",
      "- 页面入口或触发方式: ",
      "- 请求链路或接口来源: ",
      "- 稳定抓取依据: ",
      "- 风险点: ",
      "- Legado 规则建议: ",
      "",
      "## 正文",
      "",
      "- 页面入口或触发方式: ",
      "- 请求链路或接口来源: ",
      "- 稳定抓取依据: ",
      "- 风险点: ",
      "- Legado 规则建议: ",
      "",
    ].join("\n"),
    "book-source.json": "[]\n",
    "validation-checklist.md": [
      "# Legado 验收清单",
      "",
      "1. 导入 `book-source.json`",
      "2. 验证搜索结果可返回目标书籍",
      "3. 验证详情页元数据可展示",
      "4. 验证目录可正常加载",
      "5. 验证至少两章正文可正常打开",
      "6. 记录失败链路并回修规则",
      "",
    ].join("\n"),
  };

  for (const filename of OUTPUT_FILENAMES) {
    const filePath = path.join(bundleDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, templates[filename], "utf8");
    }
  }

  return bundleDir;
}
