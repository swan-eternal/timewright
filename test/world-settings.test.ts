import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createEditorApi } from "../src/cli/commands/edit.js";
import { loadWorld } from "../src/cli/load.js";
import { writeWorldTheme } from "../src/cli/world-edit.js";

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tw-world-settings-"));
}

/** A world with a map and an event, plus comments worth keeping. */
async function world(): Promise<string> {
  const root = await scratch();
  await mkdir(path.join(root, "maps"), { recursive: true });
  await mkdir(path.join(root, "events"), { recursive: true });
  await writeFile(path.join(root, "world.yaml"), "# the world\ntitle: T # keep me\nstart: 1800\n");
  await writeFile(path.join(root, "maps", "m.yaml"), "- id: m\n  name: M\n  size: [10,10]\n");
  await writeFile(path.join(root, "events", "events.yaml"), '- title: Battle\n  when: "1815"\n');
  return root;
}

function post(body: unknown): IncomingMessage {
  const payload = Buffer.from(JSON.stringify(body));
  return {
    method: "POST",
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield payload;
    },
  } as unknown as IncomingMessage;
}

function get(): IncomingMessage {
  return { method: "GET", headers: {} } as unknown as IncomingMessage;
}

function capture(): { response: ServerResponse; json: () => any } {
  let body = "";
  const response = {
    statusCode: 200,
    setHeader() {},
    end(chunk?: string) {
      if (chunk !== undefined) {
        body = chunk;
      }
    },
  } as unknown as ServerResponse;
  return { response, json: () => JSON.parse(body) as any };
}

describe("writeWorldTheme", () => {
  it("writes a theme and keeps the comments around it", async () => {
    const root = await world();
    const res = await writeWorldTheme(root, {
      preset: "scifi",
      fonts: { heading: "orbitron", body: "space-grotesk" },
      colors: { accent: "#4cc2ff", mapBg: "" },
    });
    assert.equal(res.ok, true);
    const text = await readFile(path.join(root, "world.yaml"), "utf8");
    assert.match(text, /# the world/);
    assert.match(text, /# keep me/);
    assert.match(text, /preset: scifi/);
    assert.match(text, /heading: orbitron/);
    assert.match(text, /#4cc2ff/);
    assert.doesNotMatch(text, /mapBg/);
  });

  it("clears keys and drops a theme left with nothing in it", async () => {
    const root = await world();
    await writeWorldTheme(root, { preset: "chronicle", colors: { accent: "#112233" } });
    const res = await writeWorldTheme(root, {
      preset: "",
      fonts: { heading: "default", body: "default" },
      colors: { accent: "" },
    });
    assert.equal(res.ok, true);
    const text = await readFile(path.join(root, "world.yaml"), "utf8");
    assert.doesNotMatch(text, /theme/);
  });

  it("refuses a colour that is not hex, writing nothing", async () => {
    const root = await world();
    const before = await readFile(path.join(root, "world.yaml"), "utf8");
    const res = await writeWorldTheme(root, { colors: { accent: "blue" } });
    assert.equal(res.ok, false);
    const after = await readFile(path.join(root, "world.yaml"), "utf8");
    assert.equal(after, before);
  });
});

describe("the settings API", () => {
  it("saves a theme through /api/world", async () => {
    const root = await world();
    const api = createEditorApi(root);
    const { response, json } = capture();
    await api(post({ section: "theme", values: { preset: "fantasy" } }), response, "/api/world");
    assert.equal(json().ok, true);
    const loaded = await loadWorld(root);
    const record = loaded.data.world.data as { theme?: { preset?: string } };
    assert.equal(record.theme?.preset, "fantasy");
  });

  it("serves the shelf the panel picks from", async () => {
    const root = await world();
    const api = createEditorApi(root);
    const { response, json } = capture();
    await api(get(), response, "/api/theme-shelf");
    const shelf = json();
    assert.equal(shelf.presets.length, 5);
    assert.equal(shelf.fonts.length, 9);
    assert.equal(Object.keys(shelf.defaultColors).length, 14);
    assert.ok(shelf.fonts.some((f: { id: string; bodyOk: boolean }) => f.id === "orbitron" && f.bodyOk === false));
  });

  it("resolves a draft theme the way the build does", async () => {
    const root = await world();
    const api = createEditorApi(root);
    const { response, json } = capture();
    await api(
      post({ theme: { preset: "scifi", colors: { accent: "#ff0000" }, fonts: { heading: "nope" } } }),
      response,
      "/api/theme/resolve",
    );
    const res = json();
    assert.equal(res.ok, true);
    assert.equal(res.theme.colors.accent, "#ff0000");
    assert.ok(res.warnings.some((w: string) => w.includes("nope")));
  });
});

describe("the shelf fonts route", () => {
  it("serves a bundled font and refuses anything else", async () => {
    const root = await world();
    const page = path.join(root, "page.html");
    await writeFile(page, "<!doctype html><p>ok</p>");
    const { startLocalServer } = await import("../src/cli/local-server.js");
    const address = await startLocalServer({
      root,
      port: 0,
      host: "127.0.0.1",
      page,
      api: async (_request, res) => {
        res.statusCode = 404;
        res.end("no api");
      },
    });
    try {
      const res = await fetch("http://127.0.0.1:" + address.port + "/fonts/orbitron.woff2");
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "font/woff2");
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.ok(bytes.length > 10000);
      const denied = await fetch("http://127.0.0.1:" + address.port + "/fonts/..%2fpackage.json");
      assert.equal(denied.status, 404);
    } finally {
      await address.close();
    }
  });
});
