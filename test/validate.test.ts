import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EventRecord, LocationRecord, MapRecord, PersonRecord, WorldRecord } from "../src/core/schema.js";
import { validateWorld, type WorldData } from "../src/core/validate.js";

function world(overrides: Partial<WorldData> = {}): WorldData {
  const base: WorldData = {
    world: { data: { title: "Test world" } as WorldRecord },
    maps: [{ data: { id: "europe", name: "Europe" } as MapRecord, file: "maps/europe.yaml" }],
    people: [],
    locations: [],
    events: [],
  };
  return { ...base, ...overrides };
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("validateWorld", () => {
  it("says nothing about a world with nothing in it", () => {
    const issues = validateWorld(world());
    assert.deepEqual(codes(issues), ["map-without-image"]);
  });

  it("reports an unknown person with a suggestion", () => {
    const issues = validateWorld(
      world({
        people: [{ data: { name: "Napoleon Bonaparte" } as PersonRecord }],
        events: [
          {
            data: { title: "Waterloo", when: "1815-06-18", people: ["Napolon"] } as EventRecord,
            file: "events/events.yaml",
          },
        ],
      }),
    );
    const issue = issues.find((entry) => entry.code === "unknown-reference");
    assert.ok(issue !== undefined);
    assert.equal(issue.severity, "error");
    assert.match(issue.suggestion ?? "", /Napoleon Bonaparte/);
  });

  it("treats an event with an unknown place as needing placement, not as broken", () => {
    const issues = validateWorld(
      world({
        events: [
          {
            data: { title: "Arrival", when: "1815", where: "Atlantis" } as EventRecord,
            file: "events/events.yaml",
          },
        ],
      }),
    );
    const issue = issues.find((entry) => entry.code === "needs-placing");
    assert.ok(issue !== undefined);
    assert.equal(issue.severity, "warning");
  });

  it("catches an event pointing at a map instead of a location", () => {
    const issues = validateWorld(
      world({
        events: [
          {
            data: { title: "Arrival", when: "1815", where: "europe" } as EventRecord,
            file: "events/events.yaml",
          },
        ],
      }),
    );
    assert.ok(codes(issues).includes("where-is-a-map"));
  });

  it("catches two records with the same id", () => {
    const issues = validateWorld(
      world({
        people: [
          { data: { id: "napoleon", name: "Napoleon Bonaparte" } as PersonRecord },
          { data: { id: "napoleon", name: "Napoleon II" } as PersonRecord },
        ],
      }),
    );
    assert.ok(codes(issues).includes("duplicate-id"));
  });

  it("warns about a mobile location with a fixed position", () => {
    const issues = validateWorld(
      world({
        locations: [
          {
            data: { name: "Infinity", kind: "mobile", at: [1, 2] } as LocationRecord,
            file: "locations/locations.yaml",
          },
        ],
      }),
    );
    assert.ok(codes(issues).includes("mobile-with-position"));
  });

  it("warns about a mobile location that never moves", () => {
    const issues = validateWorld(
      world({
        locations: [
          { data: { name: "Infinity", kind: "mobile" } as LocationRecord },
        ],
      }),
    );
    assert.ok(codes(issues).includes("mobile-without-stays"));
  });

  it("warns about a location with no position", () => {
    const issues = validateWorld(
      world({
        locations: [
          { data: { name: "London", map: "europe" } as LocationRecord },
        ],
      }),
    );
    assert.ok(codes(issues).includes("needs-placing"));
  });

  it("warns about an unknown field and suggests the right one", () => {
    const issues = validateWorld(
      world({
        people: [
          { data: { name: "Napoleon", bith: "1769" } as unknown as PersonRecord },
        ],
      }),
    );
    const issue = issues.find((entry) => entry.code === "unknown-field");
    assert.ok(issue !== undefined);
    assert.equal(issue.severity, "warning");
    assert.match(issue.suggestion ?? "", /born/);
  });

  it("reports a date it cannot read", () => {
    const issues = validateWorld(
      world({
        events: [
          {
            data: { title: "Vague", when: "sometime" } as unknown as EventRecord,
            file: "events/events.yaml",
          },
        ],
      }),
    );
    assert.ok(codes(issues).includes("invalid-date"));
  });

  it("promotes warnings to errors in strict mode", () => {
    const strict = validateWorld(world(), { strict: true });
    assert.ok(strict.every((issue) => issue.severity === "error"));
  });
});

describe("the format declaration", () => {
  it("accepts the format it reads", () => {
    const issues = validateWorld(world({ world: { data: { title: "Test world", format: 1 } as WorldRecord } }));
    assert.deepEqual(issues.filter((issue) => issue.field === "format"), []);
  });

  it("reads the version as a string too", () => {
    const issues = validateWorld(world({ world: { data: { title: "Test world", format: "1.0" } as WorldRecord } }));
    assert.deepEqual(issues.filter((issue) => issue.field === "format"), []);
  });

  it("says nothing when the field is absent", () => {
    const issues = validateWorld(world());
    assert.deepEqual(issues.filter((issue) => issue.field === "format"), []);
  });

  it("refuses a declaration it cannot read", () => {
    const issues = validateWorld(world({ world: { data: { title: "Test world", format: "one" } as WorldRecord } }));
    const issue = issues.find((entry) => entry.code === "invalid-format");
    assert.ok(issue !== undefined);
    assert.equal(issue.severity, "error");
  });

  it("refuses a format from a newer timewright", () => {
    const issues = validateWorld(world({ world: { data: { title: "Test world", format: 2 } as WorldRecord } }));
    const issue = issues.find((entry) => entry.code === "unknown-format-major");
    assert.ok(issue !== undefined);
    assert.equal(issue.severity, "error");
    assert.match(issue.message, /format 2/);
  });

  it("warns about a newer minor version", () => {
    const issues = validateWorld(world({ world: { data: { title: "Test world", format: "1.2" } as WorldRecord } }));
    const issue = issues.find((entry) => entry.code === "newer-format-minor");
    assert.ok(issue !== undefined);
    assert.equal(issue.severity, "warning");
  });
});
