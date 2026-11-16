import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createEditorApi } from "../src/cli/commands/edit.js";
import { loadWorld } from "../src/cli/load.js";
import { validateWorld } from "../src/core/validate.js";

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "timewright-editor-api-"));
}

/** A world with one of everything, so the editor has something to edit. */
async function world(): Promise<string> {
  const root = await scratch();
  await mkdir(path.join(root, "maps"), { recursive: true });
  await mkdir(path.join(root, "people"), { recursive: true });
  await mkdir(path.join(root, "locations"), { recursive: true });
  await mkdir(path.join(root, "events"), { recursive: true });
  await writeFile(path.join(root, "world.yaml"), "title: T\n");
  await writeFile(path.join(root, "maps", "m.yaml"), "- id: m\n  name: M\n  size: [10,10]\n");
  await writeFile(path.join(root, "locations", "locations.yaml"), "- name: Rome\n  map: m\n  at: [1,1]\n");
  await writeFile(path.join(root, "people", "people.yaml"), "- name: Ada\n");
  await writeFile(
    path.join(root, "events", "events.yaml"),
    '- title: Battle\n  when: "1815"\n  where: Rome\n',
  );
  return root;
}

function post(body: unknown): IncomingMessage {
  const payload = Buffer.from(JSON.stringify(body));
  return {
    method: "POST",
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield payload;
    },
  } as unknown as IncomingMessage;
}

function capture(): { response: ServerResponse; json: () => { ok: boolean; message: string } } {
  let body = "";
  const response = {
    statusCode: 200,
    setHeader() {},
    end(chunk?: string) {
      if (chunk !== undefined) {
        body = chunk;
      }
    },
  } as unknown as ServerResponse;
  return { response, json: () => JSON.parse(body) as { ok: boolean; message: string } };
}

describe("the editor's API", () => {
  it("refuses to write a file outside the world", async () => {
    const root = await world();
    const outside = path.join(await scratch(), "outside.yaml");
    await writeFile(outside, "- name: Victim\n  value: keepme\n");

    const { response, json } = capture();
    await createEditorApi(root)(
      post({ kind: "person", file: outside, values: { name: "Pwned" } }),
      response,
      "/api/record",
    );

    assert.equal(json().ok, false);
    assert.match(json().message, /outside the world folder/);
    assert.equal(await readFile(outside, "utf8"), "- name: Victim\n  value: keepme\n");
  });

  it("refuses to write past the end of a list", async () => {
    const root = await world();
    const file = path.join(root, "people", "people.yaml");

    const { response, json } = capture();
    await createEditorApi(root)(
      post({ kind: "person", file, index: 99, values: { name: "Ghost" } }),
      response,
      "/api/record",
    );

    assert.equal(json().ok, false);
    assert.equal(await readFile(file, "utf8"), "- name: Ada\n");
  });

  it("takes a date away when it is cleared, rather than writing a broken one", async () => {
    const root = await world();
    const file = path.join(root, "people", "people.yaml");

    const { response, json } = capture();
    await createEditorApi(root)(
      post({
        kind: "person",
        file,
        index: 0,
        values: { name: "Ada", aliases: "", born: "", died: "", tags: "", bio: "A bio" },
      }),
      response,
      "/api/record",
    );

    assert.equal(json().ok, true);
    const text = await readFile(file, "utf8");
    // An empty date is gone, not written as "".
    assert.equal(/born:/.test(text), false);
    assert.equal(/died:/.test(text), false);
    // A person has a bio, not a card.
    assert.equal(/card:/.test(text), false);
    assert.match(text, /bio: A bio/);

    // And the world still builds: no broken date, no unknown field.
    const loaded = await loadWorld(root);
    const issues = validateWorld(loaded.data);
    assert.deepEqual(
      issues
        .filter((issue) => issue.code === "invalid-date" || issue.code === "unknown-field")
        .map((issue) => `${issue.severity}: ${issue.code}`),
      [],
    );
  });

  it("takes an event's place away when it is cleared", async () => {
    const root = await world();
    const file = path.join(root, "events", "events.yaml");

    const { response, json } = capture();
    await createEditorApi(root)(
      post({
        kind: "event",
        file,
        index: 0,
        values: { title: "Battle", when: "1815", where: "", people: "", tags: "", card: "" },
      }),
      response,
      "/api/record",
    );

    assert.equal(json().ok, true);
    const text = await readFile(file, "utf8");
    assert.equal(/where:/.test(text), false);
    assert.match(text, /title: Battle/);
  });

  it("says so when a required field is left empty", async () => {
    const root = await world();
    const file = path.join(root, "events", "events.yaml");

    const { response, json } = capture();
    await createEditorApi(root)(
      post({
        kind: "event",
        file,
        index: 0,
        values: { title: "", when: "1815", where: "", people: "", tags: "", card: "" },
      }),
      response,
      "/api/record",
    );

    assert.equal(json().ok, false);
    assert.match(json().message, /title/);
    assert.match(await readFile(file, "utf8"), /title: Battle/);
  });

  it("leaves a field alone when the page did not send it", async () => {
    const root = await world();
    const file = path.join(root, "events", "events.yaml");

    const { response, json } = capture();
    // An event whose place is a raw point on the map: the page has no
    // form for it, so it does not send it, and the point survives.
    await writeFile(file, '- title: Battle\n  when: "1815"\n  where:\n    map: m\n    at: [2,2]\n');
    await createEditorApi(root)(
      post({
        kind: "event",
        file,
        index: 0,
        values: { title: "Battle", when: "1815", people: "", tags: "", card: "" },
      }),
      response,
      "/api/record",
    );

    assert.equal(json().ok, true);
    // The raw point is still there, untouched.
    assert.match(await readFile(file, "utf8"), /at: \[ 2, 2 \]/);
  });
});
