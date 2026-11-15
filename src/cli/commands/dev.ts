/**
 * `timewright dev` - run the viewer locally and reload it when the world
 * changes.
 *
 * The world is served as JSON from the middle of the dev server, so what
 * the browser shows is always the world on disk.
 */

import path from "node:path";
import { createServer, type Plugin } from "vite";

import { resolveWorld } from "../../core/derive.js";
import { loadWorld } from "../load.js";
import { findViewerRoot } from "./build.js";

export interface DevOptions {
  world?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
}

export async function runDev(options: DevOptions = {}): Promise<number> {
  const root = path.resolve(options.world ?? process.cwd());

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
        const url = (request.url ?? "").split("?")[0];
        if (url !== "/world.json") {
          next();
          return;
        }
        void loadWorld(root)
          .then((loaded) => {
            const world = resolveWorld(loaded.data);
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(world));
          })
          .catch((error: unknown) => {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          });
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
