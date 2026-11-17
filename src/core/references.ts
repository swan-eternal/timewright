/**
 * How references are written.
 *
 * The core resolves names and ids alike, so a world reads back whatever
 * spelling it was written in. The writers need one spelling, though: a map
 * is referenced by its id, a place or a person by its name. One rule, one
 * helper - so a rename has exactly one place to look for the references
 * that pointed at a record.
 */

import type { WorldIndex } from "./building.js";
import type { NameIndex } from "./resolve.js";

export type RefKind = "map" | "location" | "person";

export interface RefTarget {
  /** The record's id. */
  id: string;
  /** The record's display name. */
  name: string;
}

/** The spelling to write when referring to a record of this kind. */
export function referenceFor(kind: RefKind, target: RefTarget): string {
  return kind === "map" ? target.id : target.name;
}

/** The name index that answers references of this kind. */
export function nameIndexFor(kind: RefKind, index: WorldIndex): NameIndex {
  if (kind === "map") {
    return index.mapNames;
  }
  if (kind === "location") {
    return index.locationNames;
  }
  return index.peopleNames;
}

/** Every record of a kind, with the id and the name it answers to. */
export function recordsOf(kind: RefKind, index: WorldIndex): RefTarget[] {
  if (kind === "map") {
    return index.maps.map((record) => ({ id: record.id, name: record.name }));
  }
  if (kind === "location") {
    return index.locations.map((record) => ({ id: record.id, name: record.name }));
  }
  return index.people.map((record) => ({ id: record.id, name: record.name }));
}

/**
 * The canonical spelling of a reference that is written somewhere already.
 *
 * Returns undefined when nothing in the world answers to the spelling, so
 * a caller can decide whether to keep what it had.
 */
export function canonicalReference(
  kind: RefKind,
  index: WorldIndex,
  spelling: string,
): string | undefined {
  const resolved = nameIndexFor(kind, index).resolve(spelling);
  if (resolved === undefined) {
    return undefined;
  }
  const record = recordsOf(kind, index).find((candidate) => candidate.id === resolved);
  if (record === undefined) {
    return undefined;
  }
  return referenceFor(kind, record);
}
