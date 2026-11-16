import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareBounds,
  compareDates,
  compareOrder,
  dateValue,
  parseDate,
} from "../src/core/dates.js";

/**
 * The date model has two notions, and they have to agree.
 *
 * - an order: where a date sits in time, for sorting;
 * - a period: the span a date covers, for asking whether it contains
 *   another date.
 *
 * These used to disagree with each other, and the disagreement was the
 * cause of several bugs.
 */
describe("the order of dates", () => {
  it("sorts a range by its start, not to the front of everything", () => {
    const range = parseDate("1805..1807");
    assert.ok(compareDates(range, parseDate("1810")) < 0);
    assert.ok(compareOrder(range, parseDate("1810")) < 0);
    assert.ok(compareDates(parseDate("1810"), range) > 0);
  });

  it("sorts a bounded date the same way in both comparators", () => {
    const pairs: [string, string][] = [
      ["<2300", "2300"],
      ["<2300", "2299"],
      [">2300", "2300"],
      ["2300", "<2300"],
      ["1805..1807", "1810"],
    ];
    for (const [left, right] of pairs) {
      assert.equal(
        Math.sign(compareDates(parseDate(left), parseDate(right))),
        Math.sign(compareOrder(parseDate(left), parseDate(right))),
        `${left} against ${right}`,
      );
    }
  });

  it("puts a bounded date beside its bound rather than on it", () => {
    // "<1800" and "1800" were the same point on the timeline.
    const before = dateValue(parseDate("<1800"));
    const exact = dateValue(parseDate("1800"));
    const after = dateValue(parseDate(">1800"));
    assert.ok(before < exact, "a date before the bound should sit before it");
    assert.ok(after > exact, "a date after the bound should sit after it");
  });

  it("sorts the less precise of two dates first", () => {
    assert.ok(compareDates(parseDate("1815"), parseDate("1815-06")) < 0);
    assert.ok(compareDates(parseDate("1815-06"), parseDate("1815-06-18")) < 0);
  });
});

describe("the period a date covers", () => {
  it("keeps a range inside the span it belongs to", () => {
    // A range used to cover all of time, so it was inside every span.
    const range = parseDate("1805..1807");
    const later = parseDate("2500");
    assert.ok(compareBounds(range, later) < 0, "a range should end before a later date");
    assert.ok(compareBounds(later, range) > 0, "a later date should start after the range");
  });

  it("still covers a whole year for a bare year", () => {
    assert.equal(compareBounds(parseDate("1815-06-18"), parseDate("1815")), 0);
    assert.equal(compareBounds(parseDate("1815"), parseDate("1815-06-18")), 0);
  });

  it("keeps a date before a year before it, and one after it after", () => {
    assert.ok(compareBounds(parseDate("1814-12-31"), parseDate("1815")) < 0);
    assert.ok(compareBounds(parseDate("1816-01-01"), parseDate("1815")) > 0);
  });

  it("covers a whole month for a bare month", () => {
    assert.equal(compareBounds(parseDate("1815-06-18"), parseDate("1815-06")), 0);
    assert.ok(compareBounds(parseDate("1815-07-01"), parseDate("1815-06")) > 0);
    assert.ok(compareBounds(parseDate("1815-05-31"), parseDate("1815-06")) < 0);
  });
});
