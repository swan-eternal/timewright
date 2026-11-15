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
import { isSeq, parseDocument, stringify, type YAMLSeq } from "yaml";

import { slugify } from "../core/resolve.js";

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
  const text = await readFile(place.file, "utf8");
  const document = parseDocument(text);
  const prefix = place.index !== undefined ? [place.index] : [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    document.setIn([...prefix, key], value);
  }
  await writeFile(place.file, documentText(document), "utf8");

  // A record that lives in its own file should keep its file named after it.
  if (place.index === undefined) {
    const name = fields.name ?? fields.title;
    if (typeof name === "string" && name !== "") {
      const folder = path.dirname(place.file);
      if (folder === path.join(root, DIRECTORIES[kind])) {
        const wanted = `${slugify(name)}.yaml`;
        if (wanted !== path.basename(place.file)) {
          try {
            await rename(place.file, path.join(folder, wanted));
          } catch {
            // A rename is a nicety, not a requirement.
          }
        }
      }
    }
  }

  return { ok: true, message: `saved ${place.file}`, file: place.file };
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
  const resolved = path.resolve(place.file);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) {
    return { ok: false, message: "that file is outside the world folder" };
  }
  if (place.index === undefined) {
    await unlink(resolved);
    return { ok: true, message: `deleted ${resolved}` };
  }
  const text = await readFile(resolved, "utf8");
  const document = parseDocument(text);
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
  for (const source of loaded.data.locations) {
    const location = source.data;
    if ((location.id ?? location.name) !== id) {
      continue;
    }
    if (source.file === undefined) {
      return { ok: false, message: "that location has no file to write to" };
    }
    const text = await readFile(source.file, "utf8");
    const document = parseDocument(text);
    const prefix = source.index !== undefined ? [source.index] : [];
    document.setIn([...prefix, "at"], [Math.round(x), Math.round(y)]);
    document.setIn([...prefix, "map"], mapId);
    await writeFile(source.file, documentText(document), "utf8");
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
  for (const source of loaded.data.maps) {
    const map = source.data;
    if ((map.id ?? map.name) !== mapId) {
      continue;
    }
    const safeName = path.basename(fileName).replace(/[^\w.\-]+/g, "-");
    const folder = source.file !== undefined ? path.dirname(source.file) : path.join(root, "maps");
    const target = path.join(folder, safeName);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);

    if (source.file !== undefined) {
      const text = await readFile(source.file, "utf8");
      const document = parseDocument(text);
      const prefix = source.index !== undefined ? [source.index] : [];
      const images = document.getIn([...prefix, "images"]) as YAMLSeq<unknown> | undefined;
      const entry = { file: safeName };
      if (images !== undefined && isSeq(images as YAMLSeq<unknown>)) {
        images.add(entry);
      } else {
        document.setIn([...prefix, "images"], [entry]);
      }
      await writeFile(source.file, documentText(document), "utf8");
    }
    return { ok: true, message: `saved ${target}` };
  }
  return { ok: false, message: `no map called "${mapId}"` };
}
