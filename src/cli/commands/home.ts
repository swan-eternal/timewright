/**
 * `timewright home` - the friendly front door.
 *
 * A local page that lists the worlds in a folder, creates new ones, and
 * starts the editor for any of them on its own port. The browser is the
 * interface; the terminal underneath is just the engine that keeps running.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import { buildIndex } from "../../core/building.js";
import { loadWorld } from "../load.js";
import { readJsonBody, startLocalServer } from "../local-server.js";
import { openBrowser } from "../open-browser.js";
import { createEditorApi } from "./edit.js";
import { runInit } from "./init.js";

export interface HomeOptions {
  /** The folder whose child folders are the worlds. Default: here. */
  world?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
  noOpen?: boolean | undefined;
}

export interface WorldSummary {
  folder: string;
  title: string;
  events: number;
  people: number;
  locations: number;
  maps: number;
  error?: string | undefined;
}

/** The worlds in a folder: child directories that hold a world.yaml. */
export async function listWorlds(root: string): Promise<WorldSummary[]> {
  if (!existsSync(root)) {
    return [];
  }
  const worlds: WorldSummary[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const folder = entry.name;
    const worldRoot = path.join(root, folder);
    if (
      !existsSync(path.join(worldRoot, "world.yaml")) &&
      !existsSync(path.join(worldRoot, "world.yml"))
    ) {
      continue;
    }
    try {
      const loaded = await loadWorld(worldRoot);
      const index = buildIndex(loaded.data);
      // The world record's data is untyped at this layer; read the title
      // defensively so a missing one falls back to the folder name.
      const worldData = index.world.data as { title?: unknown } | undefined;
      const rawTitle = worldData?.title;
      const title = typeof rawTitle === "string" && rawTitle !== "" ? rawTitle : folder;
      worlds.push({
        folder,
        title,
        events: index.events.length,
        people: index.people.length,
        locations: index.locations.length,
        maps: index.maps.length,
      });
    } catch (error) {
      // A broken world is still listed: its card says what is wrong, and
      // the editor is the quickest way to fix it.
      worlds.push({
        folder,
        title: folder,
        events: 0,
        people: 0,
        locations: 0,
        maps: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  worlds.sort((a, b) => a.folder.localeCompare(b.folder));
  return worlds;
}

/** Names Windows reserves for devices, so they never become folders. */
const RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

function nameProblem(name: string): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(name)) {
    return "Names start with a letter or number and use letters, numbers, spaces, - or _ (64 characters at most).";
  }
  if (RESERVED.has(name.split(".")[0]?.toLowerCase() ?? "")) {
    return `"${name}" is a name Windows reserves for itself; pick another.`;
  }
  return undefined;
}

/** Editor servers this home page started, so each world gets one port. */
const editors = new Map<string, { url: string; close: () => Promise<void> }>();

/** Stop the editor servers started by any home api (tests use this). */
export async function closeHomeEditors(): Promise<void> {
  const running = [...editors.values()];
  editors.clear();
  await Promise.all(running.map((editor) => editor.close()));
}

function send(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

export function createHomeApi(
  root: string,
): (
  request: IncomingMessage,
  response: ServerResponse,
  url: string,
  query: URLSearchParams,
) => Promise<void> {
  return async (request, response, url) => {
    try {
      if (url === "/api/worlds" && request.method === "GET") {
        send(response, 200, { worlds: await listWorlds(root) });
        return;
      }
      if (url === "/api/worlds" && request.method === "POST") {
        const body = await readJsonBody(request);
        const name = String(body.name ?? "").trim();
        const problem = nameProblem(name);
        if (problem !== undefined) {
          send(response, 400, { error: problem });
          return;
        }
        if (existsSync(path.join(root, name))) {
          send(response, 400, { error: `A folder named "${name}" already exists here.` });
          return;
        }
        const code = await runInit({ folder: path.join(root, name) });
        if (code !== 0) {
          send(response, 500, { error: "The starter world could not be written." });
          return;
        }
        send(response, 200, { ok: true, folder: name });
        return;
      }
      if (url === "/api/edit" && request.method === "POST") {
        const body = await readJsonBody(request);
        const folder = String(body.folder ?? "");
        // Only the child folders this page lists are editable.
        if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(folder) || folder.includes("..")) {
          send(response, 400, { error: "That is not a world in this folder." });
          return;
        }
        const worldRoot = path.join(path.resolve(root), folder);
        if (
          !existsSync(path.join(worldRoot, "world.yaml")) &&
          !existsSync(path.join(worldRoot, "world.yml"))
        ) {
          send(response, 404, { error: "No world by that name here." });
          return;
        }
        const running = editors.get(worldRoot);
        if (running !== undefined) {
          send(response, 200, { url: running.url });
          return;
        }
        const page = path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "editor.html",
        );
        const address = await startLocalServer({
          root: worldRoot,
          port: 0,
          host: "127.0.0.1",
          page,
          api: createEditorApi(worldRoot),
        });
        const editorUrl = `http://127.0.0.1:${address.port}/`;
        editors.set(worldRoot, { url: editorUrl, close: address.close });
        send(response, 200, { url: editorUrl });
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    }
  };
}

export async function runHome(options: HomeOptions = {}): Promise<number> {
  const root = path.resolve(options.world ?? process.cwd());
  const port = options.port ?? 5176;
  const host = options.host ?? "127.0.0.1";

  const address = await startLocalServer({
    root,
    port,
    host,
    page: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "home.html"),
    api: createHomeApi(root),
  });

  const url = `http://${address.host}:${address.port}/`;
  console.log(`timewright home: ${root}`);
  console.log(`  ${url}`);
  if (options.noOpen === true) {
    console.log("  Browser not opened automatically (--no-open).");
  } else {
    console.log("  Opening your browser...");
    openBrowser(url);
  }
  console.log("  Keep this window open while you work. Ctrl-C to stop.");
  return 0;
}
