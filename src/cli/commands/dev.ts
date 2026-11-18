/**
 * `timewright dev` - run the viewer locally and reload it when the world
 * changes.
 *
 * The world is served as JSON from the middle of the dev server, so what
 * the browser shows is always the world on disk.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

import { resolveWorld } from "../../core/derive.js";
import { loadWorld, resolveImagePath } from "../load.js";
import { findViewerRoot } from "./build.js";

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

export interface DevOptions {
  world?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
}

export async function runDev(options: DevOptions = {}): Promise<number> {
  const root = path.resolve(options.world ?? process.cwd());

  // Loaded here, not at the top: only the dev server needs a bundler.
  let createServer: typeof import("vite")["createServer"];
  try {
    ({ createServer } = await import("vite"));
  } catch {
    console.error("timewright dev: the dev server needs the bundler, which is a development dependency");
    console.error("  run it from a source checkout with `npm install`, or use `timewright edit` instead");
    return 1;
  }

  const server = await createServer({
    configFile: false,
    root: findViewerRoot(),
    base: "/",
    plugins: [worldPlugin(root)],
    server: {
      port: options.port ?? 5173,
      host: options.host ?? "127.0.0.1",
      open: false,
    },
  });

  await server.listen();
  const address = server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${options.port ?? 5173}/`;
  console.log(`timewright dev: ${root}`);
  console.log(`  ${address}`);
  console.log("  Watching the world folder. Ctrl-C to stop.");
  return 0;
}

function worldPlugin(root: string): Plugin {
  return {
    name: "timewright-world",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? "").split("?")[0] ?? "";
        if (url === "/world.json") {
          void loadWorld(root)
            .then((loaded) => {
              const world = resolveWorld(loaded.data);
              world.maps.forEach((map, idx) => {
                const src = loaded.data.maps[idx];
                map.images.forEach((img, imgIdx) => {
                  const raw = src?.data.images?.[imgIdx] ?? (imgIdx === 0 ? src?.data : undefined);
                  const file = raw !== undefined && "file" in raw && raw.file !== undefined ? raw.file : img.file;
                  img.path = `__world/map/${encodeURIComponent(map.id)}/${encodeURIComponent(file)}`;
                });
              });
              for (const person of world.people) {
                if (person.image && !person.image.startsWith("http") && !person.image.startsWith("data:")) {
                  person.image = `__world/asset/${encodeURIComponent(person.image)}`;
                }
              }
              for (const loc of world.locations) {
                if (loc.image && !loc.image.startsWith("http") && !loc.image.startsWith("data:")) {
                  loc.image = `__world/asset/${encodeURIComponent(loc.image)}`;
                }
              }
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify(world));
            })
            .catch((error: unknown) => {
              response.statusCode = 500;
              response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
            });
          return;
        }

        if (url.startsWith("/__world/map/")) {
          const rest = url.slice("/__world/map/".length);
          const slash = rest.indexOf("/");
          if (slash === -1) {
            next();
            return;
          }
          const mapId = decodeURIComponent(rest.slice(0, slash));
          const fileName = decodeURIComponent(rest.slice(slash + 1));
          void loadWorld(root).then(async (loaded) => {
            const world = resolveWorld(loaded.data);
            const idx = world.maps.findIndex((m) => m.id === mapId);
            const src = idx >= 0 ? loaded.data.maps[idx] : undefined;
            const resolved = await resolveImagePath(root, src?.file, fileName);
            if (resolved === undefined) {
              response.statusCode = 404;
              response.end("not found");
              return;
            }
            response.setHeader("Content-Type", MIME[path.extname(resolved).toLowerCase()] ?? "application/octet-stream");
            response.end(await readFile(resolved));
          }).catch(() => {
            response.statusCode = 500;
            response.end("error");
          });
          return;
        }

        if (url.startsWith("/__world/asset/")) {
          const fileName = decodeURIComponent(url.slice("/__world/asset/".length));
          void resolveImagePath(root, undefined, fileName).then(async (resolved) => {
            if (resolved === undefined) {
              response.statusCode = 404;
              response.end("not found");
              return;
            }
            response.setHeader("Content-Type", MIME[path.extname(resolved).toLowerCase()] ?? "application/octet-stream");
            response.end(await readFile(resolved));
          }).catch(() => {
            response.statusCode = 500;
            response.end("error");
          });
          return;
        }

        next();
      });

      server.watcher.add(root);
      const reload = (file: string): void => {
        if (file.startsWith(root)) {
          server.ws.send({ type: "full-reload" });
        }
      };
      server.watcher.on("change", reload);
      server.watcher.on("add", reload);
      server.watcher.on("unlink", reload);
    },
  };
}
