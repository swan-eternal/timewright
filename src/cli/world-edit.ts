/**
 * Writing to a world.
 *
 * The editor and the picker both change the YAML in place. The files stay
 * the source of truth, so an agent can keep working on a world a person has
 * been editing in the browser.
 *
 * A record is edited by editing its YAML document, not by regenerating it,
 * so the comments and the formatting survive. New records go into the
 * kind's list file when there is one, and into their own file when there
 * is not.
 */

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { isMap, isSeq, parseDocument, stringify, type YAMLSeq } from "yaml";

import { slugify } from "../core/resolve.js";
import { buildIndex } from "../core/building.js";

export type EditableKind = "location" | "person" | "event";

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
}

/**
 * The fields each kind of record can change from the editor.
 *
 * `required` cannot be left empty, `optional` is taken away when it is
 * left empty, and `lists` are comma separated.
 */
const EDITABLE_FIELDS: Record<
  EditableKind,
  { required: { key: string; label: string }[]; optional: string[]; lists: string[] }
> = {
  location: {
    required: [{ key: "name", label: "a name" }],
    optional: ["map", "card"],
    lists: ["aliases", "tags"],
  },
  person: {
    required: [{ key: "name", label: "a name" }],
    optional: ["born", "died", "bio"],
    lists: ["aliases", "tags"],
  },
  event: {
    required: [
      { key: "title", label: "a title" },
      { key: "when", label: "a date" },
    ],
    optional: ["where", "card"],
    lists: ["people", "tags"],
  },
};

/**
 * The file a write is allowed to touch.
 *
 * The editor's API takes the path from the browser, so it has to be
 * checked: a path outside the world folder is not ours to write.
 */
function resolveWithinWorld(root: string, file: string): string | undefined {
  const resolved = path.resolve(file);
  const base = path.resolve(root);
  if (!resolved.startsWith(base + path.sep)) {
    return undefined;
  }
  return resolved;
}

/**
 * Whether a path names a record in a document.
 *
 * The index comes from the browser too, and a list only goes so far:
 * writing past the end of one would fill it with blanks.
 */
function isRecordAt(document: { getIn(path: unknown[]): unknown }, index: number): boolean {
  if (!Number.isInteger(index) || index < 0) {
    return false;
  }
  const node = document.getIn([index]);
  return isMap(node);
}

/**
 * The fields to write for a record, from what the editor form collected.
 *
 * Three states, and the difference matters:
 *
 * - a key that is not in `values` is left alone;
 * - a key with a value is written;
 * - a key with an empty value is taken away.
 *
 * An empty optional field is therefore `null` - "remove it" - rather
 * than an empty string. An empty string would leave a date that cannot
 * be read and a card that hides the text underneath it.
 */
export function fieldsFromForm(
  kind: EditableKind,
  values: Record<string, string>,
): { ok: true; fields: Record<string, unknown> } | { ok: false; message: string } {
  const shape = EDITABLE_FIELDS[kind];
  const fields: Record<string, unknown> = {};

  for (const { key, label } of shape.required) {
    if (!(key in values)) {
      continue;
    }
    const value = values[key]?.trim() ?? "";
    if (value === "") {
      return { ok: false, message: `this ${kind} needs ${label}` };
    }
    fields[key] = value;
  }

  for (const key of shape.optional) {
    if (!(key in values)) {
      continue;
    }
    const value = values[key]?.trim() ?? "";
    fields[key] = value === "" ? null : value;
  }

  for (const key of shape.lists) {
    if (!(key in values)) {
      continue;
    }
    const list = (values[key] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    // An empty list is no list, so the key goes rather than staying as [].
    fields[key] = list.length === 0 ? null : list;
  }

  return { ok: true, fields };
}

const DIRECTORIES: Record<EditableKind, string> = {
  location: "locations",
  person: "people",
  event: "events",
};

const LIST_FILES: Record<EditableKind, string[]> = {
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

/**
 * The list file for a kind, if the world has one.
 *
 * It may sit at the root (`people.yaml`) or inside the kind's own folder
 * (`people/people.yaml`) - both are read, so both are fair game.
 */
async function findListFile(root: string, kind: EditableKind): Promise<string | undefined> {
  const names = LIST_FILES[kind];
  const inFolder = await findFirst(path.join(root, DIRECTORIES[kind]), names);
  if (inFolder !== undefined) {
    return inFolder;
  }
  return findFirst(root, names);
}

function documentText(document: ReturnType<typeof parseDocument>): string {
  return document.toString({ collectionStyle: "any" });
}

/** The document's root, when it is a list of records. */
function rootSequence(document: ReturnType<typeof parseDocument>): YAMLSeq<unknown> | undefined {
  const contents: unknown = document.contents;
  return isSeq(contents as YAMLSeq<unknown>) ? (contents as YAMLSeq<unknown>) : undefined;
}

/** Set fields on a record that already exists. */
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
  if (place.index !== undefined && !isRecordAt(document, place.index)) {
    return { ok: false, message: "that record is not in the file" };
  }
  const prefix = place.index !== undefined ? [place.index] : [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      // null means "take this field away", which is how a cleared date
      // or a cleared location is written.
      document.deleteIn([...prefix, key]);
      continue;
    }
    document.setIn([...prefix, key], value);
  }
  await writeFile(file, documentText(document), "utf8");

  // A record that lives in its own file should keep its file named after it.
  if (place.index === undefined) {
    const name = fields.name ?? fields.title;
    if (typeof name === "string" && name !== "") {
      const folder = path.dirname(file);
      if (folder === path.join(root, DIRECTORIES[kind])) {
        const wanted = `${slugify(name)}.yaml`;
        if (wanted !== path.basename(file)) {
          try {
            await rename(file, path.join(folder, wanted));
          } catch {
            // A rename is a nicety, not a requirement.
          }
        }
      }
    }
  }

  return { ok: true, message: `saved ${file}`, file };
}

/** Remove a record from the world. */
export async function deleteRecord(
  root: string,
  kind: EditableKind,
  place: RecordPlace,
): Promise<EditResult> {
  void kind;
  if (place.file === undefined) {
    return { ok: false, message: "that record has no file to delete from" };
  }
  const resolved = resolveWithinWorld(root, place.file);
  if (resolved === undefined) {
    return { ok: false, message: "that file is outside the world folder" };
  }
  if (place.index === undefined) {
    await unlink(resolved);
    return { ok: true, message: `deleted ${resolved}` };
  }
  const text = await readFile(resolved, "utf8");
  const document = parseDocument(text);
  if (!isRecordAt(document, place.index)) {
    return { ok: false, message: "that record is not in the file" };
  }
  document.deleteIn([place.index]);
  await writeFile(resolved, documentText(document), "utf8");
  return { ok: true, message: `deleted a record from ${resolved}`, file: resolved };
}

/** Add a record to the world. */
export async function createRecord(
  root: string,
  kind: EditableKind,
  record: Record<string, unknown>,
): Promise<EditResult> {
  const listFile = await findListFile(root, kind);
  if (listFile !== undefined) {
    const text = await readFile(listFile, "utf8");
    const document = parseDocument(text);
    const sequence = rootSequence(document);
    if (sequence !== undefined) {
      sequence.add(record);
      await writeFile(listFile, documentText(document), "utf8");
      return { ok: true, message: `added to ${listFile}`, file: listFile };
    }
  }

  const name = String(record.name ?? record.title ?? "record");
  const file = path.join(root, DIRECTORIES[kind], `${slugify(name)}.yaml`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, stringify(record, { lineWidth: 100 }), "utf8");
  return { ok: true, message: `created ${file}`, file };
}

/** Move a location to a new spot on its map. */
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
  for (const record of index.locations) {
    const location = record.data;
    // The editor sends the id the core uses; the picker sends the name.
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
    document.setIn([...prefix, "map"], mapId);
    await writeFile(record.file, documentText(document), "utf8");
    return { ok: true, message: `placed ${location.name} at ${Math.round(x)}, ${Math.round(y)}` };
  }
  return { ok: false, message: `no location called "${id}"` };
}

/** Save an image for a map, and reference it in the map's YAML. */
export async function saveMapImage(
  root: string,
  mapId: string,
  fileName: string,
  bytes: Buffer,
): Promise<EditResult> {
  const { loadWorld } = await import("./load.js");
  const loaded = await loadWorld(root);
  const index = buildIndex(loaded.data);
  for (const record of index.maps) {
    // The editor sends the id the core uses; the picker sends the name.
    if (record.id !== mapId && record.name !== mapId) {
      continue;
    }
    const safeName = path.basename(fileName).replace(/[^\w.\-]+/g, "-");
    const folder = record.file !== undefined ? path.dirname(record.file) : path.join(root, "maps");
    const target = path.join(folder, safeName);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);

    if (record.file !== undefined) {
      const text = await readFile(record.file, "utf8");
      const document = parseDocument(text);
      const prefix = record.index !== undefined ? [record.index] : [];
      const images = document.getIn([...prefix, "images"]) as YAMLSeq<unknown> | undefined;
      const entry = { file: safeName };
      if (images !== undefined && isSeq(images as YAMLSeq<unknown>)) {
        images.add(entry);
      } else {
        document.setIn([...prefix, "images"], [entry]);
      }
      await writeFile(record.file, documentText(document), "utf8");
    }
    return { ok: true, message: `saved ${target}` };
  }
  return { ok: false, message: `no map called "${mapId}"` };
}
