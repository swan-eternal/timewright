import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { loadWorld } from "../src/cli/load.js";
import { validateWorld } from "../src/core/validate.js";

/** A real PNG of a given size, so the image reader has something to read. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = 210;
      raw[row + 2 + x * 3] = 195;
      raw[row + 3 + x * 3] = 160;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function worldFolder(name: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "timewright-"));
  const root = path.join(dir, name);
  await mkdir(path.join(root, "maps"), { recursive: true });
  await mkdir(path.join(root, "locations"), { recursive: true });
  return root;
}

async function issues(root: string) {
  const loaded = await loadWorld(root);
  return [...loaded.issues, ...validateWorld(loaded.data)];
}

describe("the cross-platform promises", () => {
  it("reads a file with Windows line endings", async () => {
    const root = await worldFolder("crlf world");
    await writeFile(
      path.join(root, "world.yaml"),
      "title: A World\r\noverworld: region\r\ncalendar: gregorian\r\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "maps", "region.yaml"),
      "- id: region\r\n  name: Region\r\n  size: [40, 30]\r\n  images:\r\n    - file: region.png\r\n",
      "utf8",
    );
    await writeFile(path.join(root, "maps", "region.png"), png(40, 30));

    const loaded = await loadWorld(root);
    assert.equal(loaded.data.world.data.title, "A World");
    assert.equal(loaded.data.maps.length, 1);
    assert.equal(loaded.issues.length, 0);
  });

  it("finds a file whose case does not match, and says so", async () => {
    const root = await worldFolder("case");
    await writeFile(path.join(root, "world.yaml"), "title: A World\noverworld: region\n", "utf8");
    await writeFile(
      path.join(root, "maps", "region.yaml"),
      "- id: region\n  name: Region\n  size: [40, 30]\n  images:\n    - file: Region.PNG\n",
      "utf8",
    );
    await writeFile(path.join(root, "maps", "region.png"), png(40, 30));

    const found = await issues(root);
    const mismatch = found.find((issue) => issue.code === "case-mismatch");
    assert.ok(mismatch !== undefined);
    assert.equal(mismatch.severity, "warning");
    // And it still found the file, so nothing else is broken.
    assert.equal(found.filter((issue) => issue.code === "missing-image").length, 0);
  });

  it("errors when one map's images have different sizes", async () => {
    const root = await worldFolder("sizes");
    await writeFile(path.join(root, "world.yaml"), "title: A World\noverworld: region\n", "utf8");
    await writeFile(
      path.join(root, "maps", "region.yaml"),
      "- id: region\n  name: Region\n  images:\n    - file: one.png\n    - file: two.png\n",
      "utf8",
    );
    await writeFile(path.join(root, "maps", "one.png"), png(40, 30));
    await writeFile(path.join(root, "maps", "two.png"), png(50, 30));

    const found = await issues(root);
    assert.ok(found.some((issue) => issue.code === "image-size-mismatch" && issue.severity === "error"));
  });

  it("warns when the declared size is not the image's size", async () => {
    const root = await worldFolder("declared");
    await writeFile(path.join(root, "world.yaml"), "title: A World\noverworld: region\n", "utf8");
    await writeFile(
      path.join(root, "maps", "region.yaml"),
      "- id: region\n  name: Region\n  size: [100, 100]\n  images:\n    - file: region.png\n",
      "utf8",
    );
    await writeFile(path.join(root, "maps", "region.png"), png(40, 30));

    const found = await issues(root);
    const mismatch = found.find((issue) => issue.code === "size-mismatch");
    assert.ok(mismatch !== undefined);
    assert.equal(mismatch.severity, "warning");
  });

  it("works in a folder whose name has a space in it", async () => {
    const root = await worldFolder("a folder with spaces");
    await writeFile(path.join(root, "world.yaml"), "title: A World\noverworld: region\n", "utf8");
    await writeFile(
      path.join(root, "maps", "region.yaml"),
      "- id: region\n  name: Region\n  size: [40, 30]\n  images:\n    - file: region.png\n",
      "utf8",
    );
    await writeFile(path.join(root, "maps", "region.png"), png(40, 30));

    const loaded = await loadWorld(root);
    assert.equal(loaded.data.world.data.title, "A World");
    assert.equal(loaded.issues.length, 0);
  });
});
