/**
 * Carrying references through a rename.
 *
 * A world is written by name: an event says `where: Waterloo`, a person
 * says they were at `Waterloo`. Rename the place and every one of those
 * references points at nothing, which is the one way a world loses data.
 *
 * This walks the world after a rename and rewrites the references that
 * pointed at the renamed record, in the canonical spelling: a map by its
 * id, a place or a person by its name.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseDocument } from "yaml";

import { buildIndex, type Indexed, type WorldIndex } from "../core/building.js";
import { NameIndex, slugify } from "../core/resolve.js";
import { nameIndexFor, recordsOf, referenceFor, type RefKind } from "../core/references.js";
import type { MapRecord } from "../core/schema.js";

export interface RenameCarry {
  /** The kind of record that was renamed. */
  kind: RefKind;
  /** Its id before the rename. */
  oldId: string;
  /** Its name before the rename. */
  oldName: string;
  /** Its id after the rename. */
  newId: string;
  /** Its name after the rename. */
  newName: string;
}

export interface CarryResult {
  /** How many references were carried over. */
  updated: number;
  /** The spelling left alone because another record answers to it too. */
  ambiguous: string[];
}

interface Slot {
  /** The file the record lives in. */
  file: string;
  /** Where the record sits in that file. */
  prefix: (string | number)[];
  /** Where the reference sits inside the record. */
  path: (string | number)[];
  /** What kind of record the reference points at. */
  kind: RefKind;
  /** The spelling as it is written now. */
  value: string;
}

/**
 * Every reference in the world, and where it is written.
 *
 * The walk is by record, not by file, so a world that keeps its records in
 * one list file and a world that gives every record its own file are both
 * covered by the same code.
 */
function collectSlots(index: WorldIndex): Slot[] {
  const slots: Slot[] = [];

  const worldFile = index.worldFile;
  if (worldFile !== undefined && index.world.overworld !== undefined) {
    slots.push({
      file: worldFile,
      prefix: [],
      path: ["overworld"],
      kind: "map",
      value: index.world.overworld,
    });
  }

  for (const record of index.maps) {
    if (record.file === undefined || record.data.parent === undefined) {
      continue;
    }
    const prefix = mapPrefix(index, record);
    if (prefix === undefined) {
      continue;
    }
    slots.push({
      file: record.file,
      prefix,
      path: ["parent"],
      kind: "map",
      value: record.data.parent,
    });
  }

  for (const record of index.locations) {
    if (record.file === undefined) {
      continue;
    }
    const prefix = record.index !== undefined ? [record.index] : [];
    if (record.data.map !== undefined) {
      slots.push({ file: record.file, prefix, path: ["map"], kind: "map", value: record.data.map });
    }
    if (record.data.opens !== undefined) {
      slots.push({ file: record.file, prefix, path: ["opens"], kind: "map", value: record.data.opens });
    }
    for (const [at, stay] of (record.data.stays ?? []).entries()) {
      slots.push({
        file: record.file,
        prefix,
        path: ["stays", at, "at"],
        kind: "location",
        value: stay.at,
      });
    }
  }

  for (const record of index.people) {
    if (record.file === undefined) {
      continue;
    }
    const prefix = record.index !== undefined ? [record.index] : [];
    for (const [at, stay] of (record.data.stays ?? []).entries()) {
      slots.push({
        file: record.file,
        prefix,
        path: ["stays", at, "at"],
        kind: "location",
        value: stay.at,
      });
    }
  }

  for (const record of index.events) {
    if (record.file === undefined) {
      continue;
    }
    const prefix = record.index !== undefined ? [record.index] : [];
    const where = record.data.where;
    if (typeof where === "string") {
      slots.push({ file: record.file, prefix, path: ["where"], kind: "location", value: where });
    } else if (where !== undefined && typeof where.map === "string") {
      slots.push({
        file: record.file,
        prefix,
        path: ["where", "map"],
        kind: "map",
        value: where.map,
      });
    }
    for (const [at, person] of (record.data.people ?? []).entries()) {
      slots.push({ file: record.file, prefix, path: ["people", at], kind: "person", value: person });
    }
    for (const [at, place] of (record.data.locations ?? []).entries()) {
      slots.push({
        file: record.file,
        prefix,
        path: ["locations", at],
        kind: "location",
        value: place,
      });
    }
  }

  return slots;
}

/**
 * Where a map sits in its file.
 *
 * A map written inside world.yaml is found by its place in the `maps`
 * list; a map in its own file is either the only record in it or one of a
 * list.
 */
function mapPrefix(index: WorldIndex, record: Indexed<MapRecord>): (string | number)[] | undefined {
  if (index.worldFile !== undefined && record.file === index.worldFile && record.index === undefined) {
    const inline = index.world.maps ?? [];
    const at = inline.findIndex((map) => (map.id ?? slugify(map.name)) === record.id);
    return at >= 0 ? ["maps", at] : undefined;
  }
  return record.index !== undefined ? [record.index] : [];
}

/**
 * Carry the references of a renamed record over to its new name.
 *
 * The references are matched the way the reader will match them: by name
 * and by id. A reference that names the old record is rewritten; one that
 * names an alias is left alone, because an alias still answers.
 */
export async function carryRename(root: string, carry: RenameCarry): Promise<CarryResult> {
  const { loadWorld } = await import("./load.js");
  const loaded = await loadWorld(root);
  const index = buildIndex(loaded.data);

  // The names as they were before the rename, so a reference written the
  // old way is still recognisable.
  const before = new NameIndex();
  for (const record of recordsOf(carry.kind, index)) {
    if (record.id === carry.oldId) {
      continue;
    }
    before.add(record.id, record.name, [record.id]);
  }
  before.add(carry.oldId, carry.oldName, [carry.oldId]);

  const canonical = referenceFor(carry.kind, { id: carry.newId, name: carry.newName });
  if (nameIndexFor(carry.kind, index).resolve(canonical) !== carry.newId) {
    // Another record answers to the new spelling as well, so rewriting
    // would point the reference at the wrong one.
    return { updated: 0, ambiguous: [canonical] };
  }

  const edits = new Map<
    string,
    { prefix: (string | number)[]; path: (string | number)[]; value: string }[]
  >();
  let updated = 0;

  for (const slot of collectSlots(index)) {
    if (slot.kind !== carry.kind) {
      continue;
    }
    if (before.resolve(slot.value) !== carry.oldId) {
      continue;
    }
    if (slot.value === canonical) {
      continue;
    }
    const list = edits.get(slot.file) ?? [];
    list.push({ prefix: slot.prefix, path: slot.path, value: canonical });
    edits.set(slot.file, list);
    updated += 1;
  }

  for (const [file, list] of edits) {
    const text = await readFile(file, "utf8");
    const document = parseDocument(text);
    for (const edit of list) {
      document.setIn([...edit.prefix, ...edit.path], edit.value);
    }
    await writeFile(file, document.toString({ collectionStyle: "any" }), "utf8");
  }

  return { updated, ambiguous: [] };
}
