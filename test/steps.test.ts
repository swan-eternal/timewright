import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadWorld } from "../src/cli/load.js";
import { resolveWorld } from "../src/core/derive.js";
import { parseDate } from "../src/core/dates.js";
import { spanSteps, stepAt, tracePath, traceSteps, traceable } from "../src/core/steps.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
}

async function world() {
  const loaded = await loadWorld(fixture("napoleon-world"));
  return resolveWorld(loaded.data);
}

describe("span steps", () => {
  it("keeps the events inside the span, both ends inclusive", async () => {
    const resolved = await world();
    const steps = spanSteps(resolved, { from: parseDate("1802-03-25"), to: parseDate("1815-06-18") });
    assert.deepEqual(
      steps.map((event) => event.title),
      ["Treaty of Amiens", "Battle of Waterloo"],
    );
  });

  it("leaves out the events outside the span", async () => {
    const resolved = await world();
    const steps = spanSteps(resolved, { from: parseDate("1900"), to: parseDate("2000") });
    assert.deepEqual(steps, []);
  });
});

describe("tracing a person", () => {
  it("lists their events and the boundaries of their stays", async () => {
    const resolved = await world();
    const steps = traceSteps(resolved, "napoleon-bonaparte");
    assert.deepEqual(
      steps.map((step) => `${step.kind}:${step.label}`),
      ["stay:Arrived at Elba", "stay:Left Elba", "event:Battle of Waterloo"],
    );
  });

  it("follows their path through time", async () => {
    const resolved = await world();
    const path = tracePath(resolved, "napoleon-bonaparte");
    assert.deepEqual(path.map((point) => point.at), [
      [15, 20],
      [15, 20],
      [25, 18],
    ]);
  });

  it("offers people and mobile locations to trace", async () => {
    const resolved = await world();
    const traceableIds = traceable(resolved).map((entry) => entry.id);
    assert.ok(traceableIds.includes("napoleon-bonaparte"));
    assert.ok(traceableIds.includes("nostalgia-for-infinity"));
  });

  it("finds the step a date belongs to", async () => {
    const resolved = await world();
    const steps = traceSteps(resolved, "napoleon-bonaparte");
    const step = stepAt(steps, parseDate("1815-01-01"));
    assert.equal(step?.kind, "stay");
  });
});
