import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IncomingMessage } from "node:http";

import { requestIsAllowed } from "../src/cli/local-server.js";

/**
 * The server listens on the loopback address, but a page in the user's
 * browser can still reach it. These are the headers that tell the two
 * apart.
 */
function request(headers: Record<string, string | undefined>, method = "POST"): IncomingMessage {
  return { method, headers } as unknown as IncomingMessage;
}

const HOST = "127.0.0.1";
const PAGE = "http://127.0.0.1:5175";

describe("the local server's requests", () => {
  it("takes a request from the page it served", () => {
    assert.equal(
      requestIsAllowed(request({ host: "127.0.0.1:5175", origin: PAGE }), HOST),
      true,
    );
  });

  it("takes a request with no Origin, which is a local program", () => {
    assert.equal(requestIsAllowed(request({ host: "127.0.0.1:5175" }), HOST), true);
  });

  it("turns away a request from another site", () => {
    assert.equal(
      requestIsAllowed(request({ host: "127.0.0.1:5175", origin: "https://elsewhere.example" }), HOST),
      false,
    );
  });

  it("turns away a request whose Origin is opaque", () => {
    assert.equal(
      requestIsAllowed(request({ host: "127.0.0.1:5175", origin: "null" }), HOST),
      false,
    );
  });

  it("turns away a name pointed at this machine", () => {
    // The rebound-name case: the name is not ours, whatever it resolves to.
    assert.equal(
      requestIsAllowed(request({ host: "elsewhere.example", origin: "http://elsewhere.example" }), HOST),
      false,
    );
  });

  it("turns away a request with no Host", () => {
    assert.equal(requestIsAllowed(request({}, "GET"), HOST), false);
  });

  it("reads a page without an Origin", () => {
    // A browser does not send Origin on a same-origin GET.
    assert.equal(
      requestIsAllowed(request({ host: "127.0.0.1:5175" }, "GET"), HOST),
      true,
    );
  });

  it("takes the machine's own name", () => {
    assert.equal(
      requestIsAllowed(request({ host: "localhost:5175", origin: "http://localhost:5175" }), HOST),
      true,
    );
  });

  it("turns away a write that names another host", () => {
    assert.equal(
      requestIsAllowed(request({ host: "elsewhere.example", origin: "http://elsewhere.example" }), HOST),
      false,
    );
  });
});
