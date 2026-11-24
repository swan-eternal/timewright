import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createEditorApi } from "../src/cli/commands/edit.js";

/**
 * The Studio, driven the way a creator drives it: read the world, make a
 * map, put a place on it, put an event at the place, read the world at a
 * day, rename the place, and build the site.
 */
async function world(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "timewright-smoke-"));
  await mkdir(path.join(root, "maps"), { recursive: true });
  await mkdir(path.join(root, "locations"), { recursive: true });
  await mkdir(path.join(root, "events"), { recursive: true });
  await writeFile(path.join(root, "world.yaml"), "title: Smoke\nstart: 1800\nend: 1900\n", "utf8");
  return root;
}

function get(): IncomingMessage {
  return { method: "GET", headers: {} } as unknown as IncomingMessage;
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

function capture(): { response: ServerResponse; text: () => string; json: () => any } {
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
  return {
    response,
    text: () => body,
    json: () => JSON.parse(body) as any,
  };
}

/** Ask the Studio something, and read what it says. */
async function ask(
  root: string,
  url: string,
  body?: unknown,
  query?: URLSearchParams,
): Promise<{ text: string; json: () => any }> {
  const { response, text, json } = capture();
  await createEditorApi(root)(
    body !== undefined ? post(body) : get(),
    response,
    url,
    query ?? new URLSearchParams(),
  );
  return { text: text(), json };
}

describe("the Studio, end to end", () => {
  it("takes a creator from an empty world to a built site", async () => {
    const root = await world();

    // The world as the Studio sees it.
    const first = await ask(root, "/api/editor");
    const data = first.json();
    assert.equal(data.world.title, "Smoke");
    assert.equal(data.activeDate, "1800");
    assert.deepEqual(data.timeline.events, []);

    // A map, with the placeholder the Studio draws for it.
    const map = (
      await ask(root, "/api/create", {
        kind: "map",
        record: { name: "The Region", size: [400, 300], createPlaceholder: true },
      })
    ).json();
    assert.equal(map.ok, true);

    // A place on that map.
    const place = (
      await ask(root, "/api/create", {
        kind: "location",
        record: { name: "Waterloo", map: map.id, at: [10, 20] },
      })
    ).json();
    assert.equal(place.ok, true);

    // An event at that place.
    const event = (
      await ask(root, "/api/create", {
        kind: "event",
        record: { title: "The battle", when: "1815", where: "Waterloo" },
      })
    ).json();
    assert.equal(event.ok, true);

    // The world again: the place sits on its map, and counts its event.
    const after = (await ask(root, "/api/editor")).json();
    const located = after.locations.find((l: { id: string }) => l.id === place.id);
    assert.equal(located.map, map.id);
    assert.deepEqual(located.eventIds, [event.id]);
    assert.equal(after.maps.find((m: { id: string }) => m.id === map.id).placeholder, true);

    // The world at a day: the date is honoured, and the event is marked.
    const dated = (
      await ask(root, "/api/editor", undefined, new URLSearchParams("date=1815"))
    ).json();
    assert.equal(dated.activeDate, "1815");
    assert.equal(dated.timeline.events.find((e: { title: string }) => e.title === "The battle").current, true);

    // A period event: created with an until, kept end to end, and marked
    // current while the Studio's clock is inside the span.
    const war = (
      await ask(root, "/api/create", {
        kind: "event",
        record: { title: "The Peninsular War", when: "1807", until: "1814" },
      })
    ).json();
    assert.equal(war.ok, true, war.message);

    const withWar = (await ask(root, "/api/editor")).json();
    const savedWar = withWar.events.find((e: { title: string }) => e.title === "The Peninsular War");
    assert.equal(savedWar.until, "1814");

    const midWar = (
      await ask(root, "/api/editor", undefined, new URLSearchParams("date=1810"))
    ).json();
    assert.equal(
      midWar.timeline.events.find((e: { title: string }) => e.title === "The Peninsular War").current,
      true,
    );
    assert.equal(
      midWar.timeline.events.find((e: { title: string }) => e.title === "The battle").current,
      false,
    );

    // Renaming the place: the file moves with it, and its comments stay.
    const renameTarget = after.locations.find((l: { id: string }) => l.id === place.id);
    const renamed = (
      await ask(root, "/api/record", {
        kind: "location",
        file: renameTarget.file,
        index: renameTarget.index,
        values: { name: "Waterloo Field" },
      })
    ).json();
    assert.equal(renamed.ok, true);
    assert.match(renamed.file, /waterloo-field/);
    const moved = await readFile(renamed.file, "utf8");
    assert.match(moved, /name: Waterloo Field/);

    // The preview is a whole site, with the world's data before the viewer.
    const preview = await ask(root, "/api/preview");
    const dataAt = preview.text.indexOf('id="world-data"');
    const viewerAt = preview.text.indexOf("<script>", preview.text.indexOf("</script>", dataAt));
    assert.ok(dataAt > -1, "the world should be in the page");
    assert.ok(viewerAt > dataAt, "the viewer should come after the world's data");

    // And the site builds to disk.
    const built = (
      await ask(root, "/api/build-disk", { base: "./" })
    ).json();
    assert.equal(built.ok, true, built.message);
  });

  it("carries the references that pointed at a renamed place", async () => {
    const root = await world();
    const map = (
      await ask(root, "/api/create", {
        kind: "map",
        record: { name: "The Region", size: [400, 300], createPlaceholder: true },
      })
    ).json();
    const place = (
      await ask(root, "/api/create", {
        kind: "location",
        record: { name: "Waterloo", map: map.id, at: [10, 20] },
      })
    ).json();
    const event = (
      await ask(root, "/api/create", {
        kind: "event",
        record: { title: "The battle", when: "1815", where: "Waterloo" },
      })
    ).json();

    // The place, as the Studio sees it.
    const before = (await ask(root, "/api/editor")).json();
    const target = before.locations.find((l: { id: string }) => l.id === place.id);

    // Rename it.
    const renamed = (
      await ask(root, "/api/record", {
        kind: "location",
        file: target.file,
        index: target.index,
        values: { name: "Waterloo Field" },
      })
    ).json();
    assert.equal(renamed.ok, true, renamed.message);

    // The event still points at the place, and the place still counts it.
    const after = (await ask(root, "/api/editor")).json();
    const located = after.locations.find((l: { id: string }) => l.id === place.id);
    assert.equal(located.name, "Waterloo Field");
    assert.deepEqual(located.eventIds, [event.id]);

    // And the file on disk says so.
    const written = await readFile(path.join(root, "events", `${event.id}.yaml`), "utf8");
    assert.match(written, /where: Waterloo Field/);
  });

  it("keeps the world's own spelling when it reads a name", async () => {
    const root = await world();
    await ask(root, "/api/create", {
      kind: "map",
      record: { name: "The Region", size: [400, 300], createPlaceholder: true },
    });
    await ask(root, "/api/create", {
      kind: "location",
      record: { name: "Waterloo", map: "the-region", at: [10, 20] },
    });
    const data = (await ask(root, "/api/editor")).json();
    const located = data.locations.find((l: { name: string }) => l.name === "Waterloo");
    // The place was written with the map's slug; it resolves either way.
    assert.equal(located.map, "the-region");
    assert.equal(located.visibleAtDate, true);
  });

  it("answers for a world it cannot read, without throwing", async () => {
    const root = await world();
    await writeFile(path.join(root, "world.yaml"), "title: [not a map\n", "utf8");
    const data = (await ask(root, "/api/editor")).json();
    assert.ok(Array.isArray(data.issues));
    assert.ok(data.issues.length > 0, "a broken world should say so");
  });
});
