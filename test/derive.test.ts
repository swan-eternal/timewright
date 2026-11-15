import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadWorld } from "../src/cli/load.js";
import { eventPlace, imageForDate, locationVisibleAt, mapChain, resolveWorld, sortedEvents } from "../src/core/derive.js";
import { parseDate } from "../src/core/dates.js";
import type { ResolvedMap } from "../src/core/model.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
}

function mapWithImages(): ResolvedMap {
  return {
    id: "europe",
    name: "Europe",
    images: [
      { file: "a.png", from: parseDate("1800"), until: parseDate("1812") },
      { file: "b.png", from: parseDate("1812") },
    ],
  };
}

describe("imageForDate", () => {
  it("uses the image that covers the date", () => {
    assert.equal(imageForDate(mapWithImages(), parseDate("1800"))?.file, "a.png");
    assert.equal(imageForDate(mapWithImages(), parseDate("1811"))?.file, "a.png");
    assert.equal(imageForDate(mapWithImages(), parseDate("1815"))?.file, "b.png");
  });

  it("treats both ends of a range as inclusive", () => {
    assert.equal(imageForDate(mapWithImages(), parseDate("1812"))?.file, "b.png");
    const single = {
      id: "one",
      name: "One",
      images: [{ file: "only.png", from: parseDate("1900"), until: parseDate("1900") }],
    };
    assert.equal(imageForDate(single, parseDate("1900"))?.file, "only.png");
  });

  it("falls back to the nearest earlier image", () => {
    assert.equal(imageForDate(mapWithImages(), parseDate("1850"))?.file, "b.png");
  });

  it("falls back to the earliest image before everything else", () => {
    assert.equal(imageForDate(mapWithImages(), parseDate("1700"))?.file, "a.png");
  });
});

describe("locationVisibleAt", () => {
  const location = {
    id: "london",
    name: "London",
    aliases: [],
    tags: [],
    stays: [],
    exists: { from: parseDate("1800"), until: parseDate("1900") },
  };

  it("includes both ends of the range", () => {
    assert.equal(locationVisibleAt(location, parseDate("1800")), true);
    assert.equal(locationVisibleAt(location, parseDate("1900")), true);
    assert.equal(locationVisibleAt(location, parseDate("1799")), false);
    assert.equal(locationVisibleAt(location, parseDate("1901")), false);
  });
});

describe("resolveWorld", () => {
  it("resolves the fixture world", async () => {
    const loaded = await loadWorld(fixture("napoleon-world"));
    const world = resolveWorld(loaded.data);
    assert.equal(world.title, "Napoleonic Europe");
    assert.equal(world.overworld, "europe");
    assert.equal(world.maps.length, 2);

    const waterloo = world.events.find((event) => event.title === "Battle of Waterloo");
    assert.ok(waterloo !== undefined);
    assert.deepEqual(waterloo.people, ["napoleon-bonaparte"]);
    assert.equal(waterloo.where?.location, "waterloo");

    const treaty = world.events.find((event) => event.title === "Treaty of Amiens");
    assert.ok(treaty !== undefined);
    assert.equal(treaty.where?.map, "europe");
  });

  it("puts an event in the place its location sits", async () => {
    const loaded = await loadWorld(fixture("napoleon-world"));
    const world = resolveWorld(loaded.data);
    const waterloo = world.events.find((event) => event.title === "Battle of Waterloo");
    assert.ok(waterloo !== undefined);
    const place = eventPlace(world, waterloo);
    assert.equal(place?.mapId, "europe");
    assert.deepEqual(place?.at, [25, 18]);
  });

  it("sorts events by date", async () => {
    const loaded = await loadWorld(fixture("napoleon-world"));
    const world = resolveWorld(loaded.data);
    const titles = sortedEvents(world).map((event) => event.title);
    assert.deepEqual(titles, ["The Great Schism", "Treaty of Amiens", "Battle of Waterloo"]);
  });

  it("builds the map chain for the breadcrumb", async () => {
    const loaded = await loadWorld(fixture("napoleon-world"));
    const world = resolveWorld(loaded.data);
    assert.deepEqual(
      mapChain(world, "london").map((map) => map.id),
      ["europe", "london"],
    );
  });
});
