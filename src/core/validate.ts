/**
 * Cross-record checks for a world.
 *
 * The loader checks one record at a time (shape, YAML, files on disk).
 * This module checks the world as a whole: names resolve, ids are unique,
 * dates make sense, and a mobile location is not also a fixed one.
 */

import { compareDates, tryParseDate, type ParseOptions, type ParsedDate } from "./dates.js";
import { levenshtein, NameIndex, slugify } from "./resolve.js";
import {
  EventSchema,
  knownKeys,
  LocationSchema,
  MapSchema,
  PersonSchema,
  type EventRecord,
  type LocationRecord,
  type MapRecord,
  type PersonRecord,
  type WorldRecord,
} from "./schema.js";

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

export interface Source<T> {
  data: T;
  /** The file the record came from. */
  file?: string | undefined;
  /** Which record in that file it was, when the file holds a list. */
  index?: number | undefined;
}

export interface WorldData {
  world: Source<WorldRecord>;
  maps: Source<MapRecord>[];
  people: Source<PersonRecord>[];
  locations: Source<LocationRecord>[];
  events: Source<EventRecord>[];
}

export interface Indexed<T> {
  id: string;
  name: string;
  data: T;
  file?: string | undefined;
}

export interface WorldIndex {
  world: WorldRecord;
  maps: Indexed<MapRecord>[];
  people: Indexed<PersonRecord>[];
  locations: Indexed<LocationRecord>[];
  events: Indexed<EventRecord>[];
  mapIds: Map<string, Indexed<MapRecord>>;
  peopleIds: Map<string, Indexed<PersonRecord>>;
  locationIds: Map<string, Indexed<LocationRecord>>;
  mapNames: NameIndex;
  peopleNames: NameIndex;
  locationNames: NameIndex;
}

export interface ValidateOptions {
  /** Report warnings as errors. */
  strict?: boolean;
}

function recordId(explicit: string | undefined, name: string): string {
  return explicit !== undefined && explicit !== "" ? explicit : slugify(name);
}

export function buildIndex(data: WorldData): WorldIndex {
  const maps: Indexed<MapRecord>[] = [];
  const people: Indexed<PersonRecord>[] = [];
  const locations: Indexed<LocationRecord>[] = [];
  const events: Indexed<EventRecord>[] = [];

  for (const source of data.maps) {
    maps.push({
      id: recordId(source.data.id, source.data.name),
      name: source.data.name,
      data: source.data,
      file: source.file,
    });
  }
  for (const source of data.people) {
    people.push({
      id: recordId(source.data.id, source.data.name),
      name: source.data.name,
      data: source.data,
      file: source.file,
    });
  }
  for (const source of data.locations) {
    locations.push({
      id: recordId(source.data.id, source.data.name),
      name: source.data.name,
      data: source.data,
      file: source.file,
    });
  }
  for (const source of data.events) {
    events.push({
      id: recordId(source.data.id, source.data.title),
      name: source.data.title,
      data: source.data,
      file: source.file,
    });
  }

  const mapIds = new Map<string, Indexed<MapRecord>>();
  const peopleIds = new Map<string, Indexed<PersonRecord>>();
  const locationIds = new Map<string, Indexed<LocationRecord>>();

  const mapNames = new NameIndex();
  const peopleNames = new NameIndex();
  const locationNames = new NameIndex();

  for (const record of maps) {
    mapIds.set(record.id, record);
    // The id answers to itself as well as to the name: "map: region" has to
    // work when the map is called "The Local Neighbourhood".
    mapNames.add(record.id, record.data.name, [record.id, ...(record.data.aliases ?? [])]);
  }
  for (const record of people) {
    peopleIds.set(record.id, record);
    peopleNames.add(record.id, record.data.name, [record.id, ...(record.data.aliases ?? [])]);
  }
  for (const record of locations) {
    locationIds.set(record.id, record);
    locationNames.add(record.id, record.data.name, [record.id, ...(record.data.aliases ?? [])]);
  }

  return {
    world: data.world.data,
    maps,
    people,
    locations,
    events,
    mapIds,
    peopleIds,
    locationIds,
    mapNames,
    peopleNames,
    locationNames,
  };
}

export function calendarOptions(world: WorldRecord): ParseOptions {
  if (world.calendar === undefined || world.calendar === "gregorian") {
    return {};
  }
  return { calendar: world.calendar };
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

function checkUnknownFields(issues: Issue[], index: WorldIndex): void {
  const groups: { records: { file?: string | undefined; data: Record<string, unknown>; name: string }[]; known: string[] }[] = [
    { records: index.maps.map((record) => ({ file: record.file, data: record.data as Record<string, unknown>, name: record.name })), known: knownKeys(MapSchema) },
    { records: index.people.map((record) => ({ file: record.file, data: record.data as Record<string, unknown>, name: record.name })), known: knownKeys(PersonSchema) },
    { records: index.locations.map((record) => ({ file: record.file, data: record.data as Record<string, unknown>, name: record.name })), known: knownKeys(LocationSchema) },
    { records: index.events.map((record) => ({ file: record.file, data: record.data as Record<string, unknown>, name: record.name })), known: knownKeys(EventSchema) },
  ];

  for (const group of groups) {
    for (const record of group.records) {
      for (const key of Object.keys(record.data)) {
        if (group.known.includes(key)) {
          continue;
        }
        // A typo usually keeps its length, so a same-length field is the
        // better guess: "bith" is meant to be "born", not "bio".
        const near = group.known
          .map((known) => {
            const distance = levenshtein(key, known);
            const lengthPenalty = Math.abs(known.length - key.length) * 0.25;
            const sameLengthBonus = known.length === key.length ? -1 : 0;
            return { known, distance, score: distance + lengthPenalty + sameLengthBonus };
          })
          .filter((candidate) => candidate.distance <= Math.max(3, Math.floor(key.length / 3)))
          .sort((a, b) => a.score - b.score || a.distance - b.distance || a.known.localeCompare(b.known))[0];
        issues.push({
          severity: "warning",
          code: "unknown-field",
          message: `unknown field "${key}"`,
          file: record.file,
          record: record.name,
          field: key,
          suggestion: near !== undefined ? `Did you mean "${near.known}"?` : undefined,
        });
      }
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
          cursor = index.mapIds.get(cursor)?.data.parent;
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
  }
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
