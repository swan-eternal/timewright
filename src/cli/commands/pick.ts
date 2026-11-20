/**
 * `timewright pick` - the coordinate picker.
 *
 * A local page: choose a map, click a spot, and the coordinates are yours.
 * Locations that have no position yet are listed; pick one, click the map,
 * and the coordinates are written into the YAML.
 *
 * It binds to 127.0.0.1 and is never deployed. The writer keeps the file's
 * comments: the YAML document is edited in place, not regenerated.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadWorld, resolveImagePath } from "../load.js";
import { buildIndex } from "../../core/building.js";
import { readJsonBody, startLocalServer } from "../local-server.js";
import { moveLocation } from "../world-edit.js";
import { openBrowser } from "../open-browser.js";

export interface PickOptions {
  world?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
  noOpen?: boolean | undefined;
}

export async function runPick(options: PickOptions = {}): Promise<number> {
  const root = path.resolve(options.world ?? process.cwd());
  const port = options.port ?? 5174;
  const host = options.host ?? "127.0.0.1";

  await startLocalServer({
    root,
    port,
    host,
    page: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "picker.html"),
    image: async (mapId) => imagePath(root, mapId),
    api: async (request, response, url) => {
      if (url === "/api/world" && request.method === "GET") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(await describe(root)));
        return;
      }
      if (url === "/api/place" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await moveLocation(
          root,
          String(body.id ?? ""),
          String(body.mapId ?? ""),
          Number(body.x ?? 0),
          Number(body.y ?? 0),
        );
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(result));
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    },
  });

  console.log(`timewright pick: ${root}`);
  console.log(`  http://${host}:${port}/`);
  if (options.noOpen === true) {
    console.log("  Browser not opened automatically (--no-open).");
  } else {
    console.log("  Opening your browser...");
    openBrowser(`http://${host}:${port}/`);
  }
  console.log("  Click the map to get coordinates. Ctrl-C to stop.");
  return 0;
}

async function describe(root: string): Promise<unknown> {
  const loaded = await loadWorld(root);
  const index = buildIndex(loaded.data);
  // A map is referenced by its id, so the picker hands out ids.
  const maps = index.maps.map((record) => ({
    id: record.id,
    name: record.name,
    width: record.data.size?.[0] ?? 1000,
    height: record.data.size?.[1] ?? 700,
  }));

  const needsPlacing = index.locations
    .filter((record) => record.data.kind !== "mobile" && record.data.at === undefined)
    .map((record) => ({
      id: record.id,
      name: record.name,
      file: record.file,
      index: record.index,
    }));

  return { root, maps, needsPlacing };
}

async function imagePath(root: string, mapId: string): Promise<string | undefined> {
  const loaded = await loadWorld(root);
  const index = buildIndex(loaded.data);
  for (const record of index.maps) {
    if (record.id !== mapId) {
      continue;
    }
    const images =
      record.data.images ?? (record.data.file !== undefined ? [{ file: record.data.file }] : []);
    const image = images[0];
    if (image === undefined) {
      return undefined;
    }
    return resolveImagePath(root, record.file, image.file);
  }
  return undefined;
}
