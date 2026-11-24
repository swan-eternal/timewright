/**
 * Writing to a world.
 *
 * The editor and the picker both change the YAML in place. The files stay
 * the source of truth, so an agent or git workflow can keep working on a
 * world a person has been editing in the browser.
 *
 * Existing YAML documents are edited in place so comments and formatting
 * survive. New records go into the kind's list file when there is one, and
 * into their own file when there is not.
 */

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { isMap, isSeq, parseDocument, stringify, type YAMLSeq } from "yaml";

import { slugify } from "../core/resolve.js";
import { buildIndex } from "../core/building.js";
import { canonicalReference, type RefKind } from "../core/references.js";
import type { MapImageRecord, StayRecord } from "../core/schema.js";

export type EditableKind = "map" | "location" | "person" | "event";

export interface RecordPlace {
  /** The file the record lives in. */
  file?: string | undefined;
  /** Which record in that file it is, when the file holds a list. */
  index?: number | undefined;
}

export interface EditResult {
  ok: boolean;
  message: string;
  file?: string | undefined;
  id?: string | undefined;
  fileName?: string | undefined;
}

/**
 * Standard fields each kind of record can change from the editor form.
 */
const EDITABLE_FIELDS: Record<
  EditableKind,
  { required: { key: string; label: string }[]; optional: string[]; lists: string[] }
> = {
  map: {
    required: [{ key: "name", label: "a name" }],
    optional: ["id", "parent", "notes"],
    lists: ["aliases", "tags"],
  },
  location: {
    required: [{ key: "name", label: "a name" }],
    optional: ["map", "opens", "kind", "card", "image", "notes"],
    lists: ["aliases", "tags"],
  },
  person: {
    required: [{ key: "name", label: "a name" }],
    optional: ["born", "died", "color", "bio", "image", "notes"],
    lists: ["aliases", "tags"],
  },
  event: {
    required: [
      { key: "title", label: "a title" },
      { key: "when", label: "a date" },
    ],
    optional: ["where", "until", "card", "notes"],
    lists: ["people", "locations", "tags"],
  },
};

function resolveWithinWorld(root: string, file: string): string | undefined {
  const resolved = path.resolve(file);
  const base = path.resolve(root);
  if (!resolved.startsWith(base + path.sep)) {
    return undefined;
  }
  return resolved;
}

function isRecordAt(document: { getIn(path: unknown[]): unknown }, index: number): boolean {
  if (!Number.isInteger(index) || index < 0) {
    return false;
  }
  const node = document.getIn([index]);
  return isMap(node);
}

function parseOptionalCoord(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const text = String(raw).trim();
  if (text === "") {
    return undefined;
  }
  const num = Number(text);
  return Number.isFinite(num) ? Math.round(num) : undefined;
}

function sanitizeStays(raw: unknown): StayRecord[] | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  const stays: StayRecord[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const at = String(entry.at ?? "").trim();
    if (at === "") {
      continue;
    }
    const stay: StayRecord = { at };
    const from = String(entry.from ?? "").trim();
    const until = String(entry.until ?? "").trim();
    const note = String(entry.note ?? "").trim();
    if (from !== "") {
      stay.from = from;
    }
    if (until !== "") {
      stay.until = until;
    }
    if (note !== "") {
      stay.note = note;
    }
    stays.push(stay);
  }
  return stays.length > 0 ? stays : null;
}

function sanitizeMapImages(raw: unknown): MapImageRecord[] | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  const images: MapImageRecord[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const file = String(entry.file ?? "").trim();
    if (file === "") {
      continue;
    }
    const img: MapImageRecord = { file };
    const from = String(entry.from ?? "").trim();
    const until = String(entry.until ?? "").trim();
    const caption = String(entry.caption ?? "").trim();
    if (from !== "") {
      img.from = from;
    }
    if (until !== "") {
      img.until = until;
    }
    if (caption !== "") {
      img.caption = caption;
    }
    images.push(img);
  }
  return images.length > 0 ? images : null;
}

/**
 * Convert form values from the editor into YAML-ready field updates.
 *
 * - Keys omitted from `values` are left untouched on disk.
 * - Keys with a value are written.
 * - Keys with an empty value become `null`, removing the key cleanly.
 */
export function fieldsFromForm(
  kind: EditableKind,
  values: Record<string, unknown>,
): { ok: true; fields: Record<string, unknown> } | { ok: false; message: string } {
  const shape = EDITABLE_FIELDS[kind];
  const fields: Record<string, unknown> = {};

  for (const { key, label } of shape.required) {
    if (!(key in values)) {
      continue;
    }
    const value = String(values[key] ?? "").trim();
    if (value === "") {
      return { ok: false, message: `this ${kind} needs ${label}` };
    }
    fields[key] = value;
  }

  for (const key of shape.optional) {
    if (!(key in values)) {
      continue;
    }
    const value = String(values[key] ?? "").trim();
    if (kind === "location" && key === "kind") {
      fields.kind = value === "mobile" ? "mobile" : null;
      continue;
    }
    fields[key] = value === "" ? null : value;
  }

  for (const key of shape.lists) {
    if (!(key in values)) {
      continue;
    }
    const rawVal = values[key];
    const list = Array.isArray(rawVal)
      ? rawVal.map((part) => String(part).trim()).filter((part) => part !== "")
      : String(rawVal ?? "")
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part !== "");
    fields[key] = list.length === 0 ? null : list;
  }

  // Kind-specific structured fields
  if (kind === "map") {
    if ("images" in values) {
      fields.images = sanitizeMapImages(values.images);
      if (fields.images !== undefined) {
        // Normalize single `file` shorthand into `images` list when editing images
        fields.file = null;
      }
    }
    if ("width" in values || "height" in values) {
      const w = parseOptionalCoord(values.width);
      const h = parseOptionalCoord(values.height);
      if (w !== undefined && h !== undefined && w > 0 && h > 0) {
        fields.size = [w, h];
      } else if (String(values.width ?? "").trim() === "" && String(values.height ?? "").trim() === "") {
        fields.size = null;
      }
    }
  }

  if (kind === "location") {
    const isMobile = fields.kind === "mobile";
    if (isMobile) {
      fields.at = null;
      fields.map = null;
    } else if ("atX" in values || "atY" in values) {
      const x = parseOptionalCoord(values.atX);
      const y = parseOptionalCoord(values.atY);
      if (x !== undefined && y !== undefined) {
        fields.at = [x, y];
      } else if (String(values.atX ?? "").trim() === "" && String(values.atY ?? "").trim() === "") {
        fields.at = null;
      }
    }

    if ("existsFrom" in values || "existsUntil" in values) {
      const from = String(values.existsFrom ?? "").trim();
      const until = String(values.existsUntil ?? "").trim();
      if (from === "" && until === "") {
        fields.exists = null;
      } else {
        const existsObj: Record<string, string> = {};
        if (from !== "") existsObj.from = from;
        if (until !== "") existsObj.until = until;
        fields.exists = existsObj;
      }
    }

    if ("stays" in values) {
      fields.stays = isMobile ? sanitizeStays(values.stays) : null;
    }
  }

  if (kind === "person") {
    if ("stays" in values) {
      fields.stays = sanitizeStays(values.stays);
    }
  }

  if (kind === "event") {
    if ("order" in values) {
      const rawOrder = String(values.order ?? "").trim();
      if (rawOrder === "") {
        fields.order = null;
      } else {
        const parsedOrder = Number(rawOrder);
        if (!Number.isFinite(parsedOrder)) {
          return { ok: false, message: "event order must be a number" };
        }
        fields.order = parsedOrder;
      }
    }

    // Event placement mode: "general" (timeline only), "location" (named location), or "point" (map + [x,y])
    if ("whereMode" in values) {
      const mode = String(values.whereMode ?? "");
      if (mode === "general" || mode === "none") {
        fields.where = null;
      } else if (mode === "location") {
        const locName = String(values.whereLocation ?? values.where ?? "").trim();
        fields.where = locName === "" ? null : locName;
      } else if (mode === "point") {
        const mapName = String(values.whereMap ?? "").trim();
        const x = parseOptionalCoord(values.whereX);
        const y = parseOptionalCoord(values.whereY);
        if (mapName === "" || x === undefined || y === undefined) {
          return { ok: false, message: "a map coordinate event needs a map and X/Y coordinates" };
        }
        fields.where = { map: mapName, at: [x, y] };
      }
    }
  }

  return { ok: true, fields };
}

const DIRECTORIES: Record<EditableKind, string> = {
  map: "maps",
  location: "locations",
  person: "people",
  event: "events",
};

const LIST_FILES: Record<EditableKind, string[]> = {
  map: ["maps.yaml", "maps.yml"],
  location: ["locations.yaml", "locations.yml"],
  person: ["people.yaml", "people.yml"],
  event: ["events.yaml", "events.yml"],
};

async function findFirst(root: string, names: string[]): Promise<string | undefined> {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function findListFile(root: string, kind: EditableKind): Promise<string | undefined> {
  const names = LIST_FILES[kind];
  const inFolder = await findFirst(path.join(root, DIRECTORIES[kind]), names);
  if (inFolder !== undefined) {
    return inFolder;
  }
  if (kind === "map") {
    // Also check if maps/ already has a single YAML list file such as region.yaml or europe.yaml
    const mapsDir = path.join(root, "maps");
    if (existsSync(mapsDir)) {
      const { readdir } = await import("node:fs/promises");
      const files = (await readdir(mapsDir)).filter((f) => /\.ya?ml$/i.test(f)).sort();
      if (files.length === 1 && files[0] !== undefined) {
        const candidate = path.join(mapsDir, files[0]);
        const text = await readFile(candidate, "utf8");
        const doc = parseDocument(text);
        if (isSeq(doc.contents)) {
          return candidate;
        }
      }
    }
  }
  return findFirst(root, names);
}

function documentText(document: ReturnType<typeof parseDocument>): string {
  return document.toString({ collectionStyle: "any" });
}

function rootSequence(document: ReturnType<typeof parseDocument>): YAMLSeq<unknown> | undefined {
  const contents: unknown = document.contents;
  return isSeq(contents as YAMLSeq<unknown>) ? (contents as YAMLSeq<unknown>) : undefined;
}

function isWorldYaml(root: string, file: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel === "world.yaml" || rel === "world.yml";
}

/** Update world-level metadata in `world.yaml` (title, overworld, start, end). */
export async function writeWorldSettings(
  root: string,
  values: Record<string, unknown>,
): Promise<EditResult> {
  const worldFile =
    (await findFirst(root, ["world.yaml", "world.yml"])) ?? path.join(root, "world.yaml");
  const resolved = resolveWithinWorld(root, worldFile);
  if (resolved === undefined) {
    return { ok: false, message: "world.yaml is outside the world folder" };
  }

  const title = String(values.title ?? "").trim();
  if ("title" in values && title === "") {
    return { ok: false, message: "the world needs a title" };
  }

  const text = existsSync(resolved) ? await readFile(resolved, "utf8") : "title: My World\n";
  const document = parseDocument(text);

  if ("title" in values) {
    document.setIn(["title"], title);
  }
  for (const key of ["overworld", "start", "end"] as const) {
    if (!(key in values)) {
      continue;
    }
    const raw = String(values[key] ?? "").trim();
    if (raw === "") {
      document.deleteIn([key]);
    } else {
      document.setIn([key], raw);
    }
  }

  await writeFile(resolved, documentText(document), "utf8");
  return { ok: true, message: "saved world settings", file: resolved };
}

/**
 * Set the world's theme block. Only the fields present are touched:
 * a value writes, an empty value removes the key, and a theme left
 * with nothing in it disappears - an unthemed world stays unthemed.
 */
/**
 * Delete a key under theme, tolerating blocks that are not there: the
 * yaml library throws when a delete path walks through a key that is
 * merely missing, and clearing an absent theme must stay a no-op.
 */
function deleteUnderTheme(
  document: ReturnType<typeof parseDocument>,
  ...rest: string[]
): void {
  try {
    document.deleteIn(["theme", ...rest]);
  } catch {
    // A parent that is not a collection: nothing to delete.
  }
}

export async function writeWorldTheme(
  root: string,
  values: Record<string, unknown>,
): Promise<EditResult> {
  const worldFile =
    (await findFirst(root, ["world.yaml", "world.yml"])) ?? path.join(root, "world.yaml");
  const resolved = resolveWithinWorld(root, worldFile);
  if (resolved === undefined) {
    return { ok: false, message: "world.yaml is outside the world folder" };
  }
  const text = existsSync(resolved) ? await readFile(resolved, "utf8") : "title: My World\n";
  const document = parseDocument(text);

  if ("preset" in values) {
    const preset = String(values.preset ?? "").trim();
    if (preset === "") {
      deleteUnderTheme(document, "preset");
    } else {
      document.setIn(["theme", "preset"], preset);
    }
  }

  const fonts = (values.fonts ?? {}) as Record<string, unknown>;
  for (const role of ["heading", "body"] as const) {
    if (!(role in fonts)) {
      continue;
    }
    const value = String(fonts[role] ?? "").trim();
    // "default" is the shelf's own name for no override.
    if (value === "" || value === "default") {
      deleteUnderTheme(document, "fonts", role);
    } else {
      document.setIn(["theme", "fonts", role], value);
    }
  }

  const colors = (values.colors ?? {}) as Record<string, unknown>;
  for (const [key, raw] of Object.entries(colors)) {
    const value = String(raw ?? "").trim();
    if (value === "") {
      deleteUnderTheme(document, "colors", key);
      continue;
    }
    if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
      return { ok: false, message: `theme color "${key}" is not a hex color (e.g. #1f4fa0)` };
    }
    document.setIn(["theme", "colors", key], value);
  }

  // Blocks and the theme itself disappear when nothing is left in them.
  const plain = (document.toJS() ?? {}) as Record<string, unknown>;
  const theme = plain.theme as Record<string, unknown> | undefined;
  if (theme !== undefined) {
    for (const block of ["fonts", "colors"] as const) {
      const value = theme[block];
      if (value !== null && typeof value === "object" && Object.keys(value).length === 0) {
        deleteUnderTheme(document, block);
        delete theme[block];
      }
    }
    if (Object.keys(theme).length === 0) {
      deleteUnderTheme(document);
    }
  }

  await writeFile(resolved, documentText(document), "utf8");
  return { ok: true, message: "saved theme", file: resolved };
}

/**
 * Set the world's timeline axis. Chapters mode writes the chapters
 * block; date mode clears it. Event `when` values are never touched -
 * a number means whichever axis the world counts, so switching is a
 * relabel, not a rewrite.
 */
export async function writeWorldTimeline(
  root: string,
  values: Record<string, unknown>,
): Promise<EditResult> {
  const worldFile =
    (await findFirst(root, ["world.yaml", "world.yml"])) ?? path.join(root, "world.yaml");
  const resolved = resolveWithinWorld(root, worldFile);
  if (resolved === undefined) {
    return { ok: false, message: "world.yaml is outside the world folder" };
  }

  const rows = Array.isArray(values.chapters) ? values.chapters : [];
  const chapters: { n: number; title: string }[] = [];
  const seen = new Set<number>();
  for (const entry of rows) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const n = Number(row.n);
    const title = String(row.title ?? "").trim();
    if (!Number.isInteger(n)) {
      return {
        ok: false,
        message: `chapter number "${String(row.n ?? "")}" is not a whole number`,
      };
    }
    if (title === "") {
      return { ok: false, message: `chapter ${n} needs a title` };
    }
    if (seen.has(n)) {
      return { ok: false, message: `chapter ${n} is listed twice` };
    }
    seen.add(n);
    chapters.push({ n, title });
  }
  chapters.sort((a, b) => a.n - b.n);

  const text = existsSync(resolved) ? await readFile(resolved, "utf8") : "title: My World\n";
  const document = parseDocument(text);
  document.deleteIn(["chapters"]);
  if (chapters.length > 0) {
    // A Map keeps the numbers numeric as YAML keys, in sorted order.
    document.setIn(["chapters"], new Map(chapters.map(({ n, title }) => [n, title])));
  }

  await writeFile(resolved, documentText(document), "utf8");
  return {
    ok: true,
    message:
      chapters.length > 0 ? `saved ${chapters.length} chapters` : "cleared the chapter list",
    file: resolved,
  };
}

/**
 * Write the calendar block, or clear it back to gregorian. The shape
 * is exactly the format doc's: months as names or a count, one days
 * count or one per month, and eras anchoring their year 0 - an era
 * named AF starting at 1200 makes "AF 15" the absolute year 1215.
 */
export async function writeWorldCalendar(
  root: string,
  values: Record<string, unknown>,
): Promise<EditResult> {
  const worldFile =
    (await findFirst(root, ["world.yaml", "world.yml"])) ?? path.join(root, "world.yaml");
  const resolved = resolveWithinWorld(root, worldFile);
  if (resolved === undefined) {
    return { ok: false, message: "world.yaml is outside the world folder" };
  }

  const raw = "calendar" in values ? values.calendar : null;
  const text = existsSync(resolved) ? await readFile(resolved, "utf8") : "title: My World\n";
  const document = parseDocument(text);

  if (raw === null || raw === undefined || raw === "" || raw === "gregorian") {
    document.deleteIn(["calendar"]);
    await writeFile(resolved, documentText(document), "utf8");
    return { ok: true, message: "cleared the calendar (back to gregorian)", file: resolved };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "the calendar must be a calendar object, or empty for gregorian" };
  }
  const spec = raw as Record<string, unknown>;

  // Months: a list of names, or a count of unnamed months.
  let monthCount = 0;
  let monthNames: string[] | undefined;
  if (spec.months !== undefined && spec.months !== null && spec.months !== "") {
    if (typeof spec.months === "number") {
      if (!Number.isInteger(spec.months) || spec.months < 1 || spec.months > 36) {
        return { ok: false, message: "months must be a whole number between 1 and 36" };
      }
      monthCount = spec.months;
    } else if (Array.isArray(spec.months)) {
      monthNames = spec.months.map((name) => String(name ?? "").trim());
      if (monthNames.length === 0) {
        return { ok: false, message: "a custom calendar needs at least one month" };
      }
      for (let i = 0; i < monthNames.length; i++) {
        const name = monthNames[i]!;
        if (name === "") {
          return { ok: false, message: `month ${i + 1} needs a name` };
        }
        if (monthNames.slice(0, i).some((other) => other.toLowerCase() === name.toLowerCase())) {
          return { ok: false, message: `month "${name}" is listed twice` };
        }
      }
      monthCount = monthNames.length;
    } else {
      return { ok: false, message: "months must be a list of names, or a count" };
    }
  }

  // Days per month: one count, or one count per month.
  if (spec.days_per_month !== undefined && spec.days_per_month !== null && spec.days_per_month !== "") {
    const days = spec.days_per_month;
    if (typeof days === "number") {
      if (!Number.isInteger(days) || days < 1) {
        return { ok: false, message: "days per month must be a whole number of 1 or more" };
      }
    } else if (Array.isArray(days)) {
      for (const day of days) {
        if (!Number.isInteger(Number(day)) || Number(day) < 1) {
          return { ok: false, message: "days per month must be whole numbers of 1 or more" };
        }
      }
      if (monthCount > 0 && days.length !== monthCount) {
        return {
          ok: false,
          message: `days per month lists ${days.length} months, but the calendar has ${monthCount}`,
        };
      }
    } else {
      return { ok: false, message: "days per month must be a number, or a list with one per month" };
    }
  }

  // Eras: a name to write beside the year, anchored at its start year.
  const eraRows = Array.isArray(spec.eras) ? spec.eras : [];
  const eras: { name: string; start: number }[] = [];
  const eraNames = new Set<string>();
  for (const entry of eraRows) {
    const era = (entry ?? {}) as Record<string, unknown>;
    const name = String(era.name ?? "").trim();
    const start = Number(era.start);
    if (name === "") {
      return { ok: false, message: "every era needs a name" };
    }
    if (eraNames.has(name.toLowerCase())) {
      return { ok: false, message: `era "${name}" is listed twice` };
    }
    if (!Number.isInteger(start)) {
      return { ok: false, message: `era "${name}" needs a whole-number start year` };
    }
    eraNames.add(name.toLowerCase());
    eras.push({ name, start });
  }

  const hasDays =
    (typeof spec.days_per_month === "number" && spec.days_per_month >= 1) ||
    (Array.isArray(spec.days_per_month) && spec.days_per_month.length > 0);
  if (monthCount === 0 && !hasDays && eras.length === 0) {
    return {
      ok: false,
      message:
        "a custom calendar needs months, days per month, or eras - untick Custom for gregorian",
    };
  }

  document.deleteIn(["calendar"]);
  if (monthNames !== undefined) {
    document.setIn(["calendar", "months"], monthNames);
  } else if (monthCount > 0) {
    document.setIn(["calendar", "months"], monthCount);
  }
  if (typeof spec.days_per_month === "number") {
    document.setIn(["calendar", "days_per_month"], spec.days_per_month);
  } else if (Array.isArray(spec.days_per_month)) {
    document.setIn(["calendar", "days_per_month"], spec.days_per_month.map(Number));
  }
  if (eras.length > 0) {
    document.setIn(["calendar", "eras"], eras);
  }

  await writeFile(resolved, documentText(document), "utf8");
  return { ok: true, message: "saved calendar", file: resolved };
}

/** Set fields on an existing record in place. */
export async function writeRecordFields(
  root: string,
  kind: EditableKind,
  place: RecordPlace,
  fields: Record<string, unknown>,
): Promise<EditResult> {
  if (place.file === undefined) {
    return { ok: false, message: "that record has no file to write to" };
  }
  const file = resolveWithinWorld(root, place.file);
  if (file === undefined) {
    return { ok: false, message: "that file is outside the world folder" };
  }
  const text = await readFile(file, "utf8");
  const document = parseDocument(text);

  let prefix: (string | number)[] = [];
  if (kind === "map" && isWorldYaml(root, file)) {
    const idx = place.index ?? 0;
    const node = document.getIn(["maps", idx]);
    if (!isMap(node)) {
      return { ok: false, message: "that map is not in world.yaml" };
    }
    prefix = ["maps", idx];
  } else if (place.index !== undefined) {
    if (!isRecordAt(document, place.index)) {
      return { ok: false, message: "that record is not in the file" };
    }
    prefix = [place.index];
  }

  // A rename: the record's name changed, so the references that pointed at
  // the old name have to follow it.
  const nameKey = kind === "event" ? "title" : "name";
  const oldName = document.getIn([...prefix, nameKey]);
  const newName = fields[nameKey];
  const isRename =
    kind !== "event" &&
    typeof oldName === "string" &&
    typeof newName === "string" &&
    oldName.trim() !== "" &&
    newName.trim() !== "" &&
    oldName.trim() !== newName.trim();
  const writtenId = document.getIn([...prefix, "id"]);
  const oldId =
    typeof writtenId === "string" && writtenId !== ""
      ? writtenId
      : slugify(String(oldName ?? "").trim());
  const nextId = fields.id;
  const newId =
    typeof nextId === "string" && nextId !== ""
      ? nextId
      : nextId === null
        ? slugify(String(newName ?? oldName ?? "").trim())
        : typeof writtenId === "string" && writtenId !== ""
          ? writtenId
          : slugify(String(newName ?? oldName ?? "").trim());

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      document.deleteIn([...prefix, key]);
      continue;
    }
    document.setIn([...prefix, key], value);
  }
  await writeFile(file, documentText(document), "utf8");

  let finalFile = file;
  if (place.index === undefined && !isWorldYaml(root, file)) {
    const name = fields.name ?? fields.title;
    if (typeof name === "string" && name !== "") {
      const folder = path.dirname(file);
      if (folder === path.join(root, DIRECTORIES[kind])) {
        const wanted = `${slugify(name)}.yaml`;
        if (wanted !== path.basename(file)) {
          const renamed = path.join(folder, wanted);
          if (!existsSync(renamed)) {
            try {
              await rename(file, renamed);
              finalFile = renamed;
            } catch {
              // Rename is best-effort.
            }
          }
        }
      }
    }
  }

  // The references that pointed at the old name follow the record.
  let carried = 0;
  if (isRename) {
    const { carryRename } = await import("./rename.js");
    const result = await carryRename(root, {
      kind: kind as RefKind,
      oldId,
      oldName: oldName.trim(),
      newId,
      newName: newName.trim(),
    });
    carried = result.updated;
  }

  return {
    ok: true,
    message:
      carried > 0
        ? `saved ${path.basename(finalFile)} - ${carried} reference${carried === 1 ? "" : "s"} followed`
        : `saved ${path.basename(finalFile)}`,
    file: finalFile,
    id: newId !== "" ? newId : undefined,
  };
}

/** Remove a record from the world. */
export async function deleteRecord(
  root: string,
  kind: EditableKind,
  place: RecordPlace,
): Promise<EditResult> {
  if (place.file === undefined) {
    return { ok: false, message: "that record has no file to delete from" };
  }
  const resolved = resolveWithinWorld(root, place.file);
  if (resolved === undefined) {
    return { ok: false, message: "that file is outside the world folder" };
  }

  if (kind === "map" && isWorldYaml(root, resolved)) {
    const idx = place.index ?? -1;
    const text = await readFile(resolved, "utf8");
    const document = parseDocument(text);
    if (!isMap(document.getIn(["maps", idx]))) {
      return { ok: false, message: "that map is not in world.yaml" };
    }
    document.deleteIn(["maps", idx]);
    await writeFile(resolved, documentText(document), "utf8");
    return { ok: true, message: "deleted map from world.yaml", file: resolved };
  }

  if (place.index === undefined) {
    await unlink(resolved);
    return { ok: true, message: `deleted ${path.basename(resolved)}` };
  }
  const text = await readFile(resolved, "utf8");
  const document = parseDocument(text);
  if (!isRecordAt(document, place.index)) {
    return { ok: false, message: "that record is not in the file" };
  }
  document.deleteIn([place.index]);
  await writeFile(resolved, documentText(document), "utf8");
  return { ok: true, message: `deleted record from ${path.basename(resolved)}`, file: resolved };
}

/**
 * An id that nothing else in the world answers to.
 *
 * Ids are permanent, so a new record needs one that is free. People and
 * locations share a namespace - the trace is looked up by id - while a map
 * and a place may share a name.
 */
async function uniqueId(root: string, kind: EditableKind, wanted: string): Promise<string> {
  const taken = new Set<string>();
  try {
    const { loadWorld } = await import("./load.js");
    const loaded = await loadWorld(root);
    const index = buildIndex(loaded.data);
    for (const record of index.maps) taken.add(record.id);
    for (const record of index.people) taken.add(record.id);
    for (const record of index.locations) taken.add(record.id);
    for (const record of index.events) taken.add(record.id);
    if (kind === "map" || kind === "event") {
      // A map and a place may share a name; they live apart.
      for (const record of index.locations) taken.delete(record.id);
      for (const record of index.people) taken.delete(record.id);
    }
  } catch {
    // A world that cannot be read yet still gets the id it asked for.
    return wanted;
  }
  if (!taken.has(wanted)) {
    return wanted;
  }
  let suffix = 2;
  while (taken.has(`${wanted}-${suffix}`)) {
    suffix += 1;
  }
  return `${wanted}-${suffix}`;
}

/** Add a new record to the world. */
export async function createRecord(
  root: string,
  kind: EditableKind,
  record: Record<string, unknown>,
): Promise<EditResult> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    if (typeof value === "string" && value.trim() === "") {
      continue;
    }
    cleaned[key] = value;
  }

  const given = typeof cleaned.id === "string" && cleaned.id.trim() !== "" ? cleaned.id.trim() : undefined;
  const rawName = String(given ?? cleaned.name ?? cleaned.title ?? "record");
  // An id is permanent, so it is written down - and it answers to nothing
  // else in the world.
  const id = await uniqueId(root, kind, given ?? (slugify(rawName) || "record"));
  cleaned.id = id;

  const listFile = await findListFile(root, kind);
  if (listFile !== undefined) {
    const text = await readFile(listFile, "utf8");
    const document = parseDocument(text);
    const sequence = rootSequence(document);
    if (sequence !== undefined) {
      sequence.add(cleaned);
      await writeFile(listFile, documentText(document), "utf8");
      return { ok: true, message: `added to ${listFile}`, file: listFile, id };
    }
    if (document.contents === null) {
      // A file that holds only comments parses to an empty document: the
      // first record starts its list, and the example comments retire.
      document.contents = document.createNode([cleaned]) as unknown as typeof document.contents;
      await writeFile(listFile, documentText(document), "utf8");
      return { ok: true, message: `added to ${listFile}`, file: listFile, id };
    }
  }

  const dir = path.join(root, DIRECTORIES[kind]);
  await mkdir(dir, { recursive: true });
  let candidate = path.join(dir, `${id}.yaml`);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${id}-${suffix}.yaml`);
    suffix += 1;
  }
  await writeFile(candidate, stringify(cleaned, { lineWidth: 100 }), "utf8");
  return { ok: true, message: `created ${candidate}`, file: candidate, id };
}

/** Move a location to a new pixel coordinate on a map. */
export async function moveLocation(
  root: string,
  id: string,
  mapId: string,
  x: number,
  y: number,
): Promise<EditResult> {
  const { loadWorld } = await import("./load.js");
  const loaded = await loadWorld(root);
  const index = buildIndex(loaded.data);
  // A map is referenced by its id, whatever spelling the caller used.
  const canonicalMap = canonicalReference("map", index, mapId) ?? mapId;
  for (const record of index.locations) {
    const location = record.data;
    if (record.id !== id && record.name !== id) {
      continue;
    }
    if (record.file === undefined) {
      return { ok: false, message: "that location has no file to write to" };
    }
    const text = await readFile(record.file, "utf8");
    const document = parseDocument(text);
    const prefix = record.index !== undefined ? [record.index] : [];
    document.setIn([...prefix, "at"], [Math.round(x), Math.round(y)]);
    document.setIn([...prefix, "map"], canonicalMap);
    await writeFile(record.file, documentText(document), "utf8");
    return { ok: true, message: `placed ${location.name} at ${Math.round(x)}, ${Math.round(y)}` };
  }
  return { ok: false, message: `no location called "${id}"` };
}

/** Move a raw-coordinate event marker on its map. */
export async function moveEventPoint(
  root: string,
  id: string,
  mapId: string,
  x: number,
  y: number,
): Promise<EditResult> {
  const { loadWorld } = await import("./load.js");
  const loaded = await loadWorld(root);
  const index = buildIndex(loaded.data);
  const canonicalMap = canonicalReference("map", index, mapId) ?? mapId;
  for (const record of index.events) {
    if (record.id !== id && record.name !== id) {
      continue;
    }
    if (record.file === undefined) {
      return { ok: false, message: "that event has no file to write to" };
    }
    const text = await readFile(record.file, "utf8");
    const document = parseDocument(text);
    const prefix = record.index !== undefined ? [record.index] : [];
    document.setIn([...prefix, "where"], {
      map: canonicalMap,
      at: [Math.round(x), Math.round(y)],
    });
    await writeFile(record.file, documentText(document), "utf8");
    return {
      ok: true,
      message: `moved "${record.data.title}" to [${Math.round(x)}, ${Math.round(y)}]`,
    };
  }
  return { ok: false, message: `no event called "${id}"` };
}

/**
 * Save an uploaded image for a map, and reference it in the map's YAML.
 *
 * By default (`mode = "replace"` when the map only has a starter/single image,
 * or explicit `mode = "add"` for time-varying map layers), updates `images`
 * and updates `size` when the uploaded image dimensions differ from an
 * existing declared `size` (avoiding size-mismatch errors when replacing
 * starter placeholder graphics).
 */
export async function saveMapImage(
  root: string,
  mapId: string,
  fileName: string,
  bytes: Buffer,
  options: { mode?: "add" | "replace"; from?: string; until?: string; caption?: string } = {},
): Promise<EditResult> {
  const { loadWorld } = await import("./load.js");
  const { readImageSize } = await import("../core/images.js");
  const loaded = await loadWorld(root);
  const index = buildIndex(loaded.data);

  const detectedSize = readImageSize(bytes);

  for (let mapPos = 0; mapPos < index.maps.length; mapPos += 1) {
    const record = index.maps[mapPos];
    if (record === undefined) continue;
    if (record.id !== mapId && record.name !== mapId) {
      continue;
    }
    const safeName = path.basename(fileName).replace(/[^\w.\-]+/g, "-") || "map.png";
    const inWorldYaml = record.file !== undefined && isWorldYaml(root, record.file);
    const folder =
      record.file !== undefined && !inWorldYaml
        ? path.dirname(record.file)
        : path.join(root, "maps");
    const target = path.join(folder, safeName);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);

    const entry: Record<string, string> = { file: safeName };
    if (options.from !== undefined && options.from.trim() !== "") {
      entry.from = options.from.trim();
    }
    if (options.until !== undefined && options.until.trim() !== "") {
      entry.until = options.until.trim();
    }
    if (options.caption !== undefined && options.caption.trim() !== "") {
      entry.caption = options.caption.trim();
    }

    if (record.file !== undefined) {
      const text = await readFile(record.file, "utf8");
      const document = parseDocument(text);
      let prefix: (string | number)[] = [];
      if (inWorldYaml) {
        // Locate its index inside world.yaml `maps`
        const inlineIndex = (loaded.data.world.data.maps ?? []).findIndex(
          (m) => (m.id ?? slugify(m.name)) === record.id,
        );
        prefix = ["maps", inlineIndex >= 0 ? inlineIndex : 0];
      } else if (record.index !== undefined) {
        prefix = [record.index];
      }

      const mode = options.mode ?? "add";
      if (mode === "replace") {
        document.deleteIn([...prefix, "file"]);
        document.setIn([...prefix, "images"], [entry]);
        if (detectedSize !== undefined) {
          document.setIn([...prefix, "size"], [detectedSize.width, detectedSize.height]);
        }
      } else {
        const existingImages = document.getIn([...prefix, "images"]) as YAMLSeq<unknown> | undefined;
        const singleFile = document.getIn([...prefix, "file"]);
        if (existingImages !== undefined && isSeq(existingImages)) {
          existingImages.add(entry);
        } else if (typeof singleFile === "string" && singleFile !== "") {
          document.deleteIn([...prefix, "file"]);
          document.setIn([...prefix, "images"], [{ file: singleFile }, entry]);
        } else {
          document.setIn([...prefix, "images"], [entry]);
          if (detectedSize !== undefined) {
            document.setIn([...prefix, "size"], [detectedSize.width, detectedSize.height]);
          }
        }
      }
      await writeFile(record.file, documentText(document), "utf8");
    }
    return { ok: true, message: `saved ${safeName}`, file: target, fileName: safeName };
  }
  return { ok: false, message: `no map called "${mapId}"` };
}

/** Save a portrait/card asset file inside the world folder (e.g. `assets/portrait.png`). */
export async function saveAssetImage(
  root: string,
  subdir: "people" | "locations" | "assets",
  fileName: string,
  bytes: Buffer,
): Promise<EditResult> {
  const safeName = path.basename(fileName).replace(/[^\w.\-]+/g, "-") || "image.png";
  const relPath = `${subdir}/${safeName}`;
  const target = path.join(root, subdir, safeName);
  const checked = resolveWithinWorld(root, target);
  if (checked === undefined) {
    return { ok: false, message: "asset path is outside the world folder" };
  }
  await mkdir(path.dirname(checked), { recursive: true });
  await writeFile(checked, bytes);
  return { ok: true, message: `uploaded ${relPath}`, file: checked, fileName: relPath };
}
