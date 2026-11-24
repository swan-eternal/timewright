import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadWorld } from "../src/cli/load.js";
import { resolveWorld } from "../src/core/derive.js";
import { parseDate } from "../src/core/dates.js";
import {
  spanSteps,
  stepAt,
  stepIndex,
  tracePath,
  traceStart,
  traceSteps,
  traceable,
  viewSteps,
} from "../src/core/steps.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
}

async function world() {
  const loaded = await loadWorld(fixture("napoleon-world"));
  return resolveWorld(loaded.data);
}

async function layersWorld() {
  const loaded = await loadWorld(fixture("layers-world"));
  return resolveWorld(loaded.data);
}

describe("character layers", () => {
  const span = { from: parseDate("1800"), to: parseDate("1830") };

  it("hides a hidden character's events and keeps shared and world events", async () => {
    const resolved = await layersWorld();
    const steps = viewSteps(resolved, {
      mode: "span",
      span,
      layers: { hiddenPeople: ["ana"], worldEvents: true },
    });
    assert.deepEqual(
      steps.map((step) => step.label),
      ["Ana and Bol", "Nobody's event"],
    );
  });

  it("hides the events with no characters when world events are off", async () => {
    const resolved = await layersWorld();
    const steps = viewSteps(resolved, {
      mode: "span",
      span,
      layers: { hiddenPeople: [], worldEvents: false },
    });
    assert.deepEqual(
      steps.map((step) => step.label),
      ["Ana alone", "Ana and Bol"],
    );
  });

  it("shows everything when no layers are set", async () => {
    const resolved = await layersWorld();
    const steps = viewSteps(resolved, { mode: "span", span });
    assert.deepEqual(
      steps.map((step) => step.label),
      ["Ana alone", "Ana and Bol", "Nobody's event"],
    );
  });

  it("walks the traced person whatever the layers say", async () => {
    const resolved = await layersWorld();
    const steps = viewSteps(resolved, {
      mode: "trace",
      traceId: "ana",
      layers: { hiddenPeople: ["ana"], worldEvents: false },
    });
    assert.deepEqual(
      steps.map((step) => step.label),
      ["Ana alone", "Ana and Bol"],
    );
  });
});

describe("trace start", () => {
  it("is the first point of the path, wherever the path begins", async () => {
    const resolved = await world();
    for (const entry of traceable(resolved)) {
      assert.deepEqual(traceStart(resolved, entry.id), tracePath(resolved, entry.id)[0]?.date);
    }
  });

  it("is nothing when there is no placed point at all", async () => {
    const resolved = await world();
    assert.equal(traceStart(resolved, "never-placed-anywhere"), undefined);
  });
});

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

describe("the steps the reader walks", () => {
  it("lists the events in the span, and keeps the ones with no place", async () => {
    const resolved = await world();
    const steps = viewSteps(resolved, {
      mode: "span",
      span: { from: parseDate("1800"), to: parseDate("1820") },
    });
    // The Great Schism (1054) has no place, so it stays on the timeline
    // even though the span does not reach it.
    assert.ok(steps.some((step) => step.label === "The Great Schism"));
    assert.ok(steps.some((step) => step.label === "Battle of Waterloo"));
  });

  it("walks one person's steps in trace mode", async () => {
    const resolved = await world();
    const steps = viewSteps(resolved, { mode: "trace", traceId: "napoleon-bonaparte" });
    assert.deepEqual(
      steps.map((step) => step.label),
      ["Arrived at Elba", "Left Elba", "Battle of Waterloo"],
    );
  });

  it("filters by the search text", async () => {
    const resolved = await world();
    const steps = viewSteps(resolved, {
      mode: "span",
      span: { from: parseDate("1800"), to: parseDate("1820") },
      query: "waterloo",
    });
    assert.deepEqual(
      steps.map((step) => step.label),
      ["Battle of Waterloo"],
    );
  });

  it("filters by tags", async () => {
    const resolved = await world();
    const steps = viewSteps(resolved, {
      mode: "span",
      span: { from: parseDate("1800"), to: parseDate("1820") },
      tags: ["battle"],
    });
    assert.deepEqual(
      steps.map((step) => step.label),
      ["Battle of Waterloo"],
    );
  });

  it("finds the step a date belongs to", async () => {
    const resolved = await world();
    const steps = viewSteps(resolved, {
      mode: "span",
      span: { from: parseDate("1800"), to: parseDate("1820") },
    });
    assert.equal(stepIndex(steps, parseDate("1800")), 0);
    assert.equal(stepIndex(steps, parseDate("1700")), 0);
    assert.equal(stepIndex(steps, parseDate("1900")), steps.length - 1);
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
