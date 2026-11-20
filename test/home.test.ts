import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { runInit } from "../src/cli/commands/init.js";
import { closeHomeEditors, createHomeApi, listWorlds } from "../src/cli/commands/home.js";

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "timewright-home-"));
}

const servers: Server[] = [];

after(async () => {
  await closeHomeEditors();
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

/** The home api speaks HTTP; give it a small server to answer on. */
async function serve(root: string): Promise<string> {
  const server = createServer((request, response) => {
    const raw = request.url ?? "/";
    const q = raw.indexOf("?");
    const url = q === -1 ? raw : raw.slice(0, q);
    const query = new URLSearchParams(q === -1 ? "" : raw.slice(q + 1));
    void createHomeApi(root)(request, response, url, query);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  servers.push(server);
  return `http://127.0.0.1:${port}`;
}

async function post(base: string, apiPath: string, body: unknown): Promise<Response> {
  return fetch(`${base}${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("home", () => {
  it("lists only folders that hold a world", async () => {
    const root = await scratch();
    await runInit({ folder: path.join(root, "napoleon") });
    await mkdir(path.join(root, "just-a-folder"));
    const worlds = await listWorlds(root);
    assert.equal(worlds.length, 1);
    assert.equal(worlds[0]?.folder, "napoleon");
    assert.equal(worlds[0]?.maps, 1);
  });

  it("creates worlds and rejects bad names", async () => {
    const root = await scratch();
    const base = await serve(root);
    const created = await post(base, "/api/worlds", { name: "my empire" });
    assert.equal(created.status, 200);
    const listed = await fetch(`${base}/api/worlds`);
    assert.equal(listed.status, 200);
    const data = (await listed.json()) as { worlds: Array<{ folder: string }> };
    assert.ok(data.worlds.some((world) => world.folder === "my empire"));
    const again = await post(base, "/api/worlds", { name: "my empire" });
    assert.equal(again.status, 400);
    for (const name of ["", "../escape", "con", "x/y", "."]) {
      const bad = await post(base, "/api/worlds", { name });
      assert.equal(bad.status, 400, `expected 400 for ${JSON.stringify(name)}`);
    }
  });

  it("starts one editor per world and reuses it", async () => {
    const root = await scratch();
    await runInit({ folder: path.join(root, "rome") });
    const base = await serve(root);
    const first = await post(base, "/api/edit", { folder: "rome" });
    assert.equal(first.status, 200);
    const url = ((await first.json()) as { url: string }).url;
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const second = await post(base, "/api/edit", { folder: "rome" });
    assert.equal(((await second.json()) as { url: string }).url, url);
    const outside = await post(base, "/api/edit", { folder: "../.." });
    assert.equal(outside.status, 400);
    const missing = await post(base, "/api/edit", { folder: "nope" });
    assert.equal(missing.status, 404);
  });
});
