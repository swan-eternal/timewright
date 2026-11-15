import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadWorld } from "../src/cli/load.js";
import { resolveWorld } from "../src/core/derive.js";
import { parseDate } from "../src/core/dates.js";
import { dateFraction, dateValue, domainLabel, eventDomain, fractionDate } from "../src/core/scale.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
}

async function worldWithoutOverrides() {
  const loaded = await loadWorld(fixture("napoleon-world"));
  const resolved = resolveWorld(loaded.data);
  resolved.start = undefined;
  resolved.end = undefined;
  return resolved;
}

describe("the timeline domain", () => {
  it("covers the years that have a place on the map", async () => {
    const world = await worldWithoutOverrides();
    const domain = eventDomain(world);
    assert.ok(domain !== undefined);
    // The Great Schism (1054) has no place, so it does not widen the axis.
    assert.equal(domain.from.year, 1802);
    assert.equal(domain.to.year, 1815);
  });

  it("lets the creator's start and end override the events", async () => {
    const loaded = await loadWorld(fixture("napoleon-world"));
    const world = resolveWorld(loaded.data);
    world.start = parseDate("1750");
    world.end = parseDate("1900");
    const domain = eventDomain(world);
    assert.equal(domain?.from.year, 1750);
    assert.equal(domain?.to.year, 1900);
  });

  it("includes unplaced events when asked", async () => {
    const world = await worldWithoutOverrides();
    const domain = eventDomain(world, { includeUnplaced: true });
    assert.equal(domain?.from.year, 1054);
  });

  it("falls back to every event when nothing has a place", async () => {
    const world = await worldWithoutOverrides();
    for (const event of world.events) {
      event.where = undefined;
    }
    const domain = eventDomain(world);
    assert.equal(domain?.from.year, 1054);
  });

  it("has no domain at all when there are no events", async () => {
    const loaded = await loadWorld(fixture("napoleon-world"));
    const world = resolveWorld(loaded.data);
    world.events = [];
    assert.equal(eventDomain(world), undefined);
  });
});

describe("mapping dates onto the axis", () => {
  const domain = { from: parseDate("1800"), to: parseDate("1900") };

  it("puts a year in the right place", () => {
    assert.equal(dateFraction(parseDate("1800"), domain), 0);
    assert.equal(dateFraction(parseDate("1900"), domain), 1);
    assert.equal(dateFraction(parseDate("1850"), domain), 0.5);
  });

  it("clamps dates outside the axis", () => {
    assert.equal(dateFraction(parseDate("1700"), domain), 0);
    assert.equal(dateFraction(parseDate("2000"), domain), 1);
  });

  it("survives a domain with no width", () => {
    const single = { from: parseDate("1800"), to: parseDate("1800") };
    assert.equal(dateFraction(parseDate("1800"), single), 0.5);
  });

  it("round-trips a fraction back to a date", () => {
    const back = fractionDate(dateFraction(parseDate("1850"), domain), domain);
    assert.equal(back.year, 1850);
  });

  it("counts months and days as fractions of a year", () => {
    assert.equal(dateValue(parseDate("1850-07-01")) > dateValue(parseDate("1850")), true);
  });

  it("labels the ends of the axis", () => {
    assert.equal(domainLabel(domain), "1800 – 1900");
  });
});
