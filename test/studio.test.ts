import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { describe as describeWorld } from "../src/cli/commands/edit.js";
import { runInit } from "../src/cli/commands/init.js";
import { saveMapImage } from "../src/cli/world-edit.js";

interface MapSummary {
  placeholder?: boolean;
}

interface WorldSummary {
  maps: MapSummary[];
}

async function studioView(root: string): Promise<WorldSummary> {
  return (await describeWorld(root)) as WorldSummary;
}

const editorHtml = await readFile(
  path.join(process.cwd(), "src", "cli", "editor.html"),
  "utf8",
);

async function starterWorld(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "timewright-studio-"));
  const target = path.join(dir, "my-world");
  await runInit({ folder: target });
  return target;
}

describe("the Studio's shape", () => {
  it("asks for what it needs instead of interrupting with a box", () => {
    // The browser's prompt() boxes take the eye off the work and hold one
    // line of text. Every record now gets a form of its own.
    const calls = editorHtml.match(/\bprompt\(/g) ?? [];
    assert.deepEqual(calls, [], "the Studio should not use prompt()");
  });

  it("puts the tabs in the order the work happens", () => {
    const tabs = [...editorHtml.matchAll(/data-tab="([a-z]+)"/g)].map((match) => match[1]);
    assert.deepEqual(tabs, ["maps", "people", "locations", "events", "world"]);
  });

  it("counts what is in each tab", () => {
    for (const kind of ["maps", "people", "locations", "events"]) {
      assert.ok(
        editorHtml.includes(`data-count="${kind}"`),
        `the ${kind} tab should carry a count`,
      );
    }
  });

  it("writes the characters of an event as pills", () => {
    assert.ok(editorHtml.includes('id="ev-people-pills"'), "the people field should be pills");
    assert.ok(editorHtml.includes('id="ev-quick-person"'), "a new character should be one box away");
  });

  it("draws a place being written as a pin on the map", () => {
    assert.ok(editorHtml.includes("ed-pin draft"), "a draft location should wait on the map");
  });
});

describe("the Studio's map images", () => {
  it("knows a map that is still a placeholder", async () => {
    const root = await starterWorld();
    const before = await studioView(root);
    assert.equal(before.maps[0]?.placeholder, true);
  });

  it("stops calling it a placeholder once a real map is uploaded", async () => {
    const root = await starterWorld();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const saved = await saveMapImage(root, "region", "real-map.png", png, { mode: "replace" });
    assert.equal(saved.ok, true);

    const after = await studioView(root);
    assert.equal(after.maps[0]?.placeholder, false);
  });
});
