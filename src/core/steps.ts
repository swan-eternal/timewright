/**
 * Steps and paths: what the viewer walks through, and where a traced person
 * or vessel went.
 *
 * A step is one thing the reader can step onto. In span mode they are the
 * events inside the visible span. In single-event mode they are the events
 * of one person or vessel, plus the boundaries of their stays.
 */

import { compareBounds, compareDateBounds, compareDates, type DateBound } from "./dates.js";
import { eventPlace, resolveLocationAt, sortedEvents } from "./derive.js";
import type { ResolvedEvent, ResolvedLocation, ResolvedPerson, ResolvedWorld } from "./model.js";

export interface Span {
  from: DateBound;
  to: DateBound;
}

export interface TraceStep {
  /** The event this step is, when it is an event. */
  eventId?: string;
  /** A person or location the step belongs to. */
  entityId?: string;
  date: DateBound;
  kind: "event" | "stay";
  label: string;
  mapId?: string | undefined;
  at?: [number, number] | undefined;
  locationId?: string | undefined;
  /** Event sort order within the same date, if from an event. */
  order?: number | undefined;
}

export interface PathPoint {
  date: DateBound;
  mapId?: string | undefined;
  at?: [number, number] | undefined;
  locationId?: string | undefined;
  /** The name of the place, for the marker where the path changes map. */
  locationName?: string | undefined;
}

/** The events inside a span, in date order. Both ends are inclusive. */
export function spanSteps(world: ResolvedWorld, span: Span): ResolvedEvent[] {
  return sortedEvents(world).filter((event) => {
    if (compareBounds(event.when, span.from) < 0) {
      return false;
    }
    return compareBounds(event.when, span.to) <= 0;
  });
}

/**
 * The events that have no place on the map.
 *
 * They are not tied to any map's era, so they stay on the timeline even
 * when the visible span does not cover them - the reader pins them to the
 * edge of the strip rather than losing them.
 */
export function unplacedEvents(world: ResolvedWorld): ResolvedEvent[] {
  return sortedEvents(world).filter((event) => eventPlace(world, event) === undefined);
}

/** The steps of one traced person or location. */
export function traceSteps(world: ResolvedWorld, entityId: string): TraceStep[] {
  const steps: TraceStep[] = [];
  const person = world.people.find((entry) => entry.id === entityId);
  const location = world.locations.find((entry) => entry.id === entityId);

  if (person !== undefined) {
    for (const event of sortedEvents(world)) {
      if (!event.people.includes(person.id)) {
        continue;
      }
      const place = eventPlace(world, event);
      steps.push({
        eventId: event.id,
        entityId: person.id,
        date: event.when,
        kind: "event",
        label: event.title,
        mapId: place?.mapId,
        at: place?.at,
        locationId: place?.location?.id,
        order: event.order,
      });
    }
    for (const stay of person.stays) {
      steps.push(...staySteps(world, person.id, stay.at, stay.from, stay.until));
    }
  }

  if (location !== undefined) {
    for (const event of sortedEvents(world)) {
      const place = eventPlace(world, event);
      if (place?.location?.id !== location.id && !event.locations.includes(location.id)) {
        continue;
      }
      steps.push({
        eventId: event.id,
        entityId: location.id,
        date: event.when,
        kind: "event",
        label: event.title,
        mapId: place?.mapId,
        at: place?.at,
        locationId: location.id,
        order: event.order,
      });
    }
    for (const stay of location.stays) {
      steps.push(...staySteps(world, location.id, stay.at, stay.from, stay.until));
    }
  }

  const ordered = steps.sort(
    (a, b) =>
      compareBounds(a.date, b.date) ||
      stepOrder(a) - stepOrder(b) ||
      (a.order ?? 0) - (b.order ?? 0) ||
      (a.eventId ?? a.label).localeCompare(b.eventId ?? b.label),
  );

  // Merge redundant stay boundaries into canon events on the same date & place
  // (e.g. "Departure of Sylveste expedition" absorbs "Left Chasm City").
  const eventKeys = new Set<string>();
  for (const step of ordered) {
    if (step.kind === "event" && step.locationId !== undefined) {
      eventKeys.add(`${step.date.raw}|${step.locationId}`);
    }
  }
  return ordered.filter((step) => {
    if (step.kind !== "stay" || step.locationId === undefined) {
      return true;
    }
    return !eventKeys.has(`${step.date.raw}|${step.locationId}`);
  });
}

function stepOrder(step: TraceStep): number {
  return step.kind === "event" ? 0 : 1;
}

function staySteps(
  world: ResolvedWorld,
  entityId: string,
  locationId: string,
  from: DateBound | undefined,
  until: DateBound | undefined,
): TraceStep[] {
  const steps: TraceStep[] = [];
  const place = world.locations.find((entry) => entry.id === locationId);
  if (place?.kind === "mobile") {
    if (from !== undefined) {
      const resolved = resolveLocationAt(world, locationId, from);
      steps.push({
        entityId,
        date: from,
        kind: "stay",
        label: `Aboard ${place.name}`,
        mapId: resolved?.mapId,
        at: resolved?.at,
        locationId,
      });
    }
    for (const vesselStay of place.stays) {
      if (vesselStay.from !== undefined) {
        const afterStart = from === undefined || compareBounds(vesselStay.from, from) > 0;
        const beforeEnd = until === undefined || compareBounds(vesselStay.from, until) <= 0;
        if (afterStart && beforeEnd) {
          const resolved = resolveLocationAt(world, vesselStay.at, vesselStay.from);
          const targetName = world.locations.find((entry) => entry.id === vesselStay.at)?.name ?? vesselStay.at;
          steps.push({
            entityId,
            date: vesselStay.from,
            kind: "stay",
            label: `${place.name} arrived at ${targetName}`,
            mapId: resolved?.mapId,
            at: resolved?.at,
            locationId: vesselStay.at,
          });
        }
      }
    }
    if (until !== undefined) {
      const resolved = resolveLocationAt(world, locationId, until);
      steps.push({
        entityId,
        date: until,
        kind: "stay",
        label: `Left ${place.name}`,
        mapId: resolved?.mapId,
        at: resolved?.at,
        locationId,
      });
    }
    return steps;
  }

  if (from !== undefined) {
    const resolved = resolveLocationAt(world, locationId, from);
    steps.push({
      entityId,
      date: from,
      kind: "stay",
      label: `Arrived at ${place?.name ?? locationId}`,
      mapId: resolved?.mapId ?? place?.map,
      at: resolved?.at ?? place?.at,
      locationId,
    });
  }
  if (until !== undefined) {
    const resolved = resolveLocationAt(world, locationId, until);
    steps.push({
      entityId,
      date: until,
      kind: "stay",
      label: `Left ${place?.name ?? locationId}`,
      mapId: resolved?.mapId ?? place?.map,
      at: resolved?.at ?? place?.at,
      locationId,
    });
  }
  return steps;
}

/** Where a traced person or vessel went, in date order (optionally up to `upTo`). */
export function tracePath(world: ResolvedWorld, entityId: string, upTo?: DateBound): PathPoint[] {
  return traceSteps(world, entityId)
    .filter((step) => {
      if (step.mapId === undefined || step.at === undefined) {
        return false;
      }
      if (upTo !== undefined && compareDateBounds(step.date, upTo) > 0) {
        return false;
      }
      return true;
    })
    .map((step) => ({
      date: step.date,
      mapId: step.mapId,
      at: step.at,
      locationId: step.locationId,
      locationName: world.locations.find((entry) => entry.id === step.locationId)?.name,
    }));
}

/** The people and mobile locations that can be traced. */
export function traceable(world: ResolvedWorld): { id: string; name: string; kind: "person" | "location" }[] {
  const people = world.people.map((person: ResolvedPerson) => ({
    id: person.id,
    name: person.name,
    kind: "person" as const,
  }));
  const mobile = world.locations
    .filter((location: ResolvedLocation) => location.kind === "mobile")
    .map((location) => ({ id: location.id, name: location.name, kind: "location" as const }));
  return [...people, ...mobile];
}

/** One thing the reader can step onto. */
export interface ViewStep {
  label: string;
  date: DateBound;
  eventId?: string | undefined;
  mapId?: string | undefined;
  locationId?: string | undefined;
  at?: [number, number] | undefined;
}

export interface StepOptions {
  /** "span" walks the events in the span; "trace" walks one person. */
  mode: "span" | "trace";
  traceId?: string | undefined;
  span?: Span | undefined;
  /** Text filter over the step labels. */
  query?: string | undefined;
  /** Tags the steps must all carry. */
  tags?: string[] | undefined;
}

/**
 * The steps the reader can walk through.
 *
 * In span mode they are the events inside the visible span, plus the events
 * that have no place on a map - those belong to no map's era, so they stay
 * on the timeline even when the span does not reach them. In trace mode
 * they are the steps of one person or vessel.
 */
export function viewSteps(world: ResolvedWorld, options: StepOptions): ViewStep[] {
  const query = (options.query ?? "").trim().toLowerCase();
  const tags = options.tags ?? [];

  let steps: ViewStep[];
  if (options.mode === "trace" && options.traceId !== undefined) {
    steps = traceSteps(world, options.traceId).map((step) => ({
      label: step.label,
      date: step.date,
      eventId: step.eventId,
      mapId: step.mapId,
      locationId: step.locationId,
      at: step.at,
    }));
  } else if (options.span !== undefined) {
    const inside = spanSteps(world, options.span);
    const seen = new Set(inside.map((event) => event.id));
    const unplaced = unplacedEvents(world).filter((event) => !seen.has(event.id));
    const combined = [...inside, ...unplaced].sort((a, b) => {
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
    steps = combined.map((event) => {
      const place = eventPlace(world, event);
      return {
        label: event.title,
        date: event.when,
        eventId: event.id,
        mapId: place?.mapId,
        locationId: place?.location?.id,
        at: place?.at,
      };
    });
  } else {
    steps = [];
  }

  if (query !== "") {
    steps = steps.filter((step) => step.label.toLowerCase().includes(query));
  }
  if (tags.length > 0) {
    steps = steps.filter((step) => {
      if (step.eventId === undefined) {
        return false;
      }
      const event = world.events.find((entry) => entry.id === step.eventId);
      return event !== undefined && tags.every((tag) => event.tags.includes(tag));
    });
  }
  return steps;
}

/** The step we are on: the last one at or before the date. */
export function stepIndex(steps: ViewStep[], date?: DateBound): number {
  if (steps.length === 0) {
    return 0;
  }
  let index = 0;
  if (date !== undefined) {
    for (let position = 0; position < steps.length; position += 1) {
      const step = steps[position];
      if (step !== undefined && compareDateBounds(step.date, date) <= 0) {
        index = position;
      }
    }
  }
  return index;
}

/** Compare two dates that may only be a year apart. */
export { compareDateBounds } from "./dates.js";

/** The step a date belongs to: the last step at or before it. */
export function stepAt(steps: TraceStep[], date: DateBound): TraceStep | undefined {
  let found: TraceStep | undefined;
  for (const step of steps) {
    if (compareBounds(step.date, date) <= 0) {
      found = step;
    }
  }
  return found;
}
