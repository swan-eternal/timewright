import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { levenshtein, NameIndex, normalizeName, slugify } from "../src/core/resolve.js";

describe("names", () => {
  it("normalises names for matching", () => {
    assert.equal(normalizeName("Napoleon  Bonaparte"), "napoleon bonaparte");
    assert.equal(normalizeName("St. Helena"), "st helena");
    assert.equal(normalizeName("Elysee"), "elysee");
  });

  it("makes ids from names", () => {
    assert.equal(slugify("Napoleon Bonaparte"), "napoleon-bonaparte");
    assert.equal(slugify("Nostalgia for Infinity"), "nostalgia-for-infinity");
  });

  it("resolves names and aliases", () => {
    const index = new NameIndex();
    index.add("napoleon-bonaparte", "Napoleon Bonaparte", ["Napoleon", "Bonaparte"]);
    assert.equal(index.resolve("napoleon"), "napoleon-bonaparte");
    assert.equal(index.resolve("NAPOLEON BONAPARTE"), "napoleon-bonaparte");
    assert.equal(index.resolve("Wellington"), undefined);
  });

  it("suggests a close name", () => {
    const index = new NameIndex();
    index.add("napoleon-bonaparte", "Napoleon Bonaparte", []);
    assert.deepEqual(index.suggest("Napolon"), ["Napoleon Bonaparte"]);
  });

  it("counts edit distance", () => {
    assert.equal(levenshtein("napoleon", "napoleon"), 0);
    assert.equal(levenshtein("napoleon", "napoléon"), 1);
    assert.equal(levenshtein("", "abc"), 3);
  });

  it("records a collision instead of overwriting", () => {
    const index = new NameIndex();
    index.add("one", "Paris", []);
    index.add("two", "paris", []);
    assert.equal(index.collisions.length, 1);
    assert.equal(index.resolve("Paris"), "one");
  });
});
