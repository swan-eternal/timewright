import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadWorld } from "../src/cli/load.js";
import { validateWorld } from "../src/core/validate.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
}

describe("loadWorld", () => {
  it("loads a well-formed world with no errors", async () => {
    const loaded = await loadWorld(fixture("napoleon-world"));
    const errors = loaded.issues.filter((issue) => issue.severity === "error");
    assert.deepEqual(errors.map((issue) => issue.message), []);
    assert.equal(loaded.data.maps.length, 2);
    assert.equal(loaded.data.people.length, 2);
    assert.equal(loaded.data.locations.length, 5);
    assert.equal(loaded.data.events.length, 3);
  });

  it("finds the map images and their pixel sizes", async () => {
    const loaded = await loadWorld(fixture("napoleon-world"));
    assert.deepEqual(
      loaded.issues.map((issue) => issue.code),
      [],
    );
  });

  it("passes the whole-world checks on a good world", async () => {
    const loaded = await loadWorld(fixture("napoleon-world"));
    const issues = [...loaded.issues, ...validateWorld(loaded.data)];
    assert.deepEqual(issues.map((issue) => `${issue.code}: ${issue.message}`), []);
  });

  it("reports a broken world", async () => {
    const loaded = await loadWorld(fixture("broken-world"));
    const issues = [...loaded.issues, ...validateWorld(loaded.data)];
    const codes = issues.map((issue) => issue.code);
    assert.ok(codes.includes("invalid-date"));
    assert.ok(codes.includes("unknown-reference"));
  });

  it("reports a folder with no world.yaml", async () => {
    const loaded = await loadWorld(fixture("napoleon-world/maps"));
    assert.ok(loaded.issues.some((issue) => issue.code === "missing-world"));
  });

  it("treats a list file that holds only comments as an empty list", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "timewright-commentonly-"));
    await mkdir(path.join(dir, "people"), { recursive: true });
    await writeFile(path.join(dir, "world.yaml"), "format: 1\ntitle: Empty\n");
    await writeFile(
      path.join(dir, "people", "people.yaml"),
      "# - name: Somebody\n#   bio: |\n#     Not written yet.\n",
    );
    const loaded = await loadWorld(dir);
    const errors = loaded.issues.filter((issue) => issue.severity === "error");
    assert.deepEqual(errors.map((issue) => issue.message), []);
    assert.equal(loaded.data.people.length, 0);
  });
});
