/**
 * Cross-record checks for a world.
 *
 * The loader checks one record at a time (shape, YAML, files on disk).
 * This module checks the world as a whole: names resolve, ids are unique,
 * dates make sense, and a mobile location is not also a fixed one.
 */

import {
  buildIndex,
  calendarOptions,
  type WorldData,
  type WorldIndex,
} from "./building.js";
import { compareBounds, compareDates, tryParseDate, type ParseOptions, type ParsedDate } from "./dates.js";
import { levenshtein } from "./resolve.js";
import {
  EventSchema,
  ExistsSchema,
  knownKeys,
  LocationSchema,
  MapImageSchema,
  MapSchema,
  PersonSchema,
  StaySchema,
  WorldSchema,
} from "./schema.js";

// The index of a world lives in building.ts now - it is what the viewer
// needs, and the validation layer it used to sit in needs Zod. It is
// re-exported here so the shape of a world is still found in one place.
export { buildIndex, calendarOptions } from "./building.js";
export type { Indexed, Source, WorldData, WorldIndex } from "./building.js";

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  /** A stable machine-readable code, e.g. "unknown-reference". */
  code: string;
  message: string;
  file?: string | undefined;
  record?: string | undefined;
  field?: string | undefined;
  suggestion?: string | undefined;
}

export interface ValidateOptions {
  /** Report warnings as errors. */
  strict?: boolean;
}

function suggestionText(suggestions: string[]): string | undefined {
  if (suggestions.length === 0) {
    return undefined;
  }
  if (suggestions.length === 1) {
    return `Did you mean "${suggestions[0]}"?`;
  }
  return `Did you mean one of: ${suggestions.map((name) => `"${name}"`).join(", ")}?`;
}

/** Check a world as a whole. Returns every issue found. */
export function validateWorld(data: WorldData, options: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const index = buildIndex(data);
  const parseOptions = calendarOptions(index.world);

  checkUnknownFields(issues, index);
  checkDuplicateIds(issues, index);
  checkWorldDates(issues, index, parseOptions);
  checkMaps(issues, index);
  checkLocations(issues, index, parseOptions);
  checkPeople(issues, index, parseOptions);
  checkEvents(issues, index, parseOptions);

  if (options.strict === true) {
    for (const issue of issues) {
      if (issue.severity === "warning") {
        issue.severity = "error";
      }
    }
  }
  return issues;
}

/**
 * The field this key was probably meant to be.
 *
 * A typo usually keeps its length, so a same-length field is the better
 * guess: "bith" is meant to be "born", not "bio".
 */
function suggestField(key: string, known: string[]): string | undefined {
  return known
    .map((candidate) => {
      const distance = levenshtein(key, candidate);
      const lengthPenalty = Math.abs(candidate.length - key.length) * 0.25;
      const sameLengthBonus = candidate.length === key.length ? -1 : 0;
      return { candidate, distance, score: distance + lengthPenalty + sameLengthBonus };
    })
    .filter((entry) => entry.distance <= Math.max(3, Math.floor(key.length / 3)))
    .sort((a, b) => a.score - b.score || a.distance - b.distance || a.candidate.localeCompare(b.candidate))[0]
    ?.candidate;
}

/** Warn about any field the format does not know. */
function reportUnknownFields(
  issues: Issue[],
  data: Record<string, unknown>,
  known: string[],
  context: { file?: string | undefined; record: string; prefix: string },
): void {
  for (const key of Object.keys(data)) {
    if (known.includes(key)) {
      continue;
    }
    const near = suggestField(key, known);
    issues.push({
      severity: "warning",
      code: "unknown-field",
      message: `unknown field "${key}"`,
      file: context.file,
      record: context.record,
      field: context.prefix === "" ? key : `${context.prefix}.${key}`,
      suggestion: near !== undefined ? `Did you mean "${near}"?` : undefined,
    });
  }
}

function checkUnknownFields(issues: Issue[], index: WorldIndex): void {
  const groups: { records: { file?: string | undefined; data: Record<string, unknown>; name: string }[]; known: string[] }[] = [
    { records: index.maps.map((record) => ({ file: record.file, data: record.data as Record<string, unknown>, name: record.name })), known: knownKeys(MapSchema) },
    { records: index.people.map((record) => ({ file: record.file, data: record.data as Record<string, unknown>, name: record.name })), known: knownKeys(PersonSchema) },
    { records: index.locations.map((record) => ({ file: record.file, data: record.data as Record<string, unknown>, name: record.name })), known: knownKeys(LocationSchema) },
    { records: index.events.map((record) => ({ file: record.file, data: record.data as Record<string, unknown>, name: record.name })), known: knownKeys(EventSchema) },
  ];

  for (const group of groups) {
    for (const record of group.records) {
      reportUnknownFields(issues, record.data, group.known, {
        file: record.file,
        record: record.name,
        prefix: "",
      });
    }
  }

  // world.yaml, and the objects nested inside the records. A typo inside a
  // stay or an image changes what the record means, so it is worth saying
  // so: "fro" is not a date, it is a missing one.
  reportUnknownFields(issues, index.world as Record<string, unknown>, knownKeys(WorldSchema), {
    file: index.worldFile,
    record: index.world.title,
    prefix: "",
  });
  for (const record of index.people) {
    for (const stay of record.data.stays ?? []) {
      reportUnknownFields(issues, stay as Record<string, unknown>, knownKeys(StaySchema), {
        file: record.file,
        record: record.name,
        prefix: "stays",
      });
    }
  }
  for (const record of index.locations) {
    for (const stay of record.data.stays ?? []) {
      reportUnknownFields(issues, stay as Record<string, unknown>, knownKeys(StaySchema), {
        file: record.file,
        record: record.name,
        prefix: "stays",
      });
    }
    if (record.data.exists !== undefined) {
      reportUnknownFields(issues, record.data.exists as Record<string, unknown>, knownKeys(ExistsSchema), {
        file: record.file,
        record: record.name,
        prefix: "exists",
      });
    }
  }
  for (const record of index.maps) {
    for (const image of record.data.images ?? []) {
      reportUnknownFields(issues, image as Record<string, unknown>, knownKeys(MapImageSchema), {
        file: record.file,
        record: record.name,
        prefix: "images",
      });
    }
  }
}

function checkDuplicateIds(issues: Issue[], index: WorldIndex): void {
  const groups: { label: string; records: { id: string; name: string; file?: string | undefined }[] }[] = [
    { label: "map", records: index.maps },
    { label: "person", records: index.people },
    { label: "location", records: index.locations },
    { label: "event", records: index.events },
  ];
  // Within one kind, two records cannot share an id.
  for (const group of groups) {
    const seen = new Map<string, { name: string; file?: string | undefined }>();
    for (const record of group.records) {
      const existing = seen.get(record.id);
      if (existing !== undefined) {
        issues.push({
          severity: "error",
          code: "duplicate-id",
          message: `two ${group.label}s resolve to the id "${record.id}"`,
          file: record.file,
          record: record.name,
          field: "id",
          suggestion: `The other one is "${existing.name}"${existing.file !== undefined ? ` in ${existing.file}` : ""}. Give one of them an explicit id.`,
        });
        continue;
      }
      seen.set(record.id, { name: record.name, file: record.file });
    }
  }
  // A person and a location share one namespace: the trace is looked up by
  // id, so an id that names both would show two histories at once. A map
  // and a location may share a name - a place and the map it sits on - and
  // those live in separate namespaces, so they are left alone.
  const people = new Map<string, { name: string; file?: string | undefined }>();
  for (const record of index.people) {
    people.set(record.id, { name: record.name, file: record.file });
  }
  for (const record of index.locations) {
    const existing = people.get(record.id);
    if (existing !== undefined) {
      issues.push({
        severity: "error",
        code: "duplicate-id",
        message: `a person and a location resolve to the id "${record.id}"`,
        file: record.file,
        record: record.name,
        field: "id",
        suggestion: `The other one is "${existing.name}"${existing.file !== undefined ? ` in ${existing.file}` : ""}. Give one of them an explicit id.`,
      });
    }
  }
}

function parseOrIssue(
  issues: Issue[],
  value: string | number | undefined,
  parseOptions: ParseOptions,
  context: { file?: string | undefined; record?: string | undefined; field?: string | undefined },
): ParsedDate | undefined {
  if (value === undefined) {
    return undefined;
  }
  const result = tryParseDate(value, parseOptions);
  if (!result.ok) {
    issues.push({
      severity: "error",
      code: "invalid-date",
      message: `cannot parse date "${String(value)}"`,
      file: context.file,
      record: context.record,
      field: context.field,
    });
    return undefined;
  }
  for (const warning of result.value.warnings) {
    issues.push({
      severity: "warning",
      code: "impossible-date",
      message: warning,
      file: context.file,
      record: context.record,
      field: context.field,
    });
  }
  return result.value;
}

function checkWorldDates(issues: Issue[], index: WorldIndex, parseOptions: ParseOptions): void {
  const world = index.world;
  const file = undefined;
  const start = parseOrIssue(issues, world.start, parseOptions, { file, record: world.title, field: "start" });
  const end = parseOrIssue(issues, world.end, parseOptions, { file, record: world.title, field: "end" });
  if (start !== undefined && end !== undefined && compareDates(start, end) > 0) {
    issues.push({
      severity: "error",
      code: "inverted-range",
      message: `start "${start.raw}" is after end "${end.raw}"`,
      record: world.title,
      field: "start",
    });
  }

  if (world.overworld !== undefined && !index.mapNames.has(world.overworld)) {
    const suggestions = index.mapNames.suggest(world.overworld);
    issues.push({
      severity: "error",
      code: "unknown-reference",
      message: `unknown map "${world.overworld}"`,
      record: world.title,
      field: "overworld",
      suggestion: suggestionText(suggestions),
    });
  }
}

function checkMaps(issues: Issue[], index: WorldIndex): void {
  for (const record of index.maps) {
    const map = record.data;
    const images = map.images ?? (map.file !== undefined ? [{ file: map.file }] : []);

    if (images.length === 0) {
      issues.push({
        severity: "warning",
        code: "map-without-image",
        message: "map has no image",
        file: record.file,
        record: record.name,
        field: "images",
      });
    }

    if (map.parent !== undefined) {
      const parent = index.mapNames.resolve(map.parent);
      if (parent === undefined) {
        issues.push({
          severity: "error",
          code: "unknown-reference",
          message: `unknown map "${map.parent}"`,
          file: record.file,
          record: record.name,
          field: "parent",
          suggestion: suggestionText(index.mapNames.suggest(map.parent)),
        });
      } else {
        // Walk up the parents: a cycle would hang the viewer.
        const seen = new Set<string>([record.id]);
        let cursor: string | undefined = parent;
        while (cursor !== undefined) {
          if (seen.has(cursor)) {
            issues.push({
              severity: "error",
              code: "map-cycle",
              message: "map parents form a loop",
              file: record.file,
              record: record.name,
              field: "parent",
            });
            break;
          }
          seen.add(cursor);
          // The parent may be written as a name, so every hop is resolved
          // through the index instead of being read as an id. A chain
          // written in names used to stop at the second map.
          const parentName: string | undefined = index.mapIds.get(cursor)?.data.parent;
          cursor = parentName !== undefined ? index.mapNames.resolve(parentName) : undefined;
        }
      }
    }

    const parseOptions = calendarOptions(index.world);
    for (const image of images) {
      const from = parseOrIssue(issues, image.from, parseOptions, {
        file: record.file,
        record: record.name,
        field: "images.from",
      });
      const until = parseOrIssue(issues, image.until, parseOptions, {
        file: record.file,
        record: record.name,
        field: "images.until",
      });
      if (from !== undefined && until !== undefined && compareDates(from, until) > 0) {
        issues.push({
          severity: "error",
          code: "inverted-range",
          message: `image "${image.file}" starts after it ends`,
          file: record.file,
          record: record.name,
          field: "images",
        });
      }
    }
  }
}

function checkLocations(issues: Issue[], index: WorldIndex, parseOptions: ParseOptions): void {
  for (const record of index.locations) {
    const location = record.data;
    const isMobile = location.kind === "mobile";

    if (location.map !== undefined && !index.mapNames.has(location.map)) {
      issues.push({
        severity: "error",
        code: "unknown-reference",
        message: `unknown map "${location.map}"`,
        file: record.file,
        record: record.name,
        field: "map",
        suggestion: suggestionText(index.mapNames.suggest(location.map)),
      });
    }

    if (location.at !== undefined && location.map !== undefined) {
      checkPoint(issues, index, location.map, location.at, {
        file: record.file,
        record: record.name,
        field: "at",
        what: `location "${record.name}"`,
      });
    }

    if (location.opens !== undefined) {
      if (!index.mapNames.has(location.opens)) {
        issues.push({
          severity: "error",
          code: "unknown-reference",
          message: `unknown map "${location.opens}"`,
          file: record.file,
          record: record.name,
          field: "opens",
          suggestion: suggestionText(index.mapNames.suggest(location.opens)),
        });
      } else {
        const opened = index.mapIds.get(index.mapNames.resolve(location.opens) ?? "");
        const parent = opened?.data.parent;
        if (parent !== undefined && location.map !== undefined && !index.mapNames.has(parent)) {
          issues.push({
            severity: "warning",
            code: "missing-parent-map",
            message: `the map "${location.opens}" names a parent that does not exist`,
            file: record.file,
            record: record.name,
            field: "opens",
          });
        }
      }
    }

    if (isMobile) {
      if (location.at !== undefined) {
        issues.push({
          severity: "warning",
          code: "mobile-with-position",
          message: "a mobile location cannot have a fixed position; the position is ignored",
          file: record.file,
          record: record.name,
          field: "at",
        });
      }
      if (location.stays === undefined || location.stays.length === 0) {
        issues.push({
          severity: "warning",
          code: "mobile-without-stays",
          message: "a mobile location has no stays, so its position is unknown",
          file: record.file,
          record: record.name,
          field: "stays",
        });
      }
    } else {
      if (location.stays !== undefined && location.stays.length > 0) {
        issues.push({
          severity: "warning",
          code: "stays-on-fixed-location",
          message: "stays only apply to mobile locations",
          file: record.file,
          record: record.name,
          field: "stays",
        });
      }
      if (location.at === undefined) {
        issues.push({
          severity: "warning",
          code: "needs-placing",
          message: "location has no position yet",
          file: record.file,
          record: record.name,
          field: "at",
          suggestion: "Place it with `timewright pick`.",
        });
      } else if (location.map === undefined) {
        issues.push({
          severity: "error",
          code: "missing-map",
          message: "a placed location needs the map it sits on",
          file: record.file,
          record: record.name,
          field: "map",
        });
      }
    }

    if (location.exists !== undefined) {
      const from = parseOrIssue(issues, location.exists.from, parseOptions, {
        file: record.file,
        record: record.name,
        field: "exists.from",
      });
      const until = parseOrIssue(issues, location.exists.until, parseOptions, {
        file: record.file,
        record: record.name,
        field: "exists.until",
      });
      if (from !== undefined && until !== undefined && compareDates(from, until) > 0) {
        issues.push({
          severity: "error",
          code: "inverted-range",
          message: `location exists from "${from.raw}" until "${until.raw}"`,
          file: record.file,
          record: record.name,
          field: "exists",
        });
      }
    }

    checkStays(issues, index, parseOptions, record.file, record.name, location.stays, "stays");
  }
}

function checkPeople(issues: Issue[], index: WorldIndex, parseOptions: ParseOptions): void {
  for (const record of index.people) {
    const person = record.data;
    const born = parseOrIssue(issues, person.born, parseOptions, {
      file: record.file,
      record: record.name,
      field: "born",
    });
    const died = parseOrIssue(issues, person.died, parseOptions, {
      file: record.file,
      record: record.name,
      field: "died",
    });
    if (born !== undefined && died !== undefined && compareDates(born, died) > 0) {
      issues.push({
        severity: "warning",
        code: "inverted-range",
        message: `born "${born.raw}" is after died "${died.raw}"`,
        file: record.file,
        record: record.name,
        field: "born",
      });
    }
    checkStays(issues, index, parseOptions, record.file, record.name, person.stays, "stays");
  }
}

function checkStays(
  issues: Issue[],
  index: WorldIndex,
  parseOptions: ParseOptions,
  file: string | undefined,
  recordName: string,
  stays: { at: string; from?: string | number; until?: string | number }[] | undefined,
  field: string,
): void {
  if (stays === undefined) {
    return;
  }
  const bounds: { at: string; from?: ParsedDate | undefined; until?: ParsedDate | undefined }[] = [];
  for (const stay of stays) {
    if (!index.locationNames.has(stay.at)) {
      issues.push({
        severity: "error",
        code: "unknown-reference",
        message: `unknown location "${stay.at}"`,
        file,
        record: recordName,
        field,
        suggestion: suggestionText(index.locationNames.suggest(stay.at)),
      });
    }
    const from = parseOrIssue(issues, stay.from, parseOptions, { file, record: recordName, field: `${field}.from` });
    const until = parseOrIssue(issues, stay.until, parseOptions, { file, record: recordName, field: `${field}.until` });
    if (from !== undefined && until !== undefined && compareDates(from, until) > 0) {
      issues.push({
        severity: "error",
        code: "inverted-range",
        message: `stay at "${stay.at}" starts after it ends`,
        file,
        record: recordName,
        field,
      });
    }
    bounds.push({ at: stay.at, from, until });
  }
  // Two stays that overlap put the reader in two places at once, and the
  // resolver quietly picks the first one it finds.
  for (let first = 0; first < bounds.length; first += 1) {
    for (let second = first + 1; second < bounds.length; second += 1) {
      const a = bounds[first];
      const b = bounds[second];
      if (a === undefined || b === undefined || !staysOverlap(a, b)) {
        continue;
      }
      issues.push({
        severity: "warning",
        code: "overlapping-stays",
        message: `the stays at "${a.at}" and "${b.at}" overlap in time`,
        file,
        record: recordName,
        field,
        suggestion: "One of them has to end before the other begins.",
      });
    }
  }
}

/** Whether two stays cover some of the same time. */
function staysOverlap(
  a: { from?: ParsedDate | undefined; until?: ParsedDate | undefined },
  b: { from?: ParsedDate | undefined; until?: ParsedDate | undefined },
): boolean {
  const aEndsBeforeB = a.until !== undefined && b.from !== undefined && compareBounds(a.until, b.from) < 0;
  const bEndsBeforeA = b.until !== undefined && a.from !== undefined && compareBounds(b.until, a.from) < 0;
  return !aEndsBeforeB && !bEndsBeforeA;
}

/**
 * Warn when a point falls outside the map it belongs to.
 *
 * A mistyped coordinate is simply off-screen, with nothing to say so.
 */
function checkPoint(
  issues: Issue[],
  index: WorldIndex,
  mapReference: string,
  point: [number, number],
  context: { file?: string | undefined; record: string; field: string; what: string },
): void {
  const mapId = index.mapNames.resolve(mapReference);
  const map = mapId !== undefined ? index.mapIds.get(mapId)?.data : undefined;
  if (map?.size === undefined) {
    return;
  }
  const [x, y] = point;
  if (x >= 0 && y >= 0 && x <= map.size[0] && y <= map.size[1]) {
    return;
  }
  issues.push({
    severity: "warning",
    code: "point-off-map",
    message: `${context.what} is at [${x}, ${y}], outside its map "${map.name}" (${map.size[0]}x${map.size[1]})`,
    file: context.file,
    record: context.record,
    field: context.field,
    suggestion: "A point off the map cannot be drawn.",
  });
}

function checkEvents(issues: Issue[], index: WorldIndex, parseOptions: ParseOptions): void {
  for (const record of index.events) {
    const event = record.data;

    parseOrIssue(issues, event.when, parseOptions, {
      file: record.file,
      record: record.name,
      field: "when",
    });

    if (typeof event.where === "string") {
      if (!index.locationNames.has(event.where)) {
        if (index.mapNames.has(event.where)) {
          issues.push({
            severity: "error",
            code: "where-is-a-map",
            message: `"${event.where}" is a map, not a location`,
            file: record.file,
            record: record.name,
            field: "where",
          });
        } else {
          issues.push({
            severity: "warning",
            code: "needs-placing",
            message: `event points at "${event.where}", which is not a location yet`,
            file: record.file,
            record: record.name,
            field: "where",
            suggestion: "Create the location, then place it with `timewright pick`.",
          });
        }
      }
    } else if (event.where !== undefined) {
      if (!index.mapNames.has(event.where.map)) {
        issues.push({
          severity: "error",
          code: "unknown-reference",
          message: `unknown map "${event.where.map}"`,
          file: record.file,
          record: record.name,
          field: "where.map",
          suggestion: suggestionText(index.mapNames.suggest(event.where.map)),
        });
      } else {
        checkPoint(issues, index, event.where.map, event.where.at, {
          file: record.file,
          record: record.name,
          field: "where.at",
          what: `event "${record.name}"`,
        });
      }
    }

    for (const person of event.people ?? []) {
      if (!index.peopleNames.has(person)) {
        issues.push({
          severity: "error",
          code: "unknown-reference",
          message: `unknown person "${person}"`,
          file: record.file,
          record: record.name,
          field: "people",
          suggestion: suggestionText(index.peopleNames.suggest(person)),
        });
      }
    }

    for (const location of event.locations ?? []) {
      if (!index.locationNames.has(location)) {
        issues.push({
          severity: "error",
          code: "unknown-reference",
          message: `unknown location "${location}"`,
          file: record.file,
          record: record.name,
          field: "locations",
          suggestion: suggestionText(index.locationNames.suggest(location)),
        });
      }
    }
  }
}
