#!/usr/bin/env node

import http from "node:http";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

const upstreamUrl = new URL(requiredEnvironment("LEGADO_MCP_UPSTREAM_URL"));
const upstreamToken = requiredEnvironment("LEGADO_MCP_TOKEN");
const requestedPort = Number(process.env.LEGADO_MCP_RELAY_PORT || 0);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  throw new Error("LEGADO_MCP_RELAY_PORT 必须是 0-65535 的整数");
}

const server = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/mcp") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);

  try {
    const headers = new Headers();
    for (const name of ["accept", "content-type", "mcp-session-id"]) {
      const value = request.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    headers.set("X-Legado-Token", upstreamToken);

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: Buffer.concat(chunks),
    });
    const responseHeaders = {};
    for (const name of ["content-type", "mcp-session-id", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    response.writeHead(upstream.status, responseHeaders);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: `upstream_failed: ${error.message}` }));
  }
});

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(JSON.stringify({
    ok: true,
    relayUrl: `http://127.0.0.1:${address.port}/mcp`,
    pid: process.pid,
  }) + "\n");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
