import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { LegadoAppMcpClient, REQUIRED_JS_SOURCE_TOOLS } from "./app-mcp-client.mjs";
import { classifyAppMcpConnectionError, resolveAppMcpConnection } from "./app-mcp-connection.mjs";
import { fail, parseArg, writeJsonFile } from "./state.mjs";

function hasFlag(args, flag) {
  return args.includes(flag);
}

function sourceHash(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeManagedSource(content) {
  return String(content || "")
    .replaceAll("\r\n", "\n")
    .replace(/((?:["']?lastUpdateTime["']?)\s*:\s*)\d+/g, "$1<managed>")
    .trim();
}

function parseSavedUrl(text) {
  return text.match(/bookSourceUrl:\s*(\S+)/)?.[1] || null;
}

function parseGetSource(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function positiveCount(text, pattern) {
  const value = text.match(pattern)?.[1];
  return value != null && Number(value) > 0;
}

function debugEvidence(text) {
  const detailCompleted = /详情页解析完成/.test(text);
  const detailSkippedWithToc = /已获取目录链接\s*,?\s*跳过详情页/.test(text);
  const links = {
    search: /搜索页解析完成/.test(text) && positiveCount(text, /(?:JS源搜索完成,共|书籍总数:)(\d+)/),
    detail: detailCompleted || detailSkippedWithToc,
    toc: /目录页解析完成/.test(text) && positiveCount(text, /(?:JS源目录完成,共|目录总数:)(\d+)/),
    content: /正文页解析完成/.test(text) && positiveCount(text, /正文长度:(\d+)/),
  };
  return {
    links,
    detail: {
      status: detailCompleted ? "completed" : detailSkippedWithToc ? "skipped_with_toc_url" : "incomplete",
    },
  };
}

function checkPassed(text, sourceUrl) {
  return text.includes("通过 1/1") && text.includes(sourceUrl) && !text.includes("失败 1/1");
}

async function connect(options) {
  const client = new LegadoAppMcpClient(options);
  const initialized = await client.initialize();
  const tools = await client.listTools();
  const resources = await client.listResources();
  const toolNames = tools.map((tool) => tool.name);
  const missingTools = REQUIRED_JS_SOURCE_TOOLS.filter((name) => !toolNames.includes(name));
  const resourceUris = resources.map((resource) => resource.uri);
  const missingResources = resourceUris.includes("legado://help/jsHelp") ? [] : ["legado://help/jsHelp"];
  return { client, initialized, toolNames, resources, missingTools, missingResources };
}

export async function cmdAppMcp(args) {
  const subcommand = args[0];
  if (!subcommand || !["status", "help-js", "validate-js"].includes(subcommand)) {
    return fail("用法: bsg app-mcp status|help-js|validate-js [--url <mcp-url>] [--serial <adb-serial>] [--source <book-source.js>] [--keyword <关键词>] [--report <file>] [--keep-source]");
  }

  const connection = resolveAppMcpConnection(args.slice(1));
  if (connection.error) {
    return {
      ...fail(`Legado App MCP 连接失败: ${connection.error}`),
      nextAction: "stop",
      requiredUserAction: connection.requiredUserAction || "check_app_mcp_service",
      details: connection.details || null,
    };
  }

  try {
    const connected = await connect(connection);
    const { client, initialized, toolNames, resources, missingTools, missingResources } = connected;
  if (subcommand === "status") {
    return {
      ok: missingTools.length === 0 && missingResources.length === 0,
      backend: "legado_app_mcp",
      serverInfo: initialized?.serverInfo || client.serverInfo,
      protocolVersion: initialized?.protocolVersion || null,
      requiredTools: REQUIRED_JS_SOURCE_TOOLS,
      missingTools,
      missingResources,
      tools: toolNames,
      resources: resources.map((resource) => resource.uri),
      message: missingTools.length === 0 && missingResources.length === 0
        ? "Legado App MCP 已连接，JavaScript 单文件书源所需工具和帮助资源齐全。"
        : `Legado App MCP 能力不完整: ${[...missingTools, ...missingResources].join(", ")}`,
    };
  }

  if (subcommand === "help-js") {
    if (missingResources.length > 0) return fail("Legado App MCP 缺少 legado://help/jsHelp。");
    try {
      const contents = await client.readResource("legado://help/jsHelp");
      const text = contents.filter((item) => typeof item?.text === "string").map((item) => item.text).join("\n");
      if (!text.trim()) return fail("legado://help/jsHelp 返回空内容。");
      return {
        ok: true,
        backend: "legado_app_mcp",
        resource: "legado://help/jsHelp",
        serverInfo: initialized?.serverInfo || client.serverInfo,
        text,
      };
    } catch (error) {
      return fail(`读取 legado://help/jsHelp 失败: ${error.message}`);
    }
  }

  if (missingTools.length > 0 || missingResources.length > 0) {
    return fail(`Legado App MCP 缺少 JavaScript 验证能力: ${[...missingTools, ...missingResources].join(", ")}`);
  }
  const sourcePath = path.resolve(parseArg(args, "--source") || "book-source.js");
  if (!fs.existsSync(sourcePath)) return fail(`JavaScript 书源不存在: ${sourcePath}`);
  const keyword = parseArg(args, "--keyword") || "测试";
  const reportPath = path.resolve(parseArg(args, "--report") || path.join(path.dirname(sourcePath), "app-mcp-report.json"));
  const reportRunDir = path.dirname(reportPath);
  const keepSource = hasFlag(args, "--keep-source");
  const source = fs.readFileSync(sourcePath, "utf8");
  let savedUrl = null;
  let report;
  let cleanup = { attempted: false, confirmed: false, error: null };

  try {
    const saved = await client.callTool("save_source", { source, format: "js" });
    savedUrl = parseSavedUrl(saved.text);
    if (!savedUrl) throw new Error(`save_source 未返回 bookSourceUrl: ${saved.text.slice(0, 300)}`);

    const readBack = await client.callTool("get_source", { url: savedUrl });
    const stored = parseGetSource(readBack.text);
    if (!stored?.mainJs) throw new Error("get_source 未返回可读的 mainJs。" );

    const readBackMatches = normalizeManagedSource(stored.mainJs) === normalizeManagedSource(source);
    const debug = await client.callTool("debug_source", { url: savedUrl, key: keyword, timeoutSec: 120 });
    const debugResult = debugEvidence(debug.text);
    const links = debugResult.links;
    const checked = await client.callTool("check_source", { urls: [savedUrl] });
    let passed = readBackMatches && Object.values(links).every(Boolean) && checkPassed(checked.text, savedUrl);

    if (!keepSource) {
      cleanup.attempted = true;
      const deleted = await client.callTool("delete_sources", { urls: [savedUrl] });
      const remaining = await client.callTool("list_sources", { query: savedUrl });
      cleanup.confirmed = /已删除\s+1\s+个书源/.test(deleted.text) && /共\s*0\s*条/.test(remaining.text);
      if (!cleanup.confirmed) {
        cleanup.error = "App 未确认临时书源已删除。";
        passed = false;
      }
    }

    report = {
      _generatedBy: "bsg app-mcp validate-js",
      _schemaVersion: "1.0",
      _runDir: reportRunDir,
      backend: "legado_app_mcp",
      targetRuntime: "community_app",
      sourceFormat: "community_js",
      sourcePath,
      sourceHash: sourceHash(source),
      serverInfo: initialized?.serverInfo || client.serverInfo,
      protocolVersion: initialized?.protocolVersion || null,
      bookSourceUrl: savedUrl,
      saved: true,
      readBack: {
        present: true,
        matchesSourceExceptManagedTimestamp: readBackMatches,
        storedMainJsHash: sourceHash(stored.mainJs),
        appNormalizedSource: stored.mainJs !== source,
      },
      links,
      debug: {
        detail: debugResult.detail,
      },
      appCheck: {
        passed: checkPassed(checked.text, savedUrl),
        summary: checked.text.slice(0, 2000),
      },
      cleanup,
      sourceRetainedInApp: keepSource || !cleanup.confirmed,
      status: passed ? "passed" : "failed",
      generatedAt: new Date().toISOString(),
    };
    writeJsonFile(reportPath, report);
    return {
      ok: passed,
      status: report.status,
      backend: report.backend,
      sourceFormat: report.sourceFormat,
      bookSourceUrl: savedUrl,
      links,
      appCheck: report.appCheck,
      reportPath,
      sourceRetainedInApp: keepSource || !cleanup.confirmed,
      cleanup,
      message: passed
        ? "社区版 Legado App 已完成 JavaScript 书源保存、读回、四链路调试和校验。"
        : "社区版 Legado App 验证未通过；查看 app-mcp-report.json，不得降级为本地 Validator 结论。",
    };
  } catch (error) {
    report = {
      _generatedBy: "bsg app-mcp validate-js",
      _schemaVersion: "1.0",
      _runDir: reportRunDir,
      backend: "legado_app_mcp",
      targetRuntime: "community_app",
      sourceFormat: "community_js",
      sourcePath,
      sourceHash: sourceHash(source),
      serverInfo: initialized?.serverInfo || client.serverInfo,
      bookSourceUrl: savedUrl,
      status: "failed",
      error: error.message,
      cleanup,
      sourceRetainedInApp: keepSource || !cleanup.confirmed,
      generatedAt: new Date().toISOString(),
    };
    if (savedUrl && !keepSource && !cleanup.confirmed) {
      cleanup.attempted = true;
      try {
        const deleted = await client.callTool("delete_sources", { urls: [savedUrl] });
        const remaining = await client.callTool("list_sources", { query: savedUrl });
        cleanup.confirmed = /已删除\s+1\s+个书源/.test(deleted.text) && /共\s*0\s*条/.test(remaining.text);
        cleanup.error = cleanup.confirmed ? null : "App 未确认临时书源已删除。";
      } catch (cleanupError) {
        cleanup.error = cleanupError.message;
      }
      report.cleanup = cleanup;
      report.sourceRetainedInApp = keepSource || !cleanup.confirmed;
    }
    writeJsonFile(reportPath, report);
    return fail(`社区版 Legado App 验证失败: ${error.message}。报告: ${reportPath}`);
  }
  } catch (error) {
    const classified = classifyAppMcpConnectionError(error);
    return {
      ...fail(`Legado App MCP 连接失败: ${classified.message}`),
      nextAction: "stop",
      requiredUserAction: classified.requiredUserAction,
    };
  } finally {
    connection.cleanup();
  }
}
