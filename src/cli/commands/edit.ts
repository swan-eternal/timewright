/**
 * `timewright edit` - the full visual studio for building a Timewright world.
 *
 * Lets a creator manage world settings, main maps and nested sub-maps,
 * map images, locations (fixed & mobile), people/characters, and events
 * (at locations, at map coordinates, or general timeline-only events),
 * preview the interactive timeline viewer in-place, and export a ready-to-host
 * website `.zip` or standalone `.html` file.
 */

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  eventPlace,
  eventsAtPlace,
  imageForDate,
  locationVisibleAt,
  mapChain,
  resolveLocationAt,
  resolveWorld,
} from "../../core/derive.js";
import { buildIndex } from "../../core/building.js";
import { compareBounds, compareDates, dateValue, parseDate } from "../../core/dates.js";
import { dateFraction, eventDomain, fractionDate } from "../../core/scale.js";
import type { DateBound, ParsedDate } from "../../core/dates.js";
import type { ResolvedLocation, ResolvedPerson, ResolvedWorld } from "../../core/model.js";
import { validateWorld } from "../../core/validate.js";
import { loadWorld, resolveImagePath } from "../load.js";
import { readJsonBody, startLocalServer } from "../local-server.js";
import {
  createRecord,
  deleteRecord,
  fieldsFromForm,
  moveEventPoint,
  moveLocation,
  saveAssetImage,
  saveMapImage,
  writeRecordFields,
  writeWorldSettings,
  type EditableKind,
} from "../world-edit.js";
import { buildWorldSite, exportWorldArtifact } from "./build.js";
import { runInit } from "./init.js";

export interface EditOptions {
  world?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
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

export async function runEdit(options: EditOptions = {}): Promise<number> {
  const root = path.resolve(options.world ?? process.cwd());
  const port = options.port ?? 5175;
  const host = options.host ?? "127.0.0.1";

  // If opened in an empty folder with no world.yaml yet, offer/create a clean starter world?
  // Only initialize if completely empty so we never clobber an arbitrary folder.
  if (!existsSync(path.join(root, "world.yaml")) && !existsSync(path.join(root, "world.yml"))) {
    const { readdirSync } = await import("node:fs");
    if (!existsSync(root) || readdirSync(root).length === 0) {
      await runInit({ folder: root });
    }
  }

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
 * The editor's HTTP API handler.
 */
export function createEditorApi(root: string): (
  request: IncomingMessage,
  response: ServerResponse,
  url: string,
  query?: URLSearchParams,
) => Promise<void> {
  return async (request, response, url, query = new URLSearchParams()) => {
    if (url === "/api/editor" && request.method === "GET") {
      const fraction = query.get("fraction");
      respond(
        response,
        await describe(
          root,
          query.get("date") ?? undefined,
          fraction !== null && fraction !== "" ? Number(fraction) : undefined,
        ),
      );
      return;
    }

    if (url === "/api/world" && request.method === "POST") {
      const body = await readJsonBody(request);
      const values = (body.values ?? body) as Record<string, unknown>;
      respond(response, await writeWorldSettings(root, values));
      return;
    }

    if (url === "/api/record" && request.method === "POST") {
      const body = await readJsonBody(request);
      const kind = String(body.kind ?? "location") as EditableKind;
      if (!["map", "location", "person", "event"].includes(kind)) {
        respond(response, { ok: false, message: `unknown record kind "${kind}"` });
        return;
      }
      const place = {
        file: body.file as string | undefined,
        index: body.index as number | undefined,
      };
      const values = (body.values ?? {}) as Record<string, unknown>;
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
      if (!["map", "location", "person", "event"].includes(kind)) {
        respond(response, { ok: false, message: `unknown record kind "${kind}"` });
        return;
      }
      const record = (body.record ?? {}) as Record<string, unknown>;

      // If creating a map with an inline uploaded image or a default SVG placeholder:
      if (kind === "map" && record.createPlaceholder === true) {
        delete record.createPlaceholder;
        const mapSlug =
          String(record.id ?? record.name ?? "map")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "map";
        const svgName = `${mapSlug}.svg`;
        const w = Array.isArray(record.size) ? Number(record.size[0] ?? 1200) : 1200;
        const h = Array.isArray(record.size) ? Number(record.size[1] ?? 800) : 800;
        const titleText = String(record.name ?? "New Map").replace(/[<>&"]/g, "");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#ebe4d5"/>
  <rect x="24" y="24" width="${w - 48}" height="${h - 48}" fill="none" stroke="#c8bda8" stroke-width="2" stroke-dasharray="8 6"/>
  <text x="${w / 2}" y="${h / 2 - 10}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="28" fill="#6b6155">${titleText}</text>
  <text x="${w / 2}" y="${h / 2 + 24}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="15" fill="#8b8072">Upload a map image in the Map tab (${w} × ${h})</text>
</svg>\n`;
        const { mkdir, writeFile } = await import("node:fs/promises");
        const mapsDir = path.join(root, "maps");
        await mkdir(mapsDir, { recursive: true });
        await writeFile(path.join(mapsDir, svgName), svg, "utf8");
        record.size = [w, h];
        record.images = [{ file: svgName }];
      }

      const created = await createRecord(root, kind, record);

      // Optional convenience: when creating a sub-map from an anchor location, link `opens` on that location
      if (created.ok && kind === "map" && typeof body.linkFromLocationId === "string" && body.linkFromLocationId !== "") {
        const loaded = await loadWorld(root);
        const index = buildIndex(loaded.data);
        const opener = index.locations.find((loc) => loc.id === body.linkFromLocationId);
        if (opener?.file !== undefined) {
          await writeRecordFields(
            root,
            "location",
            { file: opener.file, index: opener.index },
            { opens: String(record.id ?? record.name ?? created.id ?? "") },
          );
        }
      }

      respond(response, created);
      return;
    }

    if (url === "/api/move" && request.method === "POST") {
      const body = await readJsonBody(request);
      const targetKind = String(body.kind ?? "location");
      if (targetKind === "event") {
        respond(
          response,
          await moveEventPoint(
            root,
            String(body.id ?? ""),
            String(body.mapId ?? ""),
            Number(body.x ?? 0),
            Number(body.y ?? 0),
          ),
        );
        return;
      }
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
      const place = {
        file: body.file as string | undefined,
        index: body.index as number | undefined,
      };
      respond(response, await deleteRecord(root, kind, place));
      return;
    }

    if (url === "/api/image" && request.method === "POST") {
      const body = await readJsonBody(request);
      const data = String(body.data ?? "");
      const bytes = Buffer.from(data.includes(",") ? data.split(",")[1] ?? "" : data, "base64");
      const mode = body.mode === "replace" ? "replace" : "add";
      respond(
        response,
        await saveMapImage(
          root,
          String(body.mapId ?? ""),
          String(body.fileName ?? "map.png"),
          bytes,
          {
            mode,
            from: typeof body.from === "string" ? body.from : undefined,
            until: typeof body.until === "string" ? body.until : undefined,
            caption: typeof body.caption === "string" ? body.caption : undefined,
          },
        ),
      );
      return;
    }

    if (url === "/api/asset" && request.method === "POST") {
      const body = await readJsonBody(request);
      const data = String(body.data ?? "");
      const bytes = Buffer.from(data.includes(",") ? data.split(",")[1] ?? "" : data, "base64");
      const rawBucket = String(body.bucket ?? "assets");
      const bucket =
        rawBucket === "people" || rawBucket === "locations" ? rawBucket : "assets";
      respond(
        response,
        await saveAssetImage(root, bucket, String(body.fileName ?? "image.png"), bytes),
      );
      return;
    }

    if (url.startsWith("/api/map-file/") && request.method === "GET") {
      const rest = url.slice("/api/map-file/".length);
      const slash = rest.indexOf("/");
      const mapId = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
      const requestedFile = slash === -1 ? undefined : decodeURIComponent(rest.slice(slash + 1));
      const dateStr = query.get("date") ?? undefined;
      const file = await imagePath(root, mapId, requestedFile, dateStr);
      if (file === undefined) {
        response.statusCode = 404;
        response.end("no image found");
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
      response.end(await readFile(file));
      return;
    }

    if (url === "/api/preview" && request.method === "GET") {
      const built = await exportWorldArtifact(root, "single-file", "./");
      if (!built.ok) {
        response.statusCode = 400;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(
          `<!doctype html><html><body style="font:15px/1.5 system-ui,sans-serif;padding:2rem;background:#f7f4ee;color:#2b2620"><h2>Cannot preview yet</h2><p>${escapeText(built.message)}</p></body></html>`,
        );
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", built.contentType);
      response.end(built.bytes);
      return;
    }

    if (url === "/api/export" && request.method === "GET") {
      const format = query.get("format") === "single-file" ? "single-file" : "zip";
      const base = query.get("base") || "./";
      const built = await exportWorldArtifact(root, format, base);
      if (!built.ok) {
        response.statusCode = 400;
        respond(response, { ok: false, message: built.message, issues: built.issues });
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", built.contentType);
      response.setHeader("Content-Disposition", `attachment; filename="${built.fileName}"`);
      response.end(built.bytes);
      return;
    }

    if (url === "/api/build-disk" && request.method === "POST") {
      const body = await readJsonBody(request);
      const base = typeof body.base === "string" && body.base.trim() !== "" ? body.base.trim() : "./";
      const outDir = path.join(root, "dist");
      const built = await buildWorldSite({
        world: root,
        out: outDir,
        base,
        singleFile: true,
        zip: true,
        quiet: true,
      });
      if (!built.ok) {
        const errors = built.issues.filter((i) => i.severity === "error");
        respond(response, {
          ok: false,
          message: errors.map((e) => e.message).join("; ") || "Build failed",
          issues: built.issues,
        });
        return;
      }
      respond(response, {
        ok: true,
        message: `Built static site to ${outDir} (including world.html and website.zip)`,
        outDir,
      });
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  };
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function respond(response: ServerResponse, payload: unknown): void {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

export async function describe(
  root: string,
  dateStr?: string,
  fraction?: number,
): Promise<unknown> {
  const loaded = await loadWorld(root);
  const world = resolveWorld(loaded.data);
  const index = buildIndex(loaded.data);
  const issues = [...loaded.issues, ...validateWorld(loaded.data)];

  // The date the Studio is looking at: what it asked for, or where the
  // world begins. Everything below - which image a map shows, where a
  // vessel is, who is present - is answered at this date.
  const active = resolveActiveDate(world, dateStr, fraction);
  const atDate: DateBound | undefined = active.parsed;
  const extraWarnings: { message: string; record: string }[] = [];
  if (active.warning !== undefined) {
    extraWarnings.push({ message: active.warning, record: "" });
  }

  // Identify inline map indices inside world.yaml if any
  const worldFile = loaded.data.world.file;
  let inlineCounter = 0;

  // Which maps are still the placeholder the Studio draws: the creator
  // asked for a map, and got a note asking for a map.
  const placeholderMaps = new Map<string, boolean>();
  for (const record of index.maps) {
    const images = record.data.images ?? (record.data.file !== undefined ? [{ file: record.data.file }] : []);
    placeholderMaps.set(record.id, await isPlaceholderMap(root, record.file, images));
  }

  const maps = index.maps.map((record) => {
    const map = record.data;
    const isInline = worldFile !== undefined && record.file === worldFile && record.index === undefined;
    const recordIndex = isInline ? inlineCounter++ : record.index;
    const sourceImages = map.images ?? (map.file !== undefined ? [{ file: map.file }] : []);
    const parentId = map.parent !== undefined ? index.mapNames.resolve(map.parent) ?? map.parent : "";
    const chain = mapChain(world, record.id).map((m) => ({ id: m.id, name: m.name }));
    const openedBy = index.locations
      .filter((loc) => loc.data.opens !== undefined && index.mapNames.resolve(loc.data.opens) === record.id)
      .map((loc) => ({ id: loc.id, name: loc.name }));
    const resolved = world.maps.find((entry) => entry.id === record.id);
    const activeImage = resolved !== undefined ? imageForDate(resolved, atDate) : undefined;

    return {
      id: record.id,
      explicitId: map.id ?? "",
      name: record.name,
      aliases: map.aliases ?? [],
      parent: parentId,
      size: map.size ?? [1200, 800],
      tags: map.tags ?? [],
      notes: map.notes ?? "",
      chain,
      openedBy,
      activeImage: activeImage?.file ?? sourceImages[0]?.file ?? "",
      placeholder: placeholderMaps.get(record.id) === true,
      file: record.file,
      index: recordIndex,
      images: sourceImages.map((image) => ({
        file: image.file,
        from: image.from !== undefined ? String(image.from) : "",
        until: image.until !== undefined ? String(image.until) : "",
        caption: image.caption ?? "",
      })),
    };
  });

  const locations = index.locations.map((record) => {
    const location = record.data;
    const resolvedMap = location.map !== undefined ? index.mapNames.resolve(location.map) : undefined;
    const resolvedOpens = location.opens !== undefined ? index.mapNames.resolve(location.opens) : undefined;

    // Where this place is at the Studio's date. A fixed place answers with
    // its own map; a vessel answers with wherever it is that day, and
    // names the place that is hosting it.
    const resolvedPlace = world.locations.find((entry) => entry.id === record.id);
    const visible = resolvedPlace !== undefined ? locationVisibleAt(resolvedPlace, atDate) : true;
    const placed = resolvedPlace !== undefined ? resolveLocationAt(world, record.id, atDate) : undefined;
    const placedMap = placed?.mapId ?? resolvedMap ?? "";
    const placedAt = placed?.at ?? location.at ?? null;
    const host = resolvedPlace !== undefined ? hostLocationName(world, resolvedPlace, atDate) : "";

    // The places a vessel has been: every stop of its route, so the
    // Studio can draw the whole journey and not only where it is today.
    const routes = (resolvedPlace?.stays ?? []).map((stay) => {
      const target = resolveLocationAt(world, stay.at, stay.from);
      return {
        at: stay.at,
        name: world.locations.find((entry) => entry.id === stay.at)?.name ?? stay.at,
        map: target?.mapId ?? "",
        mapAt: target?.at ?? null,
        from: stay.from?.raw ?? "",
        until: stay.until?.raw ?? "",
      };
    });

    // The events that happen here - the same ones the Viewer counts on
    // this place's pin, so the two never disagree.
    const eventIds = eventsAtPlace(world, record.id, placedMap === "" ? undefined : placedMap, atDate).map(
      (event) => event.id,
    );

    return {
      id: record.id,
      name: record.name,
      aliases: location.aliases ?? [],
      map: resolvedMap ?? location.map ?? "",
      at: location.at ?? null,
      opens: resolvedOpens ?? location.opens ?? "",
      existsFrom: location.exists?.from !== undefined ? String(location.exists.from) : "",
      existsUntil: location.exists?.until !== undefined ? String(location.exists.until) : "",
      stays: (location.stays ?? []).map((s) => ({
        at: s.at,
        from: s.from !== undefined ? String(s.from) : "",
        until: s.until !== undefined ? String(s.until) : "",
        note: s.note ?? "",
      })),
      tags: location.tags ?? [],
      card: location.card ?? location.bio ?? "",
      image: location.image ?? "",
      notes: location.notes ?? "",
      kind: location.kind === "mobile" ? "mobile" : "fixed",
      visibleAtDate: visible,
      resolvedMap: placedMap,
      resolvedAt: placedAt,
      hostLocationName: host,
      routes,
      eventIds,
      file: record.file,
      index: record.index,
    };
  });

  const people = index.people.map((record) => {
    const person = record.data;
    const resolvedPerson = world.people.find((entry) => entry.id === record.id);
    const activeLocationId = resolvedPerson !== undefined ? activeStayLocation(world, resolvedPerson, atDate) : "";
    return {
      id: record.id,
      name: record.name,
      aliases: person.aliases ?? [],
      born: person.born !== undefined ? String(person.born) : "",
      died: person.died !== undefined ? String(person.died) : "",
      color: person.color ?? "",
      stays: (person.stays ?? []).map((s) => ({
        at: s.at,
        from: s.from !== undefined ? String(s.from) : "",
        until: s.until !== undefined ? String(s.until) : "",
        note: s.note ?? "",
      })),
      tags: person.tags ?? [],
      bio: person.bio ?? "",
      image: person.image ?? "",
      notes: person.notes ?? "",
      activeLocationId,
      file: record.file,
      index: record.index,
    };
  });

  const events = index.events.map((record) => {
    const event = record.data;
    const resolved = world.events.find((entry) => entry.id === record.id);
    const place = resolved !== undefined ? eventPlace(world, resolved) : undefined;
    const rawWhere = event.where;
    const isPoint = typeof rawWhere === "object" && rawWhere !== null;
    const whereMode = rawWhere === undefined ? "general" : isPoint ? "point" : "location";
    const pointMap = isPoint ? index.mapNames.resolve(rawWhere.map) ?? rawWhere.map : "";
    const pointAt = isPoint ? rawWhere.at : null;

    return {
      id: record.id,
      title: event.title,
      when: String(event.when),
      whereMode,
      where: typeof rawWhere === "string" ? rawWhere : "",
      whereIsPoint: isPoint,
      whereMap: pointMap,
      whereAt: pointAt,
      map: place?.mapId ?? "",
      at: place?.at ?? null,
      locationId: place?.location?.id ?? "",
      people: event.people ?? [],
      locations: event.locations ?? [],
      tags: event.tags ?? [],
      order: event.order ?? "",
      card: event.card ?? "",
      notes: event.notes ?? "",
      file: record.file,
      index: record.index,
    };
  });

  const rawWorld = index.world;
  return {
    root,
    activeDate: active.parsed?.raw ?? "",
    timeline: buildTimeline(world, atDate),
    world: {
      title: rawWorld.title,
      overworld:
        (rawWorld.overworld !== undefined ? index.mapNames.resolve(rawWorld.overworld) : undefined) ??
        rawWorld.overworld ??
        "",
      start: rawWorld.start !== undefined ? String(rawWorld.start) : "",
      end: rawWorld.end !== undefined ? String(rawWorld.end) : "",
      calendar: rawWorld.calendar ?? "gregorian",
    },
    maps,
    locations,
    people,
    events,
    issues: issues.map((issue) => ({
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      record: issue.record ?? "",
      field: issue.field ?? "",
      suggestion: issue.suggestion ?? "",
    })),
    warnings: [
      ...issues
        .filter((issue) => issue.severity === "warning")
        .map((issue) => ({ message: issue.message, record: issue.record ?? "" })),
      ...extraWarnings,
    ],
  };
}

/**
 * Whether a map's image is a placeholder rather than a real map.
 *
 * Both placeholders say so in their own text: the one the Studio draws
 * ("Upload a map image in the Map tab") and the sketch the starter
 * world ships ("replace it with your own map"). Any other SVG is the
 * creator's own work.
 *
 * Only a small file is read: a map picture can be enormous, and none
 * of them carry a note.
 */
async function isPlaceholderMap(
  root: string,
  sourceFile: string | undefined,
  images: { file: string }[],
): Promise<boolean> {
  const notes = ["Upload a map image in the Map tab", "replace it with your own map"];
  for (const image of images) {
    if (!image.file.toLowerCase().endsWith(".svg")) {
      continue;
    }
    const file = await resolveImagePath(root, sourceFile, image.file);
    if (file === undefined) {
      continue;
    }
    try {
      if (statSync(file).size > 64 * 1024) {
        continue;
      }
      const text = await readFile(file, "utf8");
      if (notes.some((note) => text.includes(note))) {
        return true;
      }
    } catch {
      // A file that cannot be read is not a placeholder.
    }
  }
  return false;
}

/**
 * The date the Studio is looking at.
 *
 * What the caller asked for, when it parses. Otherwise where the world
 * starts, or else the earliest thing that happens in it.
 */
function resolveActiveDate(
  world: ResolvedWorld,
  dateStr: string | undefined,
  fraction: number | undefined,
): { parsed: DateBound | undefined; warning?: string } {
  // A playhead dragged along the strip asks for its place in the time,
  // not for a date: the world works out which day that is.
  if (fraction !== undefined && Number.isFinite(fraction)) {
    const domain = eventDomain(world, { includeUnplaced: true });
    if (domain !== undefined) {
      return { parsed: fractionDate(Math.min(Math.max(fraction, 0), 1), domain) };
    }
  }
  const options = { calendar: world.calendar };
  if (dateStr !== undefined && dateStr.trim() !== "") {
    try {
      return { parsed: parseDate(dateStr.trim(), options) };
    } catch (error) {
      const fallback = defaultActiveDate(world);
      return {
        parsed: fallback,
        warning: `"${dateStr}" is not a date I understand; showing ${fallback?.raw ?? "nothing"} instead.`,
      };
    }
  }
  return { parsed: defaultActiveDate(world) };
}

function defaultActiveDate(world: ResolvedWorld): ParsedDate | undefined {
  if (world.start !== undefined) {
    return world.start;
  }
  let earliest: ParsedDate | undefined;
  for (const event of world.events) {
    if (earliest === undefined || compareDates(event.when, earliest) < 0) {
      earliest = event.when;
    }
  }
  return earliest;
}

/**
 * The strip of time the Studio draws across the bottom of the canvas.
 *
 * Every event the creator wrote gets a tick, including the ones with no
 * place on a map: the Studio is for authoring, so nothing is hidden from
 * the person doing the authoring.
 *
 * The strip is also the thing the playhead moves along, so it carries
 * the numbers a client needs to turn a fraction of the strip back into a
 * date without re-reading the world.
 */
function buildTimeline(
  world: ResolvedWorld,
  atDate: DateBound | undefined,
): {
  start: string;
  end: string;
  startValue: number;
  endValue: number;
  activeFraction: number;
  activeValue: number;
  events: unknown[];
} {
  const domain = eventDomain(world, { includeUnplaced: true });
  const events = world.events
    .map((event) => {
      const place = eventPlace(world, event);
      const whereMode =
        event.where === undefined ? "general" : event.where.location !== undefined ? "location" : "point";
      return {
        id: event.id,
        title: event.title,
        when: event.when.raw,
        value: dateValue(event.when),
        fraction: domain !== undefined ? dateFraction(event.when, domain) : 0,
        whereMode,
        map: place?.mapId ?? "",
        locationId: place?.location?.id ?? "",
        current:
          atDate !== undefined && domain !== undefined && compareBounds(atDate, event.when) === 0,
      };
    })
    .sort((a, b) => a.value - b.value);

  return {
    start: domain?.from.raw ?? "",
    end: domain?.to.raw ?? "",
    startValue: domain !== undefined ? dateValue(domain.from) : 0,
    endValue: domain !== undefined ? dateValue(domain.to) : 0,
    activeFraction:
      domain !== undefined && atDate !== undefined ? dateFraction(atDate, domain) : 0,
    activeValue: atDate !== undefined ? dateValue(atDate) : 0,
    events,
  };
}

/**
 * The place hosting a vessel on a given day.
 *
 * A vessel stays at a place; a vessel that stays at another vessel is
 * hosted by wherever that one is. The chain is short, and it cannot be
 * circular, so it is followed only so far.
 */
function hostLocationName(
  world: ResolvedWorld,
  location: ResolvedLocation,
  atDate: DateBound | undefined,
): string {
  // A fixed place hosts nothing: it is the thing being hosted.
  if (location.kind !== "mobile") {
    return "";
  }
  const hostId = hostLocationId(world, location.id, atDate, 0);
  if (hostId === undefined) {
    return "";
  }
  return world.locations.find((entry) => entry.id === hostId)?.name ?? "";
}

function hostLocationId(
  world: ResolvedWorld,
  locationId: string,
  atDate: DateBound | undefined,
  depth: number,
): string | undefined {
  if (depth > 8) {
    return undefined;
  }
  const location = world.locations.find((entry) => entry.id === locationId);
  if (location === undefined) {
    return undefined;
  }
  if (location.kind !== "mobile") {
    return location.id;
  }
  for (const stay of location.stays) {
    if (!stayCovers(stay, atDate)) {
      continue;
    }
    return hostLocationId(world, stay.at, atDate, depth + 1) ?? stay.at;
  }
  return undefined;
}

/**
 * Where a person is on a given day: the place their stay names, or the
 * place hosting the vessel they are aboard.
 */
function activeStayLocation(
  world: ResolvedWorld,
  person: ResolvedPerson,
  atDate: DateBound | undefined,
): string {
  for (const stay of person.stays) {
    if (!stayCovers(stay, atDate)) {
      continue;
    }
    return hostLocationId(world, stay.at, atDate, 0) ?? stay.at;
  }
  return "";
}

/**
 * Whether a stay is running on a given day. Both ends are inclusive.
 */
function stayCovers(stay: { from?: DateBound | undefined; until?: DateBound | undefined }, atDate: DateBound | undefined): boolean {
  if (atDate === undefined) {
    return true;
  }
  if (stay.from !== undefined && compareBounds(atDate, stay.from) < 0) {
    return false;
  }
  if (stay.until !== undefined && compareBounds(atDate, stay.until) > 0) {
    return false;
  }
  return true;
}

async function imagePath(
  root: string,
  mapId: string,
  requestedFile?: string,
  dateStr?: string,
): Promise<string | undefined> {
  const loaded = await loadWorld(root);
  const index = buildIndex(loaded.data);
  const resolvedWorld = resolveWorld(loaded.data);

  for (const record of index.maps) {
    if (record.id !== mapId) {
      continue;
    }
    if (requestedFile !== undefined && requestedFile !== "") {
      return resolveImagePath(root, record.file, requestedFile);
    }
    const resolvedMap = resolvedWorld.maps.find((m) => m.id === mapId);
    if (dateStr !== undefined && dateStr !== "" && resolvedMap !== undefined) {
      try {
        const parsed = parseDate(dateStr, { calendar: resolvedWorld.calendar });
        const chosen = imageForDate(resolvedMap, parsed);
        if (chosen !== undefined) {
          return resolveImagePath(root, record.file, chosen.file);
        }
      } catch {
        // Fall back to first image
      }
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
