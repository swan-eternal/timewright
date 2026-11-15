/**
 * `timewright edit` - the visual editor.
 *
 * The picker, plus a form for everything the picker does not cover: people,
 * events, cards, and the maps themselves. Click the map to make a location
 * or an event; drag a marker to move it; the YAML is edited in place, so the
 * files stay the source of truth and an agent can keep working on them.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";

import { eventPlace, resolveWorld } from "../../core/derive.js";
import { validateWorld } from "../../core/validate.js";
import { loadWorld, resolveImagePath } from "../load.js";
import { readJsonBody, startLocalServer } from "../local-server.js";
import {
  createRecord,
  deleteRecord,
  moveLocation,
  saveMapImage,
  writeRecordFields,
  type EditableKind,
} from "../world-edit.js";

export interface EditOptions {
  world?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
}

export async function runEdit(options: EditOptions = {}): Promise<number> {
  const root = path.resolve(options.world ?? process.cwd());
  const port = options.port ?? 5175;
  const host = options.host ?? "127.0.0.1";

  await startLocalServer({
    root,
    port,
    host,
    page: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "editor.html"),
    image: async (mapId) => imagePath(root, mapId),
    api: async (request, response, url) => {
      if (url === "/api/editor" && request.method === "GET") {
        respond(response, await describe(root));
        return;
      }
      if (url === "/api/record" && request.method === "POST") {
        const body = await readJsonBody(request);
        const kind = String(body.kind ?? "location") as EditableKind;
        const fields = (body.fields ?? {}) as Record<string, unknown>;
        const place = { file: body.file as string | undefined, index: body.index as number | undefined };
        respond(response, await writeRecordFields(root, kind, place, fields));
        return;
      }
      if (url === "/api/create" && request.method === "POST") {
        const body = await readJsonBody(request);
        const kind = String(body.kind ?? "location") as EditableKind;
        const record = (body.record ?? {}) as Record<string, unknown>;
        respond(response, await createRecord(root, kind, record));
        return;
      }
      if (url === "/api/move" && request.method === "POST") {
        const body = await readJsonBody(request);
        respond(
          response,
          await moveLocation(
            root,
            String(body.id ?? ""),
            String(body.mapId ?? ""),
            Number(body.x ?? 0),
            Number(body.y ?? 0),
          ),
        );
        return;
      }
      if (url === "/api/delete" && request.method === "POST") {
        const body = await readJsonBody(request);
        const kind = String(body.kind ?? "location") as EditableKind;
        const place = { file: body.file as string | undefined, index: body.index as number | undefined };
        respond(response, await deleteRecord(root, kind, place));
        return;
      }
      if (url === "/api/image" && request.method === "POST") {
        const body = await readJsonBody(request);
        const data = String(body.data ?? "");
        const bytes = Buffer.from(data.includes(",") ? data.split(",")[1] ?? "" : data, "base64");
        respond(
          response,
          await saveMapImage(root, String(body.mapId ?? ""), String(body.fileName ?? "map.png"), bytes),
        );
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    },
  });

  console.log(`timewright edit: ${root}`);
  console.log(`  http://${host}:${port}/`);
  console.log("  Edit the world in the browser. Ctrl-C to stop.");
  return 0;
}

function respond(response: ServerResponse, payload: unknown): void {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function describe(root: string): Promise<unknown> {
  const loaded = await loadWorld(root);
  const world = resolveWorld(loaded.data);
  const issues = validateWorld(loaded.data);

  const maps = loaded.data.maps.map((source) => {
    const map = source.data;
    const id = map.id ?? map.name;
    return {
      id,
      name: map.name,
      size: map.size ?? [1000, 700],
      file: source.file,
      index: source.index,
      images: (map.images ?? []).map((image) => ({
        file: image.file,
        from: image.from,
        until: image.until,
      })),
    };
  });

  const locations = loaded.data.locations.map((source) => {
    const location = source.data;
    return {
      id: location.id ?? location.name,
      name: location.name,
      aliases: location.aliases ?? [],
      map: location.map ?? "",
      at: location.at ?? null,
      tags: location.tags ?? [],
      card: location.card ?? location.bio ?? "",
      kind: location.kind ?? "fixed",
      file: source.file,
      index: source.index,
    };
  });

  const people = loaded.data.people.map((source) => {
    const person = source.data;
    return {
      id: person.id ?? person.name,
      name: person.name,
      aliases: person.aliases ?? [],
      born: person.born ?? "",
      died: person.died ?? "",
      tags: person.tags ?? [],
      card: person.bio ?? "",
      file: source.file,
      index: source.index,
    };
  });

  const events = loaded.data.events.map((source) => {
    const event = source.data;
    const resolved = world.events.find((entry) => entry.id === (event.id ?? event.title));
    const place = resolved !== undefined ? eventPlace(world, resolved) : undefined;
    return {
      id: event.id ?? event.title,
      title: event.title,
      when: event.when,
      where: typeof event.where === "string" ? event.where : "",
      map: place?.mapId ?? "",
      at: place?.at ?? null,
      people: event.people ?? [],
      tags: event.tags ?? [],
      card: event.card ?? "",
      file: source.file,
      index: source.index,
    };
  });

  return {
    root,
    maps,
    locations,
    people,
    events,
    warnings: issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => ({ message: issue.message, record: issue.record ?? "" })),
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
