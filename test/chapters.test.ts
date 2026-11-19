import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDate } from "../src/core/dates.js";
import { resolveWorld } from "../src/core/derive.js";
import { validateWorld, type WorldData } from "../src/core/validate.js";
import {
  chapterBadge,
  chapterLabel,
  chapterOf,
  carriesCalendarDate,
  displayDate,
  isChapterWorld,
} from "../src/core/chapters.js";
import type {
  EventRecord,
  LocationRecord,
  MapRecord,
  PersonRecord,
  WorldRecord,
} from "../src/core/schema.js";

const CHAPTERS = { 1: "Arrival", 2: "The Storm" };

const WORLD: { chapters: Record<number, string> } = { chapters: CHAPTERS };

function chapterWorld(events: EventRecord[], worldExtra: Partial<WorldRecord> = {}): WorldData {
  return {
    world: { data: { title: "T", chapters: CHAPTERS, ...worldExtra } as WorldRecord },
    maps: [],
    people: [],
    locations: [],
    events: events.map((data) => ({ data, file: "events/events.yaml" })),
  };
}

describe("chapter labels", () => {
  it("names a chapter the world knows", () => {
    assert.equal(chapterLabel(WORLD, 2), "Chapter 2 — The Storm");
  });

  it("numbers a chapter the world does not name", () => {
    assert.equal(chapterLabel(WORLD, 5), "Chapter 5");
    assert.equal(chapterLabel({}, 5), "Chapter 5");
  });

  it("says which worlds count chapters", () => {
    assert.equal(isChapterWorld(WORLD), true);
    assert.equal(isChapterWorld({}), false);
  });

  it("badges a number, and shows a string as written", () => {
    assert.equal(chapterBadge(WORLD, 1), "Chapter 1 — Arrival");
    assert.equal(chapterBadge({}, "Interlude three"), "Interlude three");
  });
});

describe("which bounds are chapters", () => {
  it("takes a whole bare number", () => {
    assert.equal(chapterOf(parseDate(3)), 3);
    assert.equal(chapterOf(parseDate("3")), 3);
  });

  it("leaves dates, ranges and approximations alone", () => {
    assert.equal(chapterOf(parseDate("1815-06-18")), undefined);
    assert.equal(chapterOf(parseDate("1815-06")), undefined);
    assert.equal(chapterOf(parseDate("3..5")), undefined);
    assert.equal(chapterOf(parseDate("~3")), undefined);
    assert.equal(chapterOf(parseDate("<3")), undefined);
  });
});

describe("how a date displays", () => {
  it("labels chapters in a chapter world", () => {
    assert.equal(displayDate(WORLD, parseDate(2)), "Chapter 2 — The Storm");
    assert.equal(displayDate(WORLD, parseDate(7)), "Chapter 7");
  });

  it("keeps raw text outside chapter worlds and inside ranges", () => {
    assert.equal(displayDate({}, parseDate("1815")), "1815");
    assert.equal(displayDate(WORLD, parseDate("3..5")), "3..5");
    assert.equal(displayDate(WORLD, parseDate("~3")), "~3");
  });
});

describe("chapters through the pipeline", () => {
  it("resolves the map and the event's chapter", () => {
    const world = resolveWorld(
      chapterWorld([{ title: "Landfall", when: 1, chapter: "one" } as EventRecord]),
    );
    assert.deepEqual(world.chapters, CHAPTERS);
    assert.equal(world.events[0].chapter, "one");
  });

  it("knows the chapters and chapter fields", () => {
    const issues = validateWorld(
      chapterWorld([{ title: "Landfall", when: 1, chapter: 2 } as EventRecord]),
    );
    // The fields are known to the format. The chapter badge inside a
    // chapter world draws its own warning, checked further below.
    assert.deepEqual(
      issues.filter(
        (issue) =>
          issue.code === "unknown-field" &&
          (issue.field === "chapters" || issue.field === "chapter"),
      ),
      [],
    );
  });

  it("accepts a world that declares format 1.1", () => {
    const issues = validateWorld(chapterWorld([], { format: "1.1" }));
    assert.deepEqual(issues.filter((issue) => issue.field === "format"), []);
  });
});

describe("which bounds carry calendar dates", () => {
  it("flags months and days, on bounds and on range ends", () => {
    assert.equal(carriesCalendarDate(parseDate("1815-06-18")), true);
    assert.equal(carriesCalendarDate(parseDate("1815-06")), true);
    assert.equal(carriesCalendarDate(parseDate("3..1815-06")), true);
  });

  it("passes bare numbers, ranges of them, and approximations", () => {
    assert.equal(carriesCalendarDate(parseDate(3)), false);
    assert.equal(carriesCalendarDate(parseDate("3..5")), false);
    assert.equal(carriesCalendarDate(parseDate("~3")), false);
  });
});

describe("chapter world guardrails", () => {
  it("warns when a chapter world mixes in a calendar date", () => {
    const issues = validateWorld(chapterWorld([{ title: "Waterloo", when: "1815-06-18" } as EventRecord]));
    const mixing = issues.filter((issue) => issue.code === "chapter-world-date");
    assert.equal(mixing.length, 1);
    assert.equal(mixing[0]?.field, "when");
    assert.equal(mixing[0]?.severity, "warning");
  });

  it("checks the world bounds, lives, places, stays and image windows too", () => {
    const issues = validateWorld({
      world: { data: { title: "T", chapters: CHAPTERS, start: "1815-06" } as WorldRecord },
      maps: [
        { data: { name: "M", images: [{ file: "a.png", until: "1815-06-18" }] } as MapRecord, file: "maps/m.yaml" },
      ],
      people: [{ data: { name: "Ada", born: "1760-12" } as PersonRecord, file: "people/p.yaml" }],
      locations: [
        {
          data: { name: "Rome", exists: { from: "1815-01-01" }, stays: [{ at: "Rome", from: "1815-06" }] } as LocationRecord,
          file: "locations/l.yaml",
        },
      ],
      events: [{ data: { title: "B", when: "2..1815-06" } as EventRecord, file: "events/e.yaml" }],
    });
    const fields = issues
      .filter((issue) => issue.code === "chapter-world-date")
      .map((issue) => issue.field)
      .sort();
    assert.deepEqual(fields, ["born", "exists.from", "images.until", "start", "stays.from", "when"]);
  });

  it("warns when a chapter world also declares a calendar", () => {
    const issues = validateWorld(
      chapterWorld([{ title: "A", when: 2 } as EventRecord], { calendar: { months: ["M1"] } }),
    );
    assert.equal(issues.filter((issue) => issue.code === "chapters-with-calendar").length, 1);
  });

  it("warns when an event names a chapter in a chapter world", () => {
    const issues = validateWorld(chapterWorld([{ title: "A", when: 2, chapter: 2 } as EventRecord]));
    assert.equal(issues.filter((issue) => issue.code === "chapter-in-chapter-world").length, 1);
  });

  it("keeps a clean chapter world quiet", () => {
    const issues = validateWorld(
      chapterWorld([
        { title: "A", when: 2 } as EventRecord,
        { title: "B", when: "3..5" } as EventRecord,
        { title: "C", when: "~2" } as EventRecord,
      ]),
    );
    assert.deepEqual(issues.filter((issue) => issue.code.startsWith("chapter")), []);
  });
});