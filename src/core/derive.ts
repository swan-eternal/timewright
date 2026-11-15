/**
 * Derivation: turning a loaded world into the model the viewer reads, and
 * answering the questions the viewer asks about a date.
 *
 * Paths and steps land here too (Phase 3). What is here now is the
 * resolution of names and dates, the map image for a date, and the rules
 * for what exists when.
 */

import { compareBounds, compareDates, parseDate, type DateBound, type ParsedDate } from "./dates.js";
import type {
  ResolvedEvent,
  ResolvedLocation,
  ResolvedMap,
  ResolvedMapImage,
  ResolvedPerson,
  ResolvedWorld,
} from "./model.js";
import { buildIndex, calendarOptions, type WorldData } from "./validate.js";

/** Resolve a loaded world into the model the viewer reads. */
export function resolveWorld(data: WorldData): ResolvedWorld {
  const index = buildIndex(data);
  const options = calendarOptions(index.world);

  const parse = (value: string | number | undefined): ParsedDate | undefined => {
    if (value === undefined) {
      return undefined;
    }
    try {
      return parseDate(value, options);
    } catch {
      // The validator already reported it; here it just has no value.
      return undefined;
    }
  };

  const maps: ResolvedMap[] = index.maps.map((record) => {
    const map = record.data;
    const source = map.images ?? (map.file !== undefined ? [{ file: map.file }] : []);
    const images: ResolvedMapImage[] = source.map((image) => ({
      file: image.file,
      from: parse(image.from),
      until: parse(image.until),
      caption: image.caption,
    }));
    return {
      id: record.id,
      name: record.name,
      parent: map.parent !== undefined ? index.mapNames.resolve(map.parent) : undefined,
      size: map.size,
      images,
    };
  });

  const locations: ResolvedLocation[] = index.locations.map((record) => {
    const location = record.data;
    return {
      id: record.id,
      name: location.name,
      aliases: location.aliases ?? [],
      kind: location.kind,
      map: location.map !== undefined ? index.mapNames.resolve(location.map) : undefined,
      at: location.at,
      opens: location.opens !== undefined ? index.mapNames.resolve(location.opens) : undefined,
      exists:
        location.exists !== undefined
          ? { from: parse(location.exists.from), until: parse(location.exists.until) }
          : undefined,
      stays: (location.stays ?? []).map((stay) => ({
        at: index.locationNames.resolve(stay.at) ?? stay.at,
        from: parse(stay.from),
        until: parse(stay.until),
      })),
      tags: location.tags ?? [],
      card: location.card,
      bio: location.bio,
      image: location.image,
    };
  });

  const people: ResolvedPerson[] = index.people.map((record) => ({
    id: record.id,
    name: record.name,
    aliases: record.data.aliases ?? [],
    born: parse(record.data.born),
    died: parse(record.data.died),
    color: record.data.color,
    stays: (record.data.stays ?? []).map((stay) => ({
      at: index.locationNames.resolve(stay.at) ?? stay.at,
      from: parse(stay.from),
      until: parse(stay.until),
    })),
    tags: record.data.tags ?? [],
    bio: record.data.bio,
    image: record.data.image,
  }));

  const events: ResolvedEvent[] = index.events.map((record) => {
    const event = record.data;
    let where: ResolvedEvent["where"];
    if (typeof event.where === "string") {
      const locationId = index.locationNames.resolve(event.where);
      where = locationId !== undefined ? { location: locationId } : undefined;
    } else if (event.where !== undefined) {
      where = {
        map: index.mapNames.resolve(event.where.map),
        at: event.where.at,
      };
    }
    return {
      id: record.id,
      title: event.title,
      when: parse(event.when) ?? { raw: String(event.when), approx: false, kind: "exact", warnings: [] },
      where,
      people: resolveAll((reference) => index.peopleNames.resolve(reference), event.people),
      locations: resolveAll((reference) => index.locationNames.resolve(reference), event.locations),
      tags: event.tags ?? [],
      order: event.order,
      card: event.card,
      sources: event.sources,
    };
  });

  return {
    title: index.world.title,
    overworld:
      index.world.overworld !== undefined ? index.mapNames.resolve(index.world.overworld) : undefined,
    calendar: index.world.calendar === "gregorian" ? undefined : index.world.calendar,
    start: parse(index.world.start),
    end: parse(index.world.end),
    maps,
    locations,
    people,
    events,
  };
}

function resolveAll(resolve: (reference: string) => string | undefined, references: string[] | undefined): string[] {
  if (references === undefined) {
    return [];
  }
  const resolved: string[] = [];
  for (const reference of references) {
    const id = resolve(reference);
    if (id !== undefined && !resolved.includes(id)) {
      resolved.push(id);
    }
  }
  return resolved;
}

/**
 * The map image that covers a date.
 *
 * `from` and `until` are both inclusive. If no image covers the date, the
 * nearest earlier one is used; if the date is before every image, the
 * earliest one is.
 */
export function imageForDate(map: ResolvedMap, date?: DateBound): ResolvedMapImage | undefined {
  if (map.images.length === 0) {
    return undefined;
  }
  const sorted = [...map.images].sort((a, b) => compareImageStart(a, b));

  if (date === undefined) {
    return sorted[0];
  }

  let covering: ResolvedMapImage | undefined;
  for (const image of sorted) {
    if (image.from !== undefined && compareBounds(date, image.from) < 0) {
      continue;
    }
    if (image.until !== undefined && compareBounds(date, image.until) > 0) {
      continue;
    }
    covering = image;
  }
  if (covering !== undefined) {
    return covering;
  }

  let earlier: ResolvedMapImage | undefined;
  for (const image of sorted) {
    if (image.from !== undefined && compareBounds(date, image.from) >= 0) {
      earlier = image;
    }
  }
  return earlier ?? sorted[0];
}

function compareImageStart(a: ResolvedMapImage, b: ResolvedMapImage): number {
  const left = a.from ?? { raw: "", approx: false };
  const right = b.from ?? { raw: "", approx: false };
  return compareBounds(left, right);
}

/** Whether a location exists at a date. Both ends of `exists` are inclusive. */
export function locationVisibleAt(location: ResolvedLocation, date?: DateBound): boolean {
  if (location.exists === undefined || date === undefined) {
    return true;
  }
  const { from, until } = location.exists;
  if (from !== undefined && compareBounds(date, from) < 0) {
    return false;
  }
  if (until !== undefined && compareBounds(date, until) > 0) {
    return false;
  }
  return true;
}

/** The chain of maps leading to one map, outermost first. */
export function mapChain(world: ResolvedWorld, mapId: string): ResolvedMap[] {
  const byId = new Map(world.maps.map((map) => [map.id, map]));
  const chain: ResolvedMap[] = [];
  let current = byId.get(mapId);
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parent !== undefined ? byId.get(current.parent) : undefined;
  }
  return chain;
}

/** Events in date order, with `order` and then the id breaking ties. */
export function sortedEvents(world: ResolvedWorld): ResolvedEvent[] {
  return [...world.events].sort((a, b) => {
    const byDate = compareDates(a.when, b.when);
    if (byDate !== 0) {
      return byDate;
    }
    const byOrder = (a.order ?? 0) - (b.order ?? 0);
    if (byOrder !== 0) {
      return byOrder;
    }
    return a.id.localeCompare(b.id);
  });
}

/** The place an event happens: a location on a map, or a raw point. */
export function eventPlace(
  world: ResolvedWorld,
  event: ResolvedEvent,
): { mapId?: string; at?: [number, number]; location?: ResolvedLocation } | undefined {
  if (event.where === undefined) {
    return undefined;
  }
  if (event.where.location !== undefined) {
    const location = world.locations.find((entry) => entry.id === event.where?.location);
    if (location === undefined) {
      return undefined;
    }
    return { mapId: location.map, at: location.at, location };
  }
  if (event.where.map !== undefined && event.where.at !== undefined) {
    return { mapId: event.where.map, at: event.where.at };
  }
  return undefined;
}
