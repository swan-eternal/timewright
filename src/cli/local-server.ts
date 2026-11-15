/**
 * A local server for the tools that touch a world by hand.
 *
 * The picker and the editor both want the same things: the page, Leaflet,
 * the map images, and a place to answer API calls. This is that plumbing.
 *
 * It binds to 127.0.0.1 and is never deployed.
 */

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

export interface LocalServerOptions {
  /** The world folder, for the tools' own use. */
  root: string;
  port: number;
  host: string;
  /** The HTML page served at /. */
  page: string;
  /** Handles /api/ calls that are not image requests. */
  api: (request: IncomingMessage, response: ServerResponse, url: string) => Promise<void>;
  /** The image file for a map, if it has one. */
  image?: ((mapId: string) => Promise<string | undefined>) | undefined;
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

export async function startLocalServer(options: LocalServerOptions): Promise<void> {
  const require = createRequire(import.meta.url);
  const leafletDir = path.join(path.dirname(require.resolve("leaflet/package.json")), "dist");

  const server = createServer((request, response) => {
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = (request.url ?? "/").split("?")[0];
    try {
      if (url === "/" || url === "/index.html") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(await readFile(options.page, "utf8"));
        return;
      }
      if (url === "/leaflet/leaflet.js") {
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.end(await readFile(path.join(leafletDir, "leaflet.js")));
        return;
      }
      if (url === "/leaflet/leaflet.css") {
        response.setHeader("Content-Type", "text/css; charset=utf-8");
        response.end(await readFile(path.join(leafletDir, "leaflet.css")));
        return;
      }
      if (url.startsWith("/api/image/")) {
        const mapId = decodeURIComponent(url.slice("/api/image/".length));
        const file = await options.image?.(mapId);
        if (file === undefined) {
          response.statusCode = 404;
          response.end("no image for that map");
          return;
        }
        response.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
        response.end(await readFile(file));
        return;
      }
      if (url.startsWith("/api/")) {
        await options.api(request, response, url);
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    }
  }

  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host, resolve);
  });
}

/** Read a JSON body off a request. */
export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
