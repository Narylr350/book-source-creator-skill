import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LegadoAppMcpClient, REQUIRED_JS_SOURCE_TOOLS } from "../scripts/lib/app-mcp-client.mjs";

function response(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("LegadoAppMcpClient", () => {
  it("initializes, preserves the session, and lists tools/resources", async () => {
    const requests = [];
    const client = new LegadoAppMcpClient({
      url: "http://127.0.0.1:1236/mcp",
      token: "test-token",
      fetchImpl: async (_url, options) => {
        const payload = JSON.parse(options.body);
        requests.push(payload);
        if (payload.method === "initialize") {
          return response({
            jsonrpc: "2.0",
            id: payload.id,
            result: {
              protocolVersion: "2025-03-26",
              serverInfo: { name: "legado", version: "3.test" },
            },
          }, { "Mcp-Session-Id": "session-1" });
        }
        if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (payload.method === "tools/list") {
          return response({ result: { tools: REQUIRED_JS_SOURCE_TOOLS.map((name) => ({ name })) } });
        }
        if (payload.method === "resources/read") {
          return response({ result: { contents: [{ uri: payload.params.uri, text: "js help" }] } });
        }
        return response({ result: { resources: [{ uri: "legado://help/jsHelp" }] } });
      },
    });

    const initialized = await client.initialize();
    assert.equal(initialized.serverInfo.version, "3.test");
    assert.deepEqual(await client.listTools(), REQUIRED_JS_SOURCE_TOOLS.map((name) => ({ name })));
    assert.deepEqual(await client.listResources(), [{ uri: "legado://help/jsHelp" }]);
    assert.deepEqual(await client.readResource("legado://help/jsHelp"), [{ uri: "legado://help/jsHelp", text: "js help" }]);
    assert.equal(client.sessionId, "session-1");
    assert.equal(requests[2].method, "tools/list");
  });

  it("parses event-stream JSON responses", async () => {
    const client = new LegadoAppMcpClient({
      url: "http://127.0.0.1:1236/mcp",
      token: "test-token",
      fetchImpl: async () => new Response("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]}}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    });
    const result = await client.request("tools/call", { name: "ping" });
    assert.equal(result.content[0].text, "ok");
  });
});
