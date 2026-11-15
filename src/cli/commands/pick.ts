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

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { parseDocument } from "yaml";

import { validateWorld } from "../../core/validate.js";
import { loadWorld, resolveImagePath } from "../load.js";

export interface PickOptions {
  world?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
}

interface PickMap {
  id: string;
  name: string;
  width: number;
  height: number;
}

interface PickLocation {
  id: string;
  name: string;
  file?: string | undefined;
  index?: number | undefined;
}

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

export async function runPick(options: PickOptions = {}): Promise<number> {
  const root = path.resolve(options.world ?? process.cwd());
  const port = options.port ?? 5174;
  const host = options.host ?? "127.0.0.1";

  const require = createRequire(import.meta.url);
  const leafletDir = path.join(path.dirname(require.resolve("leaflet/package.json")), "dist");

  const server = createServer((request, response) => {
    void handle(request, response, root, leafletDir);
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });

  console.log(`timewright pick: ${root}`);
  console.log(`  http://${host}:${port}/`);
  console.log("  Click the map to get coordinates. Ctrl-C to stop.");
  return 0;
}

async function handle(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  root: string,
  leafletDir: string,
): Promise<void> {
  const url = (request.url ?? "/").split("?")[0];

  try {
    if (url === "/" || url === "/index.html") {
      const body = await readFile(new URL("../picker.html", import.meta.url), "utf8");
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(body);
      return;
    }
    if (url === "/leaflet/leaflet.js") {
      const body = await readFile(path.join(leafletDir, "leaflet.js"));
      response.setHeader("Content-Type", "text/javascript; charset=utf-8");
      response.end(body);
      return;
    }
    if (url === "/leaflet/leaflet.css") {
      const body = await readFile(path.join(leafletDir, "leaflet.css"));
      response.setHeader("Content-Type", "text/css; charset=utf-8");
      response.end(body);
      return;
    }
    if (url === "/api/world") {
      const body = JSON.stringify(await describeWorld(root));
      response.setHeader("Content-Type", "application/json");
      response.end(body);
      return;
    }
    if (url.startsWith("/api/image/")) {
      const mapId = decodeURIComponent(url.slice("/api/image/".length));
      const image = await imagePath(root, mapId);
      if (image === undefined) {
        response.statusCode = 404;
        response.end("no image for that map");
        return;
      }
      const body = await readFile(image);
      response.setHeader("Content-Type", MIME[path.extname(image).toLowerCase()] ?? "application/octet-stream");
      response.end(body);
      return;
    }
    if (url === "/api/place" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(chunk as Buffer);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: string;
        mapId?: string;
        x?: number;
        y?: number;
      };
      const result = await placeLocation(root, payload.id ?? "", payload.mapId ?? "", payload.x ?? 0, payload.y ?? 0);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  } catch (error) {
    response.statusCode = 500;
    response.end(error instanceof Error ? error.message : String(error));
  }
}

async function describeWorld(root: string): Promise<unknown> {
  const loaded = await loadWorld(root);
  const issues = validateWorld(loaded.data);

  const maps: PickMap[] = [];
  for (const source of loaded.data.maps) {
    const map = source.data;
    const width = map.size?.[0] ?? 1000;
    const height = map.size?.[1] ?? 700;
    maps.push({ id: map.id ?? map.name, name: map.name, width, height });
  }

  const needsPlacing: PickLocation[] = [];
  for (const [index, source] of loaded.data.locations.entries()) {
    const location = source.data;
    if (location.kind === "mobile" || location.at !== undefined) {
      continue;
    }
    needsPlacing.push({
      id: location.id ?? location.name,
      name: location.name,
      file: source.file,
      index: source.index,
    });
    void index;
  }

  return {
    root,
    maps,
    needsPlacing,
    warnings: issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.message),
  };
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

/** Write a location's position into the file that defines it. */
export async function placeLocation(
  root: string,
  id: string,
  mapId: string,
  x: number,
  y: number,
): Promise<{ ok: boolean; message: string }> {
  const loaded = await loadWorld(root);
  for (const source of loaded.data.locations) {
    const location = source.data;
    if ((location.id ?? location.name) !== id) {
      continue;
    }
    if (source.file === undefined) {
      return { ok: false, message: "that location has no file to write to" };
    }
    const text = await readFile(source.file, "utf8");
    const document = parseDocument(text);
    const prefix = source.index !== undefined ? [source.index] : [];
    document.setIn([...prefix, "at"], [Math.round(x), Math.round(y)]);
    document.setIn([...prefix, "map"], mapId);
    await writeFile(source.file, document.toString({ collectionStyle: "any" }), "utf8");
    void root;
    return { ok: true, message: `placed ${location.name} at ${Math.round(x)}, ${Math.round(y)}` };
  }
  return { ok: false, message: `no location called "${id}"` };
}
