import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runInit } from "../src/cli/commands/init.js";
import { loadWorld } from "../src/cli/load.js";
import { createRecord, deleteRecord, saveMapImage, writeRecordFields } from "../src/cli/world-edit.js";

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "timewright-editor-"));
}

async function starterWorld(): Promise<string> {
  const dir = await scratch();
  const target = path.join(dir, "my-world");
  await runInit({ folder: target });
  // The starter ships its examples as comments, so these tests give the
  // world two real locations to edit.
  await writeFile(
    path.join(target, "locations", "locations.yaml"),
    [
      "- name: Home",
      "  map: region",
      "  at: [430, 320]",
      "",
      "# This one has no position yet. Place it with `timewright pick`.",
      "- name: The Old Mill",
      "  map: region",
      "",
    ].join("\n"),
  );
  return target;
}

describe("the editor's writes", () => {
  it("edits a record in place, keeping the comments", async () => {
    const target = await starterWorld();
    const file = path.join(target, "locations", "locations.yaml");

    const result = await writeRecordFields(
      target,
      "location",
      { file, index: 0 },
      { name: "Home", tags: ["place", "home"] },
    );
    assert.equal(result.ok, true);

    const text = await readFile(file, "utf8");
    assert.match(text, /- home/);
    assert.match(text, /no position yet/);
  });

  it("adds a record to the kind's list file", async () => {
    const target = await starterWorld();
    const result = await createRecord(target, "person", { name: "Bo Lin", tags: ["character"] });
    assert.equal(result.ok, true);
    assert.match(result.message ?? "", /people\.yaml/);

    const loaded = await loadWorld(target);
    const person = loaded.data.people.find((entry) => entry.data.name === "Bo Lin");
    assert.ok(person !== undefined);
  });

  it("removes a record from a list file", async () => {
    const target = await starterWorld();
    const file = path.join(target, "locations", "locations.yaml");

    const result = await deleteRecord(target, "location", { file, index: 0 });
    assert.equal(result.ok, true);

    const loaded = await loadWorld(target);
    assert.equal(loaded.data.locations.length, 1);
    assert.equal(loaded.data.locations[0]?.data.name, "The Old Mill");
  });

  it("saves a map image and points the map at it", async () => {
    const target = await starterWorld();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const result = await saveMapImage(target, "region", "second map.png", bytes);
    assert.equal(result.ok, true);
    assert.ok(existsSync(path.join(target, "maps", "second-map.png")));

    const loaded = await loadWorld(target);
    const map = loaded.data.maps[0];
    assert.equal(map?.data.images?.length, 2);
    assert.equal(map?.data.images?.[1]?.file, "second-map.png");
  });

  it("renames a record's file when its name changes", async () => {
    const dir = await scratch();
    const target = path.join(dir, "world");
    await mkdir(path.join(target, "locations"), { recursive: true });
    await writeFile(
      path.join(target, "locations", "old-name.yaml"),
      "name: Old Name\nmap: region\n",
      "utf8",
    );

    const result = await writeRecordFields(
      target,
      "location",
      { file: path.join(target, "locations", "old-name.yaml") },
      { name: "New Name" },
    );
    assert.equal(result.ok, true);
    assert.ok(existsSync(path.join(target, "locations", "new-name.yaml")));
    assert.equal(existsSync(path.join(target, "locations", "old-name.yaml")), false);
  });
});
