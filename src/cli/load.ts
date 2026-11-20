/**
 * Load a world folder.
 *
 * The loader reads YAML and images, checks one record at a time, and hands
 * the result to the cross-record validator. It is the only part of the tool
 * that touches the filesystem.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { readImageSize } from "../core/images.js";
import {
  EventSchema,
  knownKeys,
  LocationSchema,
  MapSchema,
  PersonSchema,
  WorldSchema,
  type EventRecord,
  type LocationRecord,
  type MapRecord,
  type PersonRecord,
  type WorldRecord,
} from "../core/schema.js";
import type { Issue, Source, WorldData } from "../core/validate.js";

export interface LoadResult {
  root: string;
  data: WorldData;
  issues: Issue[];
}

interface SchemaLike {
  safeParse(value: unknown):
    | { success: true; data: unknown }
    | { success: false; error: { issues: { message: string; path: PropertyKey[] }[] } };
}

const WORLD_FILES = ["world.yaml", "world.yml"];

export async function loadWorld(root: string): Promise<LoadResult> {
  const absoluteRoot = path.resolve(root);
  const issues: Issue[] = [];

  if (!existsSync(absoluteRoot)) {
    issues.push({
      severity: "error",
      code: "missing-world",
      message: `no such folder: ${absoluteRoot}`,
    });
    return { root: absoluteRoot, data: emptyWorld(), issues };
  }

  const worldFile = await findFile(absoluteRoot, WORLD_FILES);
  if (worldFile === undefined) {
    issues.push({
      severity: "error",
      code: "missing-world",
      message: `no world.yaml in ${absoluteRoot}`,
    });
    return { root: absoluteRoot, data: emptyWorld(), issues };
  }

  const worldText = await readFile(worldFile, "utf8");
  const parsedWorld = parseYamlText(worldText);
  let world: WorldRecord = { title: "(unreadable world)" };
  if (!parsedWorld.ok) {
    issues.push({ severity: "error", code: "yaml", message: parsedWorld.message, file: worldFile });
  } else {
    const checked = checkRecord(WorldSchema, parsedWorld.value, worldFile, "world", issues);
    if (checked !== undefined) {
      world = checked as WorldRecord;
    }
  }

  const mapFiles = [
    ...(await listYamlFiles(path.join(absoluteRoot, "maps"))),
    ...(await findFiles(absoluteRoot, ["maps.yaml", "maps.yml"])),
  ];
  const peopleFiles = [
    ...(await listYamlFiles(path.join(absoluteRoot, "people"))),
    ...(await findFiles(absoluteRoot, ["people.yaml", "people.yml"])),
  ];
  const locationFiles = [
    ...(await listYamlFiles(path.join(absoluteRoot, "locations"))),
    ...(await findFiles(absoluteRoot, ["locations.yaml", "locations.yml"])),
  ];
  const eventFiles = [
    ...(await listYamlFiles(path.join(absoluteRoot, "events"))),
    ...(await findFiles(absoluteRoot, ["events.yaml", "events.yml"])),
  ];

  const inlineMaps: Source<MapRecord>[] = (world.maps ?? []).map((map) => ({ data: map, file: worldFile }));

  const maps = [
    ...inlineMaps,
    ...(await collectRecords<MapRecord>(mapFiles, MapSchema, "map", issues)),
  ];
  const people = await collectRecords<PersonRecord>(peopleFiles, PersonSchema, "person", issues);
  const locations = await collectRecords<LocationRecord>(locationFiles, LocationSchema, "location", issues);
  const events = await collectRecords<EventRecord>(eventFiles, EventSchema, "event", issues);

  await checkMapImages(maps, absoluteRoot, issues);

  return {
    root: absoluteRoot,
    data: { world: { data: world, file: worldFile }, maps, people, locations, events },
    issues,
  };
}

function emptyWorld(): WorldData {
  return {
    world: { data: { title: "(no world)" } },
    maps: [],
    people: [],
    locations: [],
    events: [],
  };
}

async function findFile(dir: string, names: string[]): Promise<string | undefined> {
  for (const name of names) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function findFiles(dir: string, names: string[]): Promise<string[]> {
  const found = await findFile(dir, names);
  return found !== undefined ? [found] : [];
}

async function listYamlFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function parseYamlText(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: parseYaml(text) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function checkRecord<T>(
  schema: SchemaLike,
  raw: unknown,
  file: string,
  label: string,
  issues: Issue[],
): T | undefined {
  const result = schema.safeParse(raw);
  if (result.success) {
    return result.data as T;
  }
  for (const issue of result.error.issues) {
    issues.push({
      severity: "error",
      code: "schema",
      message: issue.message,
      file,
      record: label,
      field: issue.path.length > 0 ? issue.path.map((part) => String(part)).join(".") : undefined,
    });
  }
  return undefined;
}

function recordLabel(raw: unknown, fallback: string): string {
  if (raw !== null && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const name = record.name ?? record.title;
    if (typeof name === "string" && name !== "") {
      return name;
    }
  }
  return fallback;
}

async function collectRecords<T>(
  files: string[],
  schema: SchemaLike,
  label: string,
  issues: Issue[],
): Promise<Source<T>[]> {
  const records: Source<T>[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const parsed = parseYamlText(text);
    if (!parsed.ok) {
      issues.push({ severity: "error", code: "yaml", message: parsed.message, file });
      continue;
    }
    // A file that holds only comments parses to null: it is an empty list,
    // not an error. The starter world ships files like this.
    if (parsed.value === null || parsed.value === undefined) {
      continue;
    }
    const items = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
    for (const [index, item] of items.entries()) {
      const name = recordLabel(item, `${label} #${index + 1}`);
      const checked = checkRecord<T>(schema, item, file, name, issues);
      if (checked !== undefined) {
        records.push({ data: checked, file, index: Array.isArray(parsed.value) ? index : undefined });
      }
    }
  }
  return records;
}

interface ResolvedImage {
  path: string;
  caseMismatch?: string;
}

/** The file a map image points at, wherever it sits in the world folder. */
export async function resolveImagePath(
  root: string,
  sourceFile: string | undefined,
  file: string,
): Promise<string | undefined> {
  const resolved = await resolveImage(root, sourceFile, file);
  return resolved?.path;
}

async function resolveImage(
  root: string,
  sourceFile: string | undefined,
  file: string,
): Promise<ResolvedImage | undefined> {
  const base = sourceFile !== undefined ? path.dirname(sourceFile) : root;
  // A world can name any file, and worlds are written by agents and shared
  // between people, so a path that climbs out of the world folder is not an
  // image: it is a way to read something that is not part of the world.
  const candidates = [
    path.resolve(base, file),
    path.resolve(root, file),
    path.resolve(root, "maps", file),
  ].filter((candidate) => isInside(root, candidate));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { path: candidate };
    }
  }
  // macOS and Windows are case-insensitive, Linux and web hosts are not.
  const first = candidates[0];
  if (first !== undefined) {
    const dir = path.dirname(first);
    if (existsSync(dir)) {
      const entries = await readdir(dir);
      const target = path.basename(first).toLowerCase();
      const match = entries.find((entry) => entry.toLowerCase() === target);
      if (match !== undefined) {
        return { path: path.join(dir, match), caseMismatch: match };
      }
    }
  }
  return undefined;
}

/** Whether a path is inside the world folder. */
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function checkMapImages(
  maps: Source<MapRecord>[],
  root: string,
  issues: Issue[],
): Promise<void> {
  for (const source of maps) {
    const map = source.data;
    const images = map.images ?? (map.file !== undefined ? [{ file: map.file }] : []);
    const sizes = new Set<string>();

    for (const image of images) {
      const resolved = await resolveImage(root, source.file, image.file);
      if (resolved === undefined) {
        issues.push({
          severity: "error",
          code: "missing-image",
          message: `image file "${image.file}" was not found`,
          file: source.file,
          record: map.name,
          field: "images",
        });
        continue;
      }
      if (resolved.caseMismatch !== undefined) {
        issues.push({
          severity: "warning",
          code: "case-mismatch",
          message: `"${image.file}" is on disk as "${resolved.caseMismatch}"`,
          file: source.file,
          record: map.name,
          field: "images",
          suggestion: "Linux and web hosts are case-sensitive; rename the file or fix the reference.",
        });
      }

      const data = await readFile(resolved.path);
      const size = readImageSize(data);
      if (size === undefined) {
        issues.push({
          severity: "warning",
          code: "unknown-image-format",
          message: `could not read the pixel size of "${image.file}"`,
          file: source.file,
          record: map.name,
          field: "images",
        });
        continue;
      }
      sizes.add(`${size.width}x${size.height}`);
      if (map.size === undefined) {
        // The size is read from the image when the creator did not write it.
        map.size = [size.width, size.height];
      }
      if (map.size !== undefined && (map.size[0] !== size.width || map.size[1] !== size.height)) {
        issues.push({
          severity: "warning",
          code: "size-mismatch",
          message: `declared size ${map.size[0]}x${map.size[1]} but "${image.file}" is ${size.width}x${size.height}`,
          file: source.file,
          record: map.name,
          field: "size",
        });
      }
    }

    if (sizes.size > 1) {
      issues.push({
        severity: "error",
        code: "image-size-mismatch",
        message: `the images of this map have different sizes (${[...sizes].join(", ")}); locations would move between them`,
        file: source.file,
        record: map.name,
        field: "images",
      });
    }
  }
}

/** Exported for the schema command and for tests. */
export const schemas = {
  world: WorldSchema,
  map: MapSchema,
  person: PersonSchema,
  location: LocationSchema,
  event: EventSchema,
};

export const schemaFieldNames = {
  world: knownKeys(WorldSchema),
  map: knownKeys(MapSchema),
  person: knownKeys(PersonSchema),
  location: knownKeys(LocationSchema),
  event: knownKeys(EventSchema),
};
