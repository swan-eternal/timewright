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
import { readJsonBody, startLocalServer } from "../local-server.js";
import { moveLocation } from "../world-edit.js";

export interface PickOptions {
  world?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
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
  console.log("  Click the map to get coordinates. Ctrl-C to stop.");
  return 0;
}

async function describe(root: string): Promise<unknown> {
  const loaded = await loadWorld(root);
  const maps = loaded.data.maps.map((source) => {
    const map = source.data;
    return {
      id: map.id ?? map.name,
      name: map.name,
      width: map.size?.[0] ?? 1000,
      height: map.size?.[1] ?? 700,
    };
  });

  const needsPlacing = loaded.data.locations
    .filter((source) => source.data.kind !== "mobile" && source.data.at === undefined)
    .map((source) => ({
      id: source.data.id ?? source.data.name,
      name: source.data.name,
      file: source.file,
      index: source.index,
    }));

  return { root, maps, needsPlacing };
}

async function imagePath(root: string, mapId: string): Promise<string | undefined> {
  const loaded = await loadWorld(root);
  for (const source of loaded.data.maps) {
    const map = source.data;
    if ((map.id ?? map.name) !== mapId) {
      continue;
    }
    const images = map.images ?? (map.file !== undefined ? [{ file: map.file }] : []);
    const image = images[0];
    if (image === undefined) {
      return undefined;
    }
    return resolveImagePath(root, source.file, image.file);
  }
  return undefined;
}
