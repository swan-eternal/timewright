import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadWorld } from "../src/cli/load.js";
import { resolveWorld } from "../src/core/derive.js";
import { eventDomain } from "../src/core/scale.js";
import { traceable, viewSteps } from "../src/core/steps.js";
import { validateWorld } from "../src/core/validate.js";

function example(name: string): string {
  return fileURLToPath(new URL(`../../examples/${name}`, import.meta.url));
}

/**
 * The examples are the real test of the data model. A world that validates
 * is a world the viewer can read.
 */
describe("the examples", () => {
  for (const name of ["napoleon", "revelation-space"]) {
    it(`${name} validates without a single error`, async () => {
      const loaded = await loadWorld(example(name));
      const issues = [...loaded.issues, ...validateWorld(loaded.data)];
      const errors = issues.filter((issue) => issue.severity === "error");
      assert.deepEqual(
        errors.map((issue) => `${issue.file}: ${issue.message}`),
        [],
      );
    });
  }

  it("revelation-space keeps everything the dataset had", async () => {
    const loaded = await loadWorld(example("revelation-space"));
    assert.equal(loaded.data.maps.length, 11);
    assert.equal(loaded.data.events.length, 16);
    // 61 nodes: 11 star systems, 33 places, 2 vessels and 15 people.
    assert.equal(loaded.data.locations.length, 46);
    assert.equal(loaded.data.people.length, 14);
  });

  it("gives every step its own identity", async () => {
    // Two steps sharing a key cannot be told apart, and the reader would
    // not be able to step back into the earlier of them.
    for (const name of ["napoleon", "revelation-space"]) {
      const loaded = await loadWorld(example(name));
      const world = resolveWorld(loaded.data);
      const domain = eventDomain(world);
      const span = domain !== undefined ? { from: domain.from, to: domain.to } : undefined;
      const lists = [viewSteps(world, { mode: "span", span })];
      for (const entry of traceable(world)) {
        lists.push(viewSteps(world, { mode: "trace", traceId: entry.id }));
      }
      for (const steps of lists) {
        const keys = steps.map((step) => step.key);
        assert.deepEqual(
          [...new Set(keys)].length,
          keys.length,
          `${name}: two steps share a key`,
        );
      }
    }
  });
});
