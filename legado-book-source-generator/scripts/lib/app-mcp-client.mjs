function parseMcpResponse(text, contentType, expectedId = null) {
  if (!text.trim()) return null;
  if (!String(contentType || "").includes("text/event-stream")) return JSON.parse(text);

  const messages = text.split(/\r?\n\r?\n/).map((block) => block.trim()).filter(Boolean)
    .map((event) => event.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n"))
    .filter((data) => data && data !== "[DONE]")
    .map((data) => JSON.parse(data));
  if (expectedId != null) {
    return messages.find((message) => message?.id === expectedId) || null;
  }
  return messages.find((message) => "result" in message || "error" in message) || messages[0] || null;
}

function toolText(result) {
  return (result?.content || [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text || "")
    .join("\n");
}

export class LegadoAppMcpClient {
  constructor({ url, token, timeoutMs = 120000, fetchImpl = fetch }) {
    this.url = url;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.sessionId = null;
    this.nextId = 1;
    this.serverInfo = null;
  }

  headers() {
    return {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(this.token ? { "X-Legado-Token": this.token } : {}),
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
    };
  }

  async post(payload, expectResponse = true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Legado MCP HTTP ${response.status}: ${body.slice(0, 500)}`);
      }
      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId) this.sessionId = sessionId;
      if (!expectResponse || response.status === 202 || response.status === 204) return null;
      return parseMcpResponse(await response.text(), response.headers.get("content-type"), payload.id ?? null);
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize() {
    const response = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "legado-book-source-generator", version: "2.2.0" },
      },
    });
    if (response?.error) throw new Error(response.error.message || "Legado MCP initialize failed");
    this.serverInfo = response?.result?.serverInfo || null;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, false);
    return response?.result || null;
  }

  async request(method, params = {}) {
    const response = await this.post({ jsonrpc: "2.0", id: this.nextId++, method, params });
    if (response?.error) throw new Error(response.error.message || `${method} failed`);
    return response?.result;
  }

  async listTools() {
    const result = await this.request("tools/list");
    return result?.tools || [];
  }

  async listResources() {
    const result = await this.request("resources/list");
    return result?.resources || [];
  }

  async readResource(uri) {
    const result = await this.request("resources/read", { uri });
    return result?.contents || [];
  }

  async callTool(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    if (result?.isError) throw new Error(toolText(result) || `${name} failed`);
    return { result, text: toolText(result) };
  }
}

export const REQUIRED_JS_SOURCE_TOOLS = [
  "save_source",
  "debug_source",
  "list_sources",
  "get_source",
  "delete_sources",
  "check_source",
];
