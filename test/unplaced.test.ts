import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadWorld } from "../src/cli/load.js";
import { resolveWorld } from "../src/core/derive.js";
import { parseDate } from "../src/core/dates.js";
import { eventDomain } from "../src/core/scale.js";
import { spanSteps, unplacedEvents } from "../src/core/steps.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
}

async function unplacedWorld() {
  const loaded = await loadWorld(fixture("unplaced-world"));
  return resolveWorld(loaded.data);
}

/**
 * A location can name a map before it has been given coordinates. An event
 * there belongs to the story, but there is nothing to draw, so it must not
 * stretch the strip - and it must not disappear either.
 */
describe("an event at a place with no coordinates", () => {
  it("does not widen the timeline", async () => {
    const world = await unplacedWorld();
    const domain = eventDomain(world);
    // The ancient event is at an unplaced place, so the strip starts at 1000.
    assert.equal(domain?.from.year, 1000);
    assert.equal(domain?.to.year, 1800);
  });

  it("is pinned to the edge instead of vanishing", async () => {
    const world = await unplacedWorld();
    const unplaced = unplacedEvents(world);
    assert.equal(unplaced.length, 1);
    assert.equal(unplaced[0]?.title, "Ancient at an unplaced place");
  });

  it("is not in the steps of a span that does not reach it", async () => {
    const world = await unplacedWorld();
    const steps = spanSteps(world, { from: parseDate("1700"), to: parseDate("1900") });
    assert.deepEqual(steps.map((event) => event.title), ["A recent event"]);
  });
});
