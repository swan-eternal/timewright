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
import os from "node:os";
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

/** Where the server ended up, so a caller can find it. */
export interface LocalServerAddress {
  host: string;
  port: number;
}

/**
 * Whether a request may touch the world.
 *
 * The server listens on the loopback address, but a page in the user's
 * browser can still reach it, and a name pointed at 127.0.0.1 can reach
 * it from anywhere. Two headers answer both.
 *
 * The Host header has to name this machine. A rebound name would
 * arrive as some other name, so it is turned away.
 *
 * A request that changes something has to come from the page this
 * server served: its Origin has to be the same origin as its Host. A
 * browser sends an Origin on every request that changes something, so a
 * request without one is a local program rather than a page. An opaque
 * origin is turned away: a sandboxed frame is something any site can
 * hold.
 */
export function requestIsAllowed(request: IncomingMessage, host: string): boolean {
  const header = request.headers.host;
  if (header === undefined) {
    return false;
  }
  if (!isLocalName(hostnameOf(header), host)) {
    return false;
  }
  const method = (request.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return true;
  }
  const origin = request.headers.origin;
  if (origin === undefined) {
    // No Origin at all is a local program, not a page: a browser sends
    // one on every request that changes something, cross-origin or not.
    return true;
  }
  if (origin === "null") {
    // An opaque origin: a sandboxed frame, which any site may hold.
    return false;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return originHost.toLowerCase() === header.toLowerCase();
}

/** The hostname in a host header, without the port. */
function hostnameOf(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  // A bare IPv6 address has several colons and no port to strip.
  if (trimmed.indexOf(":") !== trimmed.lastIndexOf(":")) {
    return trimmed;
  }
  const colon = trimmed.lastIndexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/** Whether a hostname names this machine. */
function isLocalName(hostname: string, host: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === hostnameOf(host) ||
    hostname === os.hostname().toLowerCase()
  );
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

export async function startLocalServer(options: LocalServerOptions): Promise<LocalServerAddress> {
  const require = createRequire(import.meta.url);
  const leafletDir = path.join(path.dirname(require.resolve("leaflet/package.json")), "dist");

  const server = createServer((request, response) => {
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = (request.url ?? "/").split("?")[0];
    if (!requestIsAllowed(request, options.host)) {
      response.statusCode = 403;
      response.end("forbidden");
      return;
    }
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
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  return { host: options.host, port };
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
