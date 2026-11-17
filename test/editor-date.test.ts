import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createEditorApi } from "../src/cli/commands/edit.js";

/**
 * A world that answers the questions a date-aware Studio has to ask:
 * two map images for two eras, a vessel that stays at a harbour, a place
 * that does not exist yet, and a person who is aboard the vessel.
 */
async function world(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "timewright-date-"));
  await mkdir(path.join(root, "maps"), { recursive: true });
  await mkdir(path.join(root, "people"), { recursive: true });
  await mkdir(path.join(root, "locations"), { recursive: true });
  await mkdir(path.join(root, "events"), { recursive: true });
  await writeFile(
    path.join(root, "world.yaml"),
    "title: T\noverworld: region\nstart: 1800\nend: 1900\n",
  );
  await writeFile(
    path.join(root, "maps", "m.yaml"),
    [
      "- id: region",
      "  name: Region",
      "  size: [40,30]",
      "  images:",
      "    - file: early.png",
      "      until: 1850",
      "    - file: late.png",
      "      from: 1850",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "locations", "locations.yaml"),
    [
      "- name: Harbour",
      "  map: region",
      "  at: [4,4]",
      "",
      "- name: Garden",
      "  map: region",
      "  at: [8,8]",
      "  exists:",
      "    from: 1870",
      "    until: 1890",
      "",
      "- name: Larkspur",
      "  kind: mobile",
      "  stays:",
      "    - { at: Harbour, from: 1800, until: 1900 }",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "people", "people.yaml"),
    "- name: Ada\n  stays:\n    - { at: Larkspur, from: 1800, until: 1900 }\n",
  );
  await writeFile(
    path.join(root, "events", "events.yaml"),
    [
      '- title: Arrival',
      '  when: "1815"',
      "  where: Harbour",
      "",
      "- title: A quiet year",
      '  when: "1880"',
      "",
    ].join("\n"),
  );
  return root;
}

function get(): IncomingMessage {
  return { method: "GET", headers: {} } as unknown as IncomingMessage;
}

function capture(): { response: ServerResponse; json: () => any } {
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
  return { response, json: () => JSON.parse(body) as any };
}

async function editor(root: string, date?: string): Promise<any> {
  const { response, json } = capture();
  const query = new URLSearchParams(date !== undefined ? `date=${encodeURIComponent(date)}` : "");
  await createEditorApi(root)(get(), response, "/api/editor", query);
  return json();
}

describe("the editor's date", () => {
  it("starts at the world's beginning when no date is asked for", async () => {
    const data = await editor(await world());
    assert.equal(data.activeDate, "1800");
  });

  it("takes the date it is given", async () => {
    const data = await editor(await world(), "1855");
    assert.equal(data.activeDate, "1855");
  });

  it("says so when the date it is given makes no sense", async () => {
    const data = await editor(await world(), "not-a-date");
    assert.equal(data.activeDate, "1800");
    assert.match(data.warnings.map((w: { message: string }) => w.message).join(" "), /not a date/);
  });

  it("picks the map image that covers the date", async () => {
    const root = await world();
    assert.equal((await editor(root, "1840")).maps[0].activeImage, "early.png");
    assert.equal((await editor(root, "1860")).maps[0].activeImage, "late.png");
  });

  it("says where a vessel is and what is hosting it", async () => {
    const data = await editor(await world(), "1855");
    const vessel = data.locations.find((l: { name: string }) => l.name === "Larkspur");
    assert.equal(vessel.resolvedMap, "region");
    assert.deepEqual(vessel.resolvedAt, [4, 4]);
    assert.equal(vessel.hostLocationName, "Harbour");
  });

  it("knows a place that does not exist yet", async () => {
    const root = await world();
    assert.equal(
      (await editor(root, "1855")).locations.find((l: { name: string }) => l.name === "Garden")
        .visibleAtDate,
      false,
    );
    assert.equal(
      (await editor(root, "1880")).locations.find((l: { name: string }) => l.name === "Garden")
        .visibleAtDate,
      true,
    );
  });

  it("lists the events that happen at a place", async () => {
    const data = await editor(await world(), "1855");
    const harbour = data.locations.find((l: { name: string }) => l.name === "Harbour");
    assert.equal(harbour.eventIds.length, 1);
    const arrival = data.events.find((e: { title: string }) => e.title === "Arrival");
    assert.deepEqual(harbour.eventIds, [arrival.id]);
  });

  it("says where a person is, through the vessel they are aboard", async () => {
    const data = await editor(await world(), "1855");
    assert.equal(data.people[0].activeLocationId, "harbour");
  });

  it("lays the events out along a strip of time", async () => {
    const data = await editor(await world(), "1855");
    assert.equal(data.timeline.start, "1800");
    assert.equal(data.timeline.end, "1900");
    assert.equal(data.timeline.events.length, 2);
    const arrival = data.timeline.events.find((e: { title: string }) => e.title === "Arrival");
    assert.equal(arrival.whereMode, "location");
    assert.ok(arrival.fraction >= 0 && arrival.fraction <= 1);
    const quiet = data.timeline.events.find((e: { title: string }) => e.title === "A quiet year");
    assert.equal(quiet.whereMode, "general");
    assert.ok(quiet.fraction > arrival.fraction);
  });

  it("marks the events that happen on the day being looked at", async () => {
    const data = await editor(await world(), "1815");
    const arrival = data.timeline.events.find((e: { title: string }) => e.title === "Arrival");
    const quiet = data.timeline.events.find((e: { title: string }) => e.title === "A quiet year");
    assert.equal(arrival.current, true);
    assert.equal(quiet.current, false);
  });

  it("answers a playhead dragged along the strip", async () => {
    const root = await world();
    const { response, json } = capture();
    await createEditorApi(root)(get(), response, "/api/editor", new URLSearchParams("fraction=0.5"));
    const data = json();
    assert.equal(data.activeDate, "1850");
    assert.ok(Math.abs(data.timeline.activeFraction - 0.5) < 0.02);
  });

  it("lays out the route of a vessel", async () => {
    const data = await editor(await world(), "1855");
    const vessel = data.locations.find((l: { name: string }) => l.name === "Larkspur");
    assert.equal(vessel.routes.length, 1);
    assert.equal(vessel.routes[0].name, "Harbour");
    assert.equal(vessel.routes[0].map, "region");
    assert.deepEqual(vessel.routes[0].mapAt, [4, 4]);
  });

  it("counts the events at a place the way the Viewer counts them", async () => {
    const root = await world();
    const data = await editor(root, "1855");
    const harbour = data.locations.find((l: { name: string }) => l.name === "Harbour");
    assert.deepEqual(harbour.eventIds, [
      data.events.find((e: { title: string }) => e.title === "Arrival").id,
    ]);
  });
});
