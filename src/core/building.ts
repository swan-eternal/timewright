/**
 * The index of a world: the ids, the names, and the records they point at.
 *
 * This lives apart from the validation layer on purpose. The validation
 * layer needs Zod to check a world, and the viewer needs only this: where
 * is Rome, what is its id, which records answer to that name. The reader
 * should not download a schema library to find out where a battle was.
 *
 * The types here are imported as types only, so nothing in this file
 * pulls in the schemas at runtime.
 */

import type { ParseOptions } from "./dates.js";
import { NameIndex, slugify } from "./resolve.js";
import type {
  EventRecord,
  LocationRecord,
  MapRecord,
  PersonRecord,
  WorldRecord,
} from "./schema.js";

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
  /** Which record in that file it is, when the file holds a list. */
  index?: number | undefined;
}

export interface WorldIndex {
  world: WorldRecord;
  /** The file world.yaml came from. */
  worldFile?: string | undefined;
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

function recordId(explicit: string | undefined, name: string): string {
  return explicit !== undefined && explicit !== "" ? explicit : slugify(name);
}

/** Index a world: every record gets an id, and every name an answer. */
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
      index: source.index,
    });
  }
  for (const source of data.people) {
    people.push({
      id: recordId(source.data.id, source.data.name),
      name: source.data.name,
      data: source.data,
      file: source.file,
      index: source.index,
    });
  }
  for (const source of data.locations) {
    locations.push({
      id: recordId(source.data.id, source.data.name),
      name: source.data.name,
      data: source.data,
      file: source.file,
      index: source.index,
    });
  }
  for (const source of data.events) {
    events.push({
      id: recordId(source.data.id, source.data.title),
      name: source.data.title,
      data: source.data,
      file: source.file,
      index: source.index,
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
    worldFile: data.world.file,
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

/** How to read the dates in this world. */
export function calendarOptions(world: WorldRecord): ParseOptions {
  if (world.calendar === undefined || world.calendar === "gregorian") {
    return {};
  }
  return { calendar: world.calendar };
}
