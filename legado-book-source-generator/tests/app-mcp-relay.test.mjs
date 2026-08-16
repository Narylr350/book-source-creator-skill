import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";

const RELAY = path.resolve(import.meta.dirname, "..", "scripts", "app-mcp-relay.mjs");
const children = [];
const servers = [];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function firstStdoutLine(child) {
  const lines = readline.createInterface({ input: child.stdout });
  return new Promise((resolve, reject) => {
    const onExit = (code) => reject(new Error(`relay exited before ready: ${code}`));
    child.once("exit", onExit);
    lines.once("line", (line) => {
      child.off("exit", onExit);
      lines.close();
      resolve(line);
    });
  });
}

afterEach(async () => {
  while (children.length > 0) {
    const child = children.pop();
    if (child.exitCode == null) child.kill();
  }
  while (servers.length > 0) await closeServer(servers.pop());
});

describe("App MCP credential relay", () => {
  it("injects the token upstream while exposing only a loopback URL", async () => {
    let receivedToken = null;
    const upstream = http.createServer(async (request, response) => {
      receivedToken = request.headers["x-legado-token"];
      for await (const _chunk of request) { /* drain */ }
      response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "relay-session" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    });
    servers.push(upstream);
    const address = await listen(upstream);

    const child = spawn(process.execPath, [RELAY], {
      env: {
        ...process.env,
        LEGADO_MCP_UPSTREAM_URL: `http://127.0.0.1:${address.port}/mcp`,
        LEGADO_MCP_TOKEN: "relay-secret",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    children.push(child);
    const ready = JSON.parse(await firstStdoutLine(child));

    assert.equal(ready.ok, true);
    assert.match(ready.relayUrl, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    assert.doesNotMatch(ready.relayUrl, /relay-secret/);

    const response = await fetch(ready.relayUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("mcp-session-id"), "relay-session");
    assert.equal(receivedToken, "relay-secret");
  });
});
