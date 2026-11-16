import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareBounds, compareDates, compareOrder, dateValue, parseDate, tryParseDate, type ParseOptions } from "../src/core/dates.js";

const CALENDAR: ParseOptions = {
  calendar: {
    months: ["Hammer", "Alturiak", "Thirdmonth"],
    days_per_month: 30,
    eras: [
      { name: "DR", start: 0 },
      { name: "AF", start: 1200 },
    ],
  },
};

describe("dates", () => {
  it("reads a plain year", () => {
    const date = parseDate("1815");
    assert.equal(date.kind, "exact");
    assert.equal(date.year, 1815);
    assert.equal(date.month, undefined);
    assert.equal(date.day, undefined);
  });

  it("reads a year and month, and a full date", () => {
    const month = parseDate("1815-06");
    assert.equal(month.month, 6);
    assert.equal(month.day, undefined);
    const full = parseDate("1815-06-18");
    assert.equal(full.year, 1815);
    assert.equal(full.month, 6);
    assert.equal(full.day, 18);
  });

  it("keeps negative and far-future years", () => {
    assert.equal(parseDate(-480).year, -480);
    assert.equal(parseDate("99999").year, 99999);
  });

  it("marks approximate dates", () => {
    const approximate = parseDate("~1200");
    assert.equal(approximate.kind, "approx");
    assert.equal(approximate.approx, true);
    assert.equal(approximate.year, 1200);
    assert.equal(parseDate("c. 1200").kind, "approx");
  });

  it("reads a range", () => {
    const range = parseDate("1805..1807");
    assert.equal(range.kind, "range");
    assert.equal(range.from?.year, 1805);
    assert.equal(range.to?.year, 1807);
  });

  it("reads bounded dates", () => {
    assert.equal(parseDate("<2300").kind, "before");
    assert.equal(parseDate(">2300").kind, "after");
  });

  it("resolves an era against the calendar", () => {
    const date = parseDate("AF 312", CALENDAR);
    assert.equal(date.year, 1512);
    assert.equal(date.era, "AF");
    assert.equal(parseDate("312 AF", CALENDAR).year, 1512);
  });

  it("reads an era with a numeric prefix", () => {
    const date = parseDate("3E 201", { calendar: { eras: [{ name: "E", start: 0 }] } });
    assert.equal(date.year, 201);
  });

  it("warns about an impossible day but still builds", () => {
    const date = parseDate("1815-02-30");
    assert.equal(date.year, 1815);
    assert.equal(date.day, 30);
    assert.ok(date.warnings.length > 0);
  });

  it("knows leap years", () => {
    assert.equal(parseDate("1816-02-29").warnings.length, 0);
    assert.ok(parseDate("1815-02-29").warnings.length > 0);
  });

  it("reads named months in a custom calendar", () => {
    const date = parseDate("40th of Thirdmonth 312", CALENDAR);
    assert.equal(date.month, 3);
    assert.equal(date.day, 40);
    assert.equal(date.year, 312);
    assert.ok(date.warnings.length > 0);
  });

  it("warns about an unknown era but keeps the year", () => {
    const date = parseDate("XX 12");
    assert.equal(date.year, 12);
    assert.ok(date.warnings.length > 0);
  });

  it("rejects text it cannot read", () => {
    const result = tryParseDate("sometime in the spring");
    assert.equal(result.ok, false);
  });

  it("sorts missing parts before present ones", () => {
    assert.ok(compareDates(parseDate("1815"), parseDate("1815-06")) < 0);
    assert.ok(compareDates(parseDate("1815-06"), parseDate("1815-06-18")) < 0);
  });

  it("sorts bounded dates around their bound", () => {
    assert.ok(compareDates(parseDate("<2300"), parseDate("2300")) < 0);
    assert.ok(compareDates(parseDate(">2300"), parseDate("2300")) > 0);
    assert.ok(compareDates(parseDate("<2300"), parseDate("2299")) > 0);
  });

  it("sorts ranges by their start", () => {
    assert.ok(compareDates(parseDate("1805..1807"), parseDate("1810")) < 0);
  });
});

describe("a bound as the period it covers", () => {
  it("treats a bare year as covering that whole year", () => {
    assert.equal(compareBounds(parseDate("1815-06-18"), parseDate("1815")), 0);
    assert.equal(compareBounds(parseDate("1815"), parseDate("1815-06-18")), 0);
  });

  it("keeps a date before a year before it, and one after it after", () => {
    assert.ok(compareBounds(parseDate("1814-12-31"), parseDate("1815")) < 0);
    assert.ok(compareBounds(parseDate("1816-01-01"), parseDate("1815")) > 0);
  });

  it("treats a bare month as covering that whole month", () => {
    assert.equal(compareBounds(parseDate("1815-06-18"), parseDate("1815-06")), 0);
    assert.ok(compareBounds(parseDate("1815-07-01"), parseDate("1815-06")) > 0);
    assert.ok(compareBounds(parseDate("1815-05-31"), parseDate("1815-06")) < 0);
  });

  it("orders bounds strictly, for sorting", () => {
    assert.ok(compareOrder(parseDate("1815"), parseDate("1815-06-18")) < 0);
    assert.ok(compareOrder(parseDate("1815-06-18"), parseDate("1816")) < 0);
    assert.equal(compareOrder(parseDate("1815"), parseDate("1815")), 0);
  });

  it("places a range at the start of the range", () => {
    // A range carries no year of its own - its bounds live in from and to -
    // so without this it would be placed at year zero.
    assert.equal(dateValue(parseDate("2650..2850")), dateValue(parseDate("2650")));
  });
});
