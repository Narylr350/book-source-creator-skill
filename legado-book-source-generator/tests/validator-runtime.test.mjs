import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";

import { reserveAvailablePort, resolveValidatorUrl } from "../scripts/lib/validator-runtime.mjs";

describe("validator runtime", () => {
  it("reserves an operating-system-selected loopback port", async () => {
    const port = await reserveAvailablePort();
    assert.ok(Number.isInteger(port));
    assert.ok(port > 0 && port <= 65535);

    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => server.close(resolve));
    });
  });

  it("uses an explicit validator URL when configured", () => {
    const previous = process.env.VALIDATOR_URL;
    process.env.VALIDATOR_URL = "http://127.0.0.1:54321/";
    try {
      assert.equal(resolveValidatorUrl(), "http://127.0.0.1:54321");
    } finally {
      if (previous == null) delete process.env.VALIDATOR_URL;
      else process.env.VALIDATOR_URL = previous;
    }
  });
});
