import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDate, type ParsedDate } from "../src/core/dates.js";
import {
  anchorForMap,
  eventPlace,
  eventsAtPlace,
  landingPlace,
  placeMap,
  projectToMap,
  resolveLocationAt,
} from "../src/core/derive.js";
import type {
  ResolvedEvent,
  ResolvedLocation,
  ResolvedPerson,
  ResolvedWorld,
} from "../src/core/model.js";
import { fractionDate } from "../src/core/scale.js";
import { findStep, stepIndex, tracePath, traceSteps, viewSteps } from "../src/core/steps.js";

function location(
  partial: Partial<ResolvedLocation> & { id: string; name: string },
): ResolvedLocation {
  return {
    aliases: [],
    stays: [],
    tags: [],
    ...partial,
  };
}

function person(
  partial: Partial<ResolvedPerson> & { id: string; name: string },
): ResolvedPerson {
  return {
    aliases: [],
    stays: [],
    tags: [],
    ...partial,
  };
}

function event(
  partial: Partial<ResolvedEvent> & { id: string; title: string; when: ParsedDate },
): ResolvedEvent {
  return {
    people: [],
    locations: [],
    tags: [],
    ...partial,
  };
}

function world(partial: Partial<ResolvedWorld> = {}): ResolvedWorld {
  return {
    title: "Test",
    maps: [],
    locations: [],
    people: [],
    events: [],
    ...partial,
  };
}

/** A world with a ship, a planet it visits and a captain who rides it. */
function shipWorld(): ResolvedWorld {
  return world({
    locations: [
      location({ id: "resurgam", name: "Resurgam", map: "europe", at: [10, 10] }),
      location({ id: "mars", name: "Mars", map: "galaxy", at: [40, 20] }),
      location({
        id: "ship",
        name: "Nostalgia for Infinity",
        kind: "mobile",
        stays: [
          { at: "resurgam", from: parseDate("2560"), until: parseDate("2565") },
          { at: "mars", from: parseDate("2566"), until: parseDate("2570") },
        ],
      }),
    ],
    people: [
      person({
        id: "vance",
        name: "Marcus Vance",
        stays: [{ at: "ship", from: parseDate("2560"), until: parseDate("2570") }],
      }),
    ],
  });
}

describe("where a location is at a date", () => {
  const w = world({
    locations: [
      location({ id: "elba", name: "Elba", map: "europe", at: [15, 20] }),
      location({
        id: "ship",
        name: "Ship",
        kind: "mobile",
        stays: [{ at: "elba", from: parseDate("1814"), until: parseDate("1815") }],
      }),
    ],
  });

  it("answers a fixed location with its own map and position", () => {
    const resolved = resolveLocationAt(w, "elba", parseDate("1814"));
    assert.equal(resolved?.mapId, "europe");
    assert.deepEqual(resolved?.at, [15, 20]);
  });

  it("answers a mobile location with where it was at the time", () => {
    const resolved = resolveLocationAt(w, "ship", parseDate("1814-06-01"));
    assert.equal(resolved?.mapId, "europe");
    assert.deepEqual(resolved?.at, [15, 20]);
  });

  it("has no answer for a mobile location between its stays", () => {
    assert.equal(resolveLocationAt(w, "ship", parseDate("1820")), undefined);
  });

  it("treats both ends of a stay as inclusive", () => {
    assert.ok(resolveLocationAt(w, "ship", parseDate("1814")) !== undefined);
    assert.ok(resolveLocationAt(w, "ship", parseDate("1815")) !== undefined);
  });

  it("covers the whole year when a stay ends in a year", () => {
    // The stay ends in 1815, so the whole of 1815 is covered - not just
    // the first instant of it.
    const resolved = resolveLocationAt(w, "ship", parseDate("1815-06-18"));
    assert.equal(resolved?.mapId, "europe");
    assert.deepEqual(resolved?.at, [15, 20]);
  });

  it("does not cover the year after a stay ends in a year", () => {
    assert.equal(resolveLocationAt(w, "ship", parseDate("1816-01-01")), undefined);
  });

  it("falls back to the first stay when there is no date", () => {
    const resolved = resolveLocationAt(w, "ship");
    assert.equal(resolved?.mapId, "europe");
    assert.deepEqual(resolved?.at, [15, 20]);
  });

  it("has no answer for a location it does not know", () => {
    assert.equal(resolveLocationAt(w, "atlantis"), undefined);
  });

  it("has no answer for a fixed location with no position", () => {
    const bare = world({
      locations: [location({ id: "void", name: "Void", map: "europe" })],
    });
    assert.equal(resolveLocationAt(bare, "void"), undefined);
  });

  it("has no answer for a mobile location with no stays", () => {
    const drifting = world({
      locations: [location({ id: "drifter", name: "Drifter", kind: "mobile" })],
    });
    assert.equal(resolveLocationAt(drifting, "drifter", parseDate("1800")), undefined);
  });

  it("stops instead of looping when two mobile locations point at each other", () => {
    const cyclic = world({
      locations: [
        location({ id: "a", name: "A", kind: "mobile", stays: [{ at: "b" }] }),
        location({ id: "b", name: "B", kind: "mobile", stays: [{ at: "a" }] }),
      ],
    });
    assert.equal(resolveLocationAt(cyclic, "a", parseDate("1800")), undefined);
  });

  it("walks a chain of mobile locations down to a fixed one", () => {
    const chained = world({
      locations: [
        location({ id: "base", name: "Base", map: "europe", at: [1, 1] }),
        location({
          id: "mid",
          name: "Mid",
          kind: "mobile",
          stays: [{ at: "base", from: parseDate("1800"), until: parseDate("1900") }],
        }),
        location({
          id: "top",
          name: "Top",
          kind: "mobile",
          stays: [{ at: "mid", from: parseDate("1800"), until: parseDate("1900") }],
        }),
      ],
    });
    const resolved = resolveLocationAt(chained, "top", parseDate("1850"));
    assert.equal(resolved?.mapId, "europe");
    assert.deepEqual(resolved?.at, [1, 1]);
  });
});

describe("the anchor of a sub-map", () => {
  const london = location({
    id: "london",
    name: "London",
    map: "europe",
    at: [20, 15],
    opens: "london-map",
  });

  it("is the location that opens it", () => {
    const anchor = anchorForMap(world({ locations: [london] }), "london-map");
    assert.equal(anchor?.mapId, "europe");
    assert.deepEqual(anchor?.at, [20, 15]);
  });

  it("has no anchor for a map that nothing opens", () => {
    assert.equal(anchorForMap(world({ locations: [london] }), "europe"), undefined);
  });
});

describe("projecting a point onto another map", () => {
  const nested = world({
    locations: [
      location({ id: "london", name: "London", map: "europe", at: [20, 15], opens: "london-map" }),
      location({ id: "paris", name: "Paris", map: "london-map", at: [5, 5], opens: "paris-map" }),
    ],
  });

  it("leaves a point on its own map alone", () => {
    const projected = projectToMap(nested, "europe", [5, 5], "europe");
    assert.deepEqual(projected?.at, [5, 5]);
    assert.equal(projected?.viaLocation, undefined);
  });

  it("walks up one level to the anchor of a sub-map", () => {
    const projected = projectToMap(nested, "london-map", [3, 4], "europe");
    assert.deepEqual(projected?.at, [20, 15]);
    assert.equal(projected?.viaLocation?.id, "london");
  });

  it("walks up more than one level", () => {
    const projected = projectToMap(nested, "paris-map", [1, 1], "europe");
    assert.deepEqual(projected?.at, [20, 15]);
    assert.equal(projected?.viaLocation?.id, "london");
  });

  it("has no projection when nothing connects the maps", () => {
    assert.equal(projectToMap(nested, "paris-map", [1, 1], "atlantis"), undefined);
  });

  it("has no projection without a point", () => {
    assert.equal(projectToMap(nested, undefined, undefined, "europe"), undefined);
    assert.equal(projectToMap(nested, "europe", undefined, "europe"), undefined);
  });
});

describe("where an event happens", () => {
  it("puts an event at a fixed location on that location's map", () => {
    const w = world({
      locations: [location({ id: "elba", name: "Elba", map: "europe", at: [15, 20] })],
      events: [
        event({
          id: "e1",
          title: "Landing",
          when: parseDate("1814-06-18"),
          where: { location: "elba" },
        }),
      ],
    });
    const place = eventPlace(w, w.events[0]!);
    assert.equal(place?.mapId, "europe");
    assert.deepEqual(place?.at, [15, 20]);
  });

  it("puts an event at a mobile location where the vessel was at the time", () => {
    const w = world({
      locations: [
        location({ id: "elba", name: "Elba", map: "europe", at: [15, 20] }),
        location({ id: "paris", name: "Paris", map: "europe", at: [30, 30] }),
        location({
          id: "ship",
          name: "Ship",
          kind: "mobile",
          stays: [
            { at: "elba", from: parseDate("1814"), until: parseDate("1815") },
            { at: "paris", from: parseDate("1816"), until: parseDate("1817") },
          ],
        }),
      ],
      events: [
        event({
          id: "e1",
          title: "Boarding",
          when: parseDate("1814-06-18"),
          where: { location: "ship" },
        }),
        event({
          id: "e2",
          title: "Arrival",
          when: parseDate("1816-06-18"),
          where: { location: "ship" },
        }),
      ],
    });
    const first = eventPlace(w, w.events[0]!);
    assert.equal(first?.mapId, "europe");
    assert.deepEqual(first?.at, [15, 20]);

    const second = eventPlace(w, w.events[1]!);
    assert.deepEqual(second?.at, [30, 30]);
  });

  it("can be asked about a different date than the event's own", () => {
    const w = world({
      locations: [
        location({ id: "elba", name: "Elba", map: "europe", at: [15, 20] }),
        location({ id: "paris", name: "Paris", map: "europe", at: [30, 30] }),
        location({
          id: "ship",
          name: "Ship",
          kind: "mobile",
          stays: [
            { at: "elba", from: parseDate("1814"), until: parseDate("1815") },
            { at: "paris", from: parseDate("1816"), until: parseDate("1817") },
          ],
        }),
      ],
      events: [
        event({
          id: "e1",
          title: "Boarding",
          when: parseDate("1814-06-18"),
          where: { location: "ship" },
        }),
      ],
    });
    const later = eventPlace(w, w.events[0]!, parseDate("1816-06-18"));
    assert.deepEqual(later?.at, [30, 30]);
  });
});

describe("which place an event lands on", () => {
  it("is the place the event names", () => {
    const w = world({
      locations: [location({ id: "elba", name: "Elba", map: "europe", at: [15, 20] })],
      events: [
        event({
          id: "e1",
          title: "Landing",
          when: parseDate("1814-06-18"),
          where: { location: "elba" },
        }),
      ],
    });
    assert.equal(landingPlace(w, w.events[0]!, "europe")?.id, "elba");
  });

  it("is nobody's, for an event with a point of its own", () => {
    const w = world({
      events: [
        event({
          id: "e1",
          title: "Treaty",
          when: parseDate("1802-03-25"),
          where: { map: "europe", at: [12, 12] },
        }),
      ],
    });
    assert.equal(landingPlace(w, w.events[0]!, "europe"), undefined);
  });

  it("is the portal that opens the sub-map the event is in", () => {
    const w = world({
      locations: [
        location({ id: "london", name: "London", map: "europe", at: [20, 15], opens: "london-map" }),
        location({ id: "paris", name: "Paris", map: "london-map", at: [5, 5] }),
      ],
      events: [
        event({
          id: "e1",
          title: "Revolt",
          when: parseDate("1848-06-18"),
          where: { location: "paris" },
        }),
      ],
    });
    // Seen from Europe, the event lands on the portal that opens the way.
    assert.equal(landingPlace(w, w.events[0]!, "europe")?.id, "london");
    // Seen from its own map, it lands on the place it names.
    assert.equal(landingPlace(w, w.events[0]!, "london-map")?.id, "paris");
  });

  it("is nobody's, when the event cannot be reached from this map", () => {
    const w = world({
      locations: [location({ id: "paris", name: "Paris", map: "london-map", at: [5, 5] })],
      events: [
        event({
          id: "e1",
          title: "Revolt",
          when: parseDate("1848-06-18"),
          where: { location: "paris" },
        }),
      ],
    });
    assert.equal(landingPlace(w, w.events[0]!, "atlantis"), undefined);
  });
});

describe("the events at a place", () => {
  const w = world({
    locations: [
      location({ id: "elba", name: "Elba", map: "europe", at: [15, 20] }),
      location({ id: "london", name: "London", map: "europe", at: [20, 15], opens: "london-map" }),
      location({ id: "paris", name: "Paris", map: "london-map", at: [5, 5] }),
    ],
    events: [
      event({
        id: "e1",
        title: "Landing",
        when: parseDate("1814-06-18"),
        where: { location: "elba" },
      }),
      event({
        id: "e2",
        title: "Revolt",
        when: parseDate("1848-06-18"),
        where: { location: "paris" },
      }),
      event({
        id: "e3",
        title: "Treaty",
        when: parseDate("1802-03-25"),
        where: { map: "europe", at: [12, 12] },
      }),
    ],
  });

  it("lists the events that happen there", () => {
    assert.deepEqual(
      eventsAtPlace(w, "elba", "europe").map((e) => e.id),
      ["e1"],
    );
  });

  it("lists the events behind a portal too", () => {
    // Seen from Europe, the events in the sub-map land on the portal.
    assert.deepEqual(
      eventsAtPlace(w, "london", "europe").map((e) => e.id),
      ["e2"],
    );
    // Seen from the sub-map, they belong to the place they name.
    assert.deepEqual(
      eventsAtPlace(w, "paris", "london-map").map((e) => e.id),
      ["e2"],
    );
  });

  it("leaves out an event with a point of its own", () => {
    assert.equal(
      eventsAtPlace(w, "elba", "europe").some((e) => e.id === "e3"),
      false,
    );
  });

  it("says which map a place is on", () => {
    assert.equal(placeMap(w, w.locations[0]!), "europe");
  });
});

describe("tracing a vessel and its people", () => {
  it("says the captain was aboard", () => {
    const steps = traceSteps(shipWorld(), "vance");
    assert.deepEqual(
      steps.map((step) => `${step.kind}:${step.label}`),
      [
        "stay:Aboard Nostalgia for Infinity",
        // The vessel's own stay at Mars starts inside the captain's, so the
        // arrival is a step of its own.
        "stay:Nostalgia for Infinity arrived at Mars",
        "stay:Left Nostalgia for Infinity",
      ],
    );
  });

  it("puts the captain where the vessel was", () => {
    const steps = traceSteps(shipWorld(), "vance");
    const aboard = steps[0];
    assert.equal(aboard?.mapId, "europe");
    assert.deepEqual(aboard?.at, [10, 10]);
  });

  it("names the place the vessel arrived at", () => {
    const steps = traceSteps(shipWorld(), "vance");
    const arrival = steps.find((step) => step.label.includes("arrived at"));
    assert.equal(arrival?.label, "Nostalgia for Infinity arrived at Mars");
    assert.equal(arrival?.mapId, "galaxy");
    assert.deepEqual(arrival?.at, [40, 20]);
  });

  it("traces the vessel itself through the places it visited", () => {
    const steps = traceSteps(shipWorld(), "ship");
    assert.deepEqual(
      steps.map((step) => step.label),
      ["Arrived at Resurgam", "Left Resurgam", "Arrived at Mars", "Left Mars"],
    );
  });

  it("follows the path only as far as it is told to", () => {
    const path = tracePath(shipWorld(), "vance");
    assert.deepEqual(
      path.map((point) => point.at),
      [
        [10, 10],
        [40, 20],
        [40, 20],
      ],
    );

    const early = tracePath(shipWorld(), "vance", parseDate("2562"));
    assert.deepEqual(
      early.map((point) => point.at),
      [[10, 10]],
    );
  });
});

describe("merging a stay into the event that says the same thing", () => {
  const w = world({
    locations: [location({ id: "elba", name: "Elba", map: "europe", at: [15, 20] })],
    people: [
      person({
        id: "napoleon",
        name: "Napoleon",
        stays: [{ at: "elba", from: parseDate("1814"), until: parseDate("1815") }],
      }),
    ],
    events: [
      event({
        id: "arrival",
        title: "Arrival at Elba",
        when: parseDate("1814"),
        where: { location: "elba" },
        people: ["napoleon"],
      }),
    ],
  });

  it("drops the stay boundary that the event already says", () => {
    const steps = traceSteps(w, "napoleon");
    assert.deepEqual(
      steps.map((step) => step.label),
      ["Arrival at Elba", "Left Elba"],
    );
  });

  it("keeps a stay boundary the event does not cover", () => {
    const quiet = world({
      locations: [location({ id: "elba", name: "Elba", map: "europe", at: [15, 20] })],
      people: [
        person({
          id: "napoleon",
          name: "Napoleon",
          stays: [{ at: "elba", from: parseDate("1813"), until: parseDate("1815") }],
        }),
      ],
      events: [
        event({
          id: "arrival",
          title: "Arrival at Elba",
          when: parseDate("1814"),
          where: { location: "elba" },
          people: ["napoleon"],
        }),
      ],
    });
    const steps = traceSteps(quiet, "napoleon");
    assert.deepEqual(
      steps.map((step) => step.label),
      ["Arrived at Elba", "Arrival at Elba", "Left Elba"],
    );
  });
});

describe("the steps the reader walks", () => {
  it("says where each step is, not just which map", () => {
    const w = world({
      locations: [location({ id: "elba", name: "Elba", map: "europe", at: [15, 20] })],
      events: [
        event({
          id: "e1",
          title: "Landing",
          when: parseDate("1814-06-18"),
          where: { location: "elba" },
        }),
      ],
    });
    const steps = viewSteps(w, {
      mode: "span",
      span: { from: parseDate("1800"), to: parseDate("1820") },
    });
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.locationId, "elba");
    assert.deepEqual(steps[0]?.at, [15, 20]);
  });

  it("orders events on the same date by their order field", () => {
    const w = world({
      events: [
        event({ id: "b", title: "Second", when: parseDate("1814"), order: 2 }),
        event({ id: "a", title: "First", when: parseDate("1814"), order: 1 }),
      ],
    });
    const steps = viewSteps(w, {
      mode: "span",
      span: { from: parseDate("1800"), to: parseDate("1820") },
    });
    assert.deepEqual(
      steps.map((step) => step.label),
      ["First", "Second"],
    );
  });
});

describe("which step the reader is on", () => {
  const shared = world({
    events: [
      event({ id: "a", title: "First", when: parseDate("2650") }),
      event({ id: "b", title: "Second", when: parseDate("2650") }),
      event({ id: "c", title: "Third", when: parseDate("2660") }),
    ],
  });
  const steps = viewSteps(shared, {
    mode: "span",
    span: { from: parseDate("2600"), to: parseDate("2700") },
  });

  it("gives two steps on the same date different identities", () => {
    assert.equal(steps.length, 3);
    assert.notEqual(steps[0]?.key, steps[1]?.key);
  });

  it("finds each of two steps that share a date", () => {
    // The date cannot tell them apart - only the key can.
    assert.equal(stepIndex(steps, parseDate("2650")), 1);
    assert.equal(findStep(steps, steps[0]?.key, parseDate("2650")), 0);
    assert.equal(findStep(steps, steps[1]?.key, parseDate("2650")), 1);
  });

  it("can walk all the way back through steps that share a date", () => {
    // The way the arrows do it: take the previous step, keep its
    // identity, and find it again.
    let index = steps.length - 1;
    const visited: number[] = [index];
    while (index > 0) {
      const target = steps[index - 1];
      if (target === undefined) {
        break;
      }
      index = findStep(steps, target.key, target.date);
      visited.push(index);
    }
    assert.deepEqual(visited, [2, 1, 0]);
  });

  it("falls back to the date when the step is not in the list", () => {
    // The trace or the filter changed, so the old step is gone.
    assert.equal(findStep(steps, "event:not-here", parseDate("2650")), 1);
  });

  it("does not let a range date drag the position back", () => {
    const ranged = world({
      events: [
        event({ id: "a", title: "Before", when: parseDate("2524") }),
        event({ id: "b", title: "The range", when: parseDate("2650..2850") }),
        event({ id: "c", title: "After", when: parseDate("2950") }),
      ],
    });
    const rangedSteps = viewSteps(ranged, {
      mode: "span",
      span: { from: parseDate("2500"), to: parseDate("3000") },
    });
    // The range sits at 2650, so the 2524 step is found - not the range.
    assert.equal(findStep(rangedSteps, undefined, parseDate("2524")), 0);
    assert.equal(findStep(rangedSteps, undefined, parseDate("2650..2850")), 1);
  });
});

describe("labels on the axis", () => {
  it("shows the month when the span is a few years", () => {
    const domain = { from: parseDate("1800-01-01"), to: parseDate("1804-01-01") };
    const label = fractionDate(0.5, domain);
    assert.equal(label.raw, "1802-01");
    assert.equal(label.month, 1);
  });

  it("shows the year, and keeps the month, when the span is a couple of decades", () => {
    const domain = { from: parseDate("1800-01-01"), to: parseDate("1820-01-01") };
    const label = fractionDate(0.5, domain);
    assert.equal(label.raw, "1810");
    assert.equal(label.month, 1);
  });

  it("shows the year alone when the span is long", () => {
    const domain = { from: parseDate("1800"), to: parseDate("1850") };
    const label = fractionDate(0.5, domain);
    assert.equal(label.raw, "1825");
    assert.equal(label.month, undefined);
  });

  it("keeps the month when the creator's own dates carry one", () => {
    const domain = { from: parseDate("1800-03-01"), to: parseDate("1850-11-01") };
    const label = fractionDate(0.5, domain);
    assert.equal(label.year, 1825);
    assert.equal(label.month, 7);
  });

  it("still clamps at the ends of the axis", () => {
    const domain = { from: parseDate("1800"), to: parseDate("1850") };
    assert.equal(fractionDate(-1, domain).raw, "1800");
    assert.equal(fractionDate(2, domain).raw, "1850");
  });
});
