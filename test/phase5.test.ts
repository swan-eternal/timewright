import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runInit } from "../src/cli/commands/init.js";
import { placeLocation } from "../src/cli/commands/pick.js";
import { writeSingleFile } from "../src/cli/single-file.js";
import { loadWorld } from "../src/cli/load.js";
import type { ResolvedWorld } from "../src/core/model.js";
import { validateWorld } from "../src/core/validate.js";

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "timewright-"));
}

describe("timewright init", () => {
  it("makes a world that validates", async () => {
    const dir = await scratch();
    const target = path.join(dir, "my-world");

    const code = await runInit({ folder: target });
    assert.equal(code, 0);

    const loaded = await loadWorld(target);
    const issues = [...loaded.issues, ...validateWorld(loaded.data)];
    const errors = issues.filter((issue) => issue.severity === "error");
    assert.deepEqual(errors.map((issue) => issue.message), []);

    assert.ok(existsSync(path.join(target, "world.yaml")));
    assert.ok(existsSync(path.join(target, "maps", "region.svg")));
    assert.ok(existsSync(path.join(target, "AGENT_GUIDE.md")));
    assert.ok(existsSync(path.join(target, "README.md")));
  });

  it("refuses to write over a folder that already has something in it", async () => {
    const dir = await scratch();
    const target = path.join(dir, "my-world");
    await runInit({ folder: target });
    const code = await runInit({ folder: target });
    assert.equal(code, 1);
  });
});

describe("the picker", () => {
  it("writes the coordinates into the file that defines the location", async () => {
    const dir = await scratch();
    const target = path.join(dir, "my-world");
    await runInit({ folder: target });

    const result = await placeLocation(target, "The Old Mill", "region", 120, 340);
    assert.equal(result.ok, true);

    const text = await readFile(path.join(target, "locations", "locations.yaml"), "utf8");
    assert.match(text, /- 120/);
    assert.match(text, /- 340/);
    // The comment the starter world shipped with is still there.
    assert.match(text, /no position yet/);

    const loaded = await loadWorld(target);
    const mill = loaded.data.locations.find((location) => location.data.name === "The Old Mill");
    assert.deepEqual(mill?.data.at, [120, 340]);
  });
});

describe("the single-file build", () => {
  it("puts the world, the viewer and the images in one file", async () => {
    const dir = await scratch();
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await mkdir(path.join(dir, "maps", "m"), { recursive: true });
    await writeFile(
      path.join(dir, "index.html"),
      '<!doctype html><html><head><link rel="stylesheet" href="./assets/a.css"></head><body><script type="module" src="./assets/a.js"></script></body></html>',
    );
    await writeFile(path.join(dir, "assets", "a.css"), "body { color: red }");
    await writeFile(path.join(dir, "assets", "a.js"), "console.log('hello');");
    await writeFile(path.join(dir, "maps", "m", "m.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const world = {
      title: "One file",
      maps: [{ id: "m", name: "M", images: [{ file: "m.png", path: "maps/m/m.png" }] }],
      locations: [],
      people: [],
      events: [],
    } as unknown as ResolvedWorld;

    const result = await writeSingleFile(dir, world);
    const html = await readFile(result.file, "utf8");

    assert.match(html, /body \{ color: red \}/);
    assert.match(html, /console\.log\('hello'\);/);
    assert.match(html, /world-data/);
    assert.match(html, /data:image\/png;base64/);
    assert.equal(/src="\.\/assets/.test(html), false);
  });
});
