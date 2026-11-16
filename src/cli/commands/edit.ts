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
import type { IncomingMessage, ServerResponse } from "node:http";

import { eventPlace, resolveWorld } from "../../core/derive.js";
import { buildIndex, validateWorld } from "../../core/validate.js";
import { loadWorld, resolveImagePath } from "../load.js";
import { readJsonBody, startLocalServer } from "../local-server.js";
import {
  createRecord,
  deleteRecord,
  fieldsFromForm,
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
    api: createEditorApi(root),
  });

  console.log(`timewright edit: ${root}`);
  console.log(`  http://${host}:${port}/`);
  console.log("  Edit the world in the browser. Ctrl-C to stop.");
  return 0;
}

/**
 * The editor's API.
 *
 * It is a function of its own so that it can be called without a
 * server: what the page can ask for, and what it can write, are the
 * two things worth testing.
 */
export function createEditorApi(root: string): (
  request: IncomingMessage,
  response: ServerResponse,
  url: string,
) => Promise<void> {
  return async (request, response, url) => {
    if (url === "/api/editor" && request.method === "GET") {
      respond(response, await describe(root));
      return;
    }
    if (url === "/api/record" && request.method === "POST") {
      const body = await readJsonBody(request);
      const kind = String(body.kind ?? "location") as EditableKind;
      const place = { file: body.file as string | undefined, index: body.index as number | undefined };
      // The page sends what the person typed. What that means for a
      // record - which fields it has, what an empty one means - is
      // decided here, where it can be tested.
      const values = (body.values ?? {}) as Record<string, string>;
      const built = fieldsFromForm(kind, values);
      if (!built.ok) {
        respond(response, { ok: false, message: built.message });
        return;
      }
      respond(response, await writeRecordFields(root, kind, place, built.fields));
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
  };
}

function respond(response: ServerResponse, payload: unknown): void {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function describe(root: string): Promise<unknown> {
  const loaded = await loadWorld(root);
  const world = resolveWorld(loaded.data);
  // The same ids the core uses: an event called "Battle of Waterloo" has
  // the id "battle-of-waterloo", and the editor has to look it up by that.
  const index = buildIndex(loaded.data);
  const issues = validateWorld(loaded.data);

  const maps = index.maps.map((record) => {
    const map = record.data;
    return {
      id: record.id,
      name: record.name,
      size: map.size ?? [1000, 700],
      file: record.file,
      index: record.index,
      images: (map.images ?? []).map((image) => ({
        file: image.file,
        from: image.from,
        until: image.until,
      })),
    };
  });

  const locations = index.locations.map((record) => {
    const location = record.data;
    return {
      id: record.id,
      name: record.name,
      aliases: location.aliases ?? [],
      // The map is written as a name, but the editor works in map ids.
      map: (location.map !== undefined ? index.mapNames.resolve(location.map) : undefined) ?? "",
      at: location.at ?? null,
      tags: location.tags ?? [],
      card: location.card ?? "",
      kind: location.kind ?? "fixed",
      file: record.file,
      index: record.index,
    };
  });

  const people = index.people.map((record) => {
    const person = record.data;
    return {
      id: record.id,
      name: record.name,
      aliases: person.aliases ?? [],
      born: person.born ?? "",
      died: person.died ?? "",
      tags: person.tags ?? [],
      bio: person.bio ?? "",
      file: record.file,
      index: record.index,
    };
  });

  const events = index.events.map((record) => {
    const event = record.data;
    const resolved = world.events.find((entry) => entry.id === record.id);
    const place = resolved !== undefined ? eventPlace(world, resolved) : undefined;
    return {
      id: record.id,
      title: event.title,
      when: event.when,
      where: typeof event.where === "string" ? event.where : "",
      // A place given as a raw point on the map has no name to offer, so
      // the editor leaves it alone rather than clearing it.
      whereIsPoint: typeof event.where === "object" && event.where !== null,
      map: place?.mapId ?? "",
      at: place?.at ?? null,
      people: event.people ?? [],
      tags: event.tags ?? [],
      card: event.card ?? "",
      file: record.file,
      index: record.index,
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
  const index = buildIndex(loaded.data);
  for (const record of index.maps) {
    if (record.id !== mapId) {
      continue;
    }
    const images = record.data.images ?? (record.data.file !== undefined ? [{ file: record.data.file }] : []);
    const image = images[0];
    if (image === undefined) {
      return undefined;
    }
    return resolveImagePath(root, record.file, image.file);
  }
  return undefined;
}
