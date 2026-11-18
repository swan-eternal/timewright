import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildWorldSite, findViewerDist } from "../src/cli/commands/build.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
}

/**
 * `timewright build` assembles a site by copying a viewer that was built
 * once, with relative URLs. No bundler runs on the user's machine, and
 * the site that comes out mounts under any path.
 */
describe("building a site", () => {
  it("can find the built viewer", async () => {
    const index = path.join(findViewerDist(), "index.html");
    assert.equal((await stat(index)).size > 0, true);
  });

  it("assembles a site from the prebuilt viewer", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "timewright-site-"));
    try {
      const result = await buildWorldSite({ world: fixture("napoleon-world"), out, quiet: true });
      assert.equal(result.ok, true);
      assert.deepEqual(
        result.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message),
        [],
      );

      const html = await readFile(path.join(out, "index.html"), "utf8");
      assert.ok(html.length > 0, "the viewer's page is in the site");
      assert.ok(!html.includes('src="/assets/'), "script references are relative");
      assert.ok(!html.includes('href="/assets/'), "stylesheet references are relative");

      const world = JSON.parse(await readFile(path.join(out, "world.json"), "utf8"));
      assert.ok(world.maps.length > 0);
      const image = world.maps[0].images[0];
      if (typeof image.path !== "string" || image.path.startsWith("/")) {
        assert.fail(`map image path ${String(image.path)} must be relative`);
      }
      assert.equal((await stat(path.join(out, image.path))).size > 0, true);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("writes a standalone file beside the site", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "timewright-single-"));
    try {
      const result = await buildWorldSite({
        world: fixture("napoleon-world"),
        out,
        singleFile: true,
        quiet: true,
      });
      assert.equal(result.ok, true);
      if (result.singleFilePath === undefined) {
        assert.fail("the single-file build reported no file");
      }
      const html = await readFile(result.singleFilePath, "utf8");
      assert.ok(html.includes('id="world-data"'), "the world is in the file");
      assert.equal((await stat(path.join(out, "index.html"))).size > 0, true);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
