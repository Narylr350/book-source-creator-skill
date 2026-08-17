import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cmdAppMcp } from "../scripts/lib/app-mcp-command.mjs";

const TOOL_NAMES = ["save_source", "debug_source", "list_sources", "get_source", "delete_sources", "check_source"];

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

async function withMockedMcp(testFn) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.LEGADO_MCP_URL;
  const originalToken = process.env.LEGADO_MCP_TOKEN;
  const calls = [];
  let savedSource = "";
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    if (payload.method === "initialize") {
      return jsonResponse({ result: { protocolVersion: "2025-03-26", serverInfo: { name: "legado", version: "test" } } }, { "Mcp-Session-Id": "session" });
    }
    if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (payload.method === "tools/list") return jsonResponse({ result: { tools: TOOL_NAMES.map((name) => ({ name })) } });
    if (payload.method === "resources/list") return jsonResponse({ result: { resources: [{ uri: "legado://help/jsHelp" }] } });
    if (payload.method === "resources/read") return jsonResponse({ result: { contents: [{ uri: payload.params.uri, text: "current app js help" }] } });
    const { name, arguments: args } = payload.params;
    calls.push(name);
    if (name === "save_source") {
      savedSource = args.source;
      return jsonResponse({ result: { content: [{ type: "text", text: "已保存：Test\nbookSourceUrl: https://local.test/test" }] } });
    }
    if (name === "get_source") {
      return jsonResponse({ result: { content: [{ type: "text", text: JSON.stringify({ mainJs: savedSource.replace(/lastUpdateTime:\s*\d+/, "lastUpdateTime: 999") }) }] } });
    }
    if (name === "debug_source") {
      return jsonResponse({ result: { content: [{ type: "text", text: "JS源搜索完成,共1条\n搜索页解析完成\n已获取目录链接,跳过详情页\nJS源目录完成,共1章\n目录页解析完成\n正文长度:26\n正文页解析完成" }] } });
    }
    if (name === "check_source") {
      return jsonResponse({ result: { content: [{ type: "text", text: "失败 0/1:\n(无)\n\n通过 1/1:\n[通过] Test(https://local.test/test)" }] } });
    }
    if (name === "delete_sources") {
      return jsonResponse({ result: { content: [{ type: "text", text: "已删除 1 个书源" }] } });
    }
    return jsonResponse({ result: { content: [{ type: "text", text: "共 0 条\n[]" }] } });
  };
  process.env.LEGADO_MCP_URL = "http://test/mcp";
  process.env.LEGADO_MCP_TOKEN = "test-token";
  try {
    return await testFn(calls);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl == null) delete process.env.LEGADO_MCP_URL; else process.env.LEGADO_MCP_URL = originalUrl;
    if (originalToken == null) delete process.env.LEGADO_MCP_TOKEN; else process.env.LEGADO_MCP_TOKEN = originalToken;
  }
}

describe("community JS MCP validation contract", () => {
  it("reads the current App JavaScript help without writing a copy", async () => {
    await withMockedMcp(async () => {
      const result = await cmdAppMcp(["help-js"]);
      assert.equal(result.ok, true);
      assert.equal(result.resource, "legado://help/jsHelp");
      assert.equal(result.text, "current app js help");
    });
  });

  it("accepts only the App-managed timestamp change and confirms cleanup", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "app-mcp-command-"));
    try {
      const sourcePath = path.join(tmp, "source.js");
      const reportPath = path.join(tmp, "report.json");
      await fs.writeFile(sourcePath, `var config = { bookSourceUrl: "https://local.test/test", bookSourceName: "Test", lastUpdateTime: 1 };\nfunction search(key, page) { return []; }`, "utf8");
      await withMockedMcp(async (calls) => {
        const result = await cmdAppMcp(["validate-js", "--source", sourcePath, "--keyword", "Test", "--report", reportPath]);
        assert.equal(result.ok, true);
        assert.equal(result.status, "passed");
        assert.equal(result.cleanup.confirmed, true);
        assert.equal(result.sourceRetainedInApp, false);
        assert.deepEqual(calls, ["save_source", "get_source", "debug_source", "check_source", "delete_sources", "list_sources"]);
        const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
        assert.equal(report._runDir, tmp);
        assert.equal(report.readBack.matchesSourceExceptManagedTimestamp, true);
        assert.equal(report.debug.detail.status, "skipped_with_toc_url");
        assert.equal(report.links.detail, true);
        assert.equal(report.cleanup.confirmed, true);
      });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("allows a direct App connection without forcing a token", async () => {
    const oldUrl = process.env.LEGADO_MCP_URL;
    const oldToken = process.env.LEGADO_MCP_TOKEN;
    process.env.LEGADO_MCP_URL = "http://192.168.1.20:1236/mcp";
    delete process.env.LEGADO_MCP_TOKEN;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      const payload = JSON.parse(options.body);
      if (payload.method === "initialize") return jsonResponse({ result: { protocolVersion: "2025-03-26", serverInfo: { name: "legado" } } });
      if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (payload.method === "tools/list") return jsonResponse({ result: { tools: TOOL_NAMES.map((name) => ({ name })) } });
      return jsonResponse({ result: { resources: [{ uri: "legado://help/jsHelp" }] } });
    };
    try {
      const result = await cmdAppMcp(["status"]);
      assert.equal(result.ok, true);
    } finally {
      globalThis.fetch = originalFetch;
      if (oldUrl == null) delete process.env.LEGADO_MCP_URL; else process.env.LEGADO_MCP_URL = oldUrl;
      if (oldToken == null) delete process.env.LEGADO_MCP_TOKEN; else process.env.LEGADO_MCP_TOKEN = oldToken;
    }
  });
});
