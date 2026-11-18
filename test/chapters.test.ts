import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDate } from "../src/core/dates.js";
import { resolveWorld } from "../src/core/derive.js";
import { validateWorld, type WorldData } from "../src/core/validate.js";
import {
  chapterBadge,
  chapterLabel,
  chapterOf,
  displayDate,
  isChapterWorld,
} from "../src/core/chapters.js";
import type { EventRecord, WorldRecord } from "../src/core/schema.js";

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
    assert.deepEqual(
      issues.filter((issue) => issue.field === "chapters" || issue.field === "chapter"),
      [],
    );
  });

  it("accepts a world that declares format 1.1", () => {
    const issues = validateWorld(chapterWorld([], { format: "1.1" }));
    assert.deepEqual(issues.filter((issue) => issue.field === "format"), []);
  });
});
