import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runInit } from "../src/cli/commands/init.js";
import { writeSingleFile } from "../src/cli/single-file.js";
import { moveLocation } from "../src/cli/world-edit.js";
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

    const result = await moveLocation(target, "The Old Mill", "region", 120, 340);
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

  it("keeps an asset's own dollar patterns intact", async () => {
    // A minified bundle holds `$&`, `$` and `$'`: they are what a
    // replacement string is made of. Inlining one with a string
    // replacement expanded them, which cut the script in half and
    // dumped the rest of it into the page as text.
    const dir = await scratch();
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await writeFile(
      path.join(dir, "index.html"),
      '<!doctype html><html><head></head><body><script type="module" src="./assets/a.js"></script></body></html>',
    );
    const source = [
      "const escape = (text) => text.replace(/[.*+?^${}()|[\\]\\\\]/g, `\\\\$&`);",
      'const before = "the text before";',
      'const after = "the text after";',
      'console.log(escape(before), escape(after));',
    ].join("\n");
    await writeFile(path.join(dir, "assets", "a.js"), source);

    const world = {
      title: "One file",
      maps: [],
      locations: [],
      people: [],
      events: [],
    } as unknown as ResolvedWorld;

    const result = await writeSingleFile(dir, world);
    const html = await readFile(result.file, "utf8");

    // The script is inlined whole, exactly as it was.
    assert.ok(html.includes(source), "the asset should be inlined verbatim");
    // And nothing was spliced in from the document around it.
    assert.equal(html.includes("<script type=\"module\""), false);
    // The script is still a script, and the page has one of them.
    assert.equal((html.match(/<script/g) ?? []).length, 2);
  });

  it("puts the world at the end of the page, not inside the script", async () => {
    // The bundle holds a `</body>` of its own - a sanitiser builds an
    // empty document - so looking for the first one in the page found
    // it inside the inlined JavaScript and put the world in the middle
    // of the script.
    const dir = await scratch();
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await writeFile(
      path.join(dir, "index.html"),
      '<!doctype html><html><head></head><body><script type="module" src="./assets/a.js"></script></body></html>',
    );
    const source = 'const page = "<html><head></head><body></body></html>";\nconsole.log(page);';
    await writeFile(path.join(dir, "assets", "a.js"), source);

    const world = {
      title: "One file",
      maps: [],
      locations: [],
      people: [],
      events: [],
    } as unknown as ResolvedWorld;

    const result = await writeSingleFile(dir, world);
    const html = await readFile(result.file, "utf8");

    const dataStart = html.indexOf('id="world-data"');
    const dataEnd = html.indexOf("</script>", dataStart);
    const scriptStart = html.indexOf("<script>", dataEnd);
    assert.ok(dataStart > -1, "the world should be in the page");
    assert.ok(dataEnd > dataStart, "the world should be a script of its own");
    assert.ok(scriptStart > dataEnd, "the viewer should come after the world's data");
    // The script is whole.
    assert.ok(html.includes(source), "the asset should be inlined verbatim");
    // And the page still ends where it should.
    assert.ok(html.lastIndexOf("</body>") > scriptStart);
  });

  it("puts the world and the viewer at the end of the body, the world first", async () => {
    // The viewer is a script: it runs the moment the parser reaches it.
    // In the head it ran before the page had a body, found no map, and
    // the preview was a blank page. The world's data has to be in the
    // document before the viewer looks for it.
    const dir = await scratch();
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await writeFile(
      path.join(dir, "index.html"),
      '<!doctype html><html><head><script type="module" crossorigin src="./assets/a.js"></script></head><body><div id="app"><div id="map"></div></div></body></html>',
    );
    await writeFile(path.join(dir, "assets", "a.js"), "console.log('hello');");

    const world = {
      title: "One file",
      maps: [],
      locations: [],
      people: [],
      events: [],
    } as unknown as ResolvedWorld;

    const result = await writeSingleFile(dir, world);
    const html = await readFile(result.file, "utf8");

    const appAt = html.indexOf('<div id="app">');
    const dataAt = html.indexOf('id="world-data"');
    const dataEnd = html.indexOf("</script>", dataAt);
    const viewerAt = html.indexOf("<script>", dataEnd);
    const bodyEnd = html.lastIndexOf("</body>");

    assert.ok(appAt >= 0, "the page should have an app");
    assert.ok(dataAt > appAt, "the world should come after the app's markup");
    assert.ok(dataEnd > dataAt, "the world should be a script of its own");
    assert.ok(viewerAt > dataEnd, "the viewer should come after the world, not before it");
    assert.ok(bodyEnd > viewerAt, "both should be inside the body");
    assert.equal(html.includes('src="./assets'), false, "nothing should point at a file");
  });
});
