import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareBounds,
  compareDates,
  compareOrder,
  daysInMonth,
  parseDate,
  type ParseOptions,
} from "../src/core/dates.js";

/** Thirteen months of forty days: every trap the old arithmetic fell into. */
const LONG_YEAR: ParseOptions = {
  calendar: { months: 13, days_per_month: 40 },
};

/** Months of different lengths in one year. */
const UNEVEN_YEAR: ParseOptions = {
  calendar: {
    months: ["Alpha", "Beta", "Gamma"],
    days_per_month: [10, 40, 25],
  },
};

describe("the order of a custom calendar's dates", () => {
  it("keeps every day of a forty-day month in order", () => {
    let previous = parseDate("2300-01-01", LONG_YEAR);
    for (let day = 2; day <= 40; day += 1) {
      const next = parseDate(`2300-01-${day}`, LONG_YEAR);
      assert.ok(compareDates(previous, next) < 0, `day ${day - 1} before day ${day}`);
      previous = next;
    }
  });

  it("keeps a thirteenth month inside its own year", () => {
    assert.ok(compareDates(parseDate("2300-13-40", LONG_YEAR), parseDate("2301-01-01", LONG_YEAR)) < 0);
    assert.ok(compareDates(parseDate("2300-12-40", LONG_YEAR), parseDate("2300-13-01", LONG_YEAR)) < 0);
  });

  it("orders days across months of different lengths", () => {
    assert.ok(compareDates(parseDate("300-01-10", UNEVEN_YEAR), parseDate("300-02-01", UNEVEN_YEAR)) < 0);
    assert.ok(compareDates(parseDate("300-02-40", UNEVEN_YEAR), parseDate("300-03-01", UNEVEN_YEAR)) < 0);
    assert.ok(compareDates(parseDate("300-03-25", UNEVEN_YEAR), parseDate("301-01-01", UNEVEN_YEAR)) < 0);
  });

  it("keeps the order after a trip through JSON", () => {
    const late = JSON.parse(JSON.stringify(parseDate("2300-13-40", LONG_YEAR)));
    const newYear = JSON.parse(JSON.stringify(parseDate("2301-01-01", LONG_YEAR)));
    assert.ok(compareDates(late, newYear) < 0);
  });
});

describe("the period a custom calendar's date covers", () => {
  it("covers the last day of a month named only to the month", () => {
    assert.equal(compareBounds(parseDate("2300-03-40", LONG_YEAR), parseDate("2300-03", LONG_YEAR)), 0);
    assert.ok(compareBounds(parseDate("2300-04-01", LONG_YEAR), parseDate("2300-03", LONG_YEAR)) > 0);
  });

  it("covers a whole year, up to its thirteenth month's last day", () => {
    assert.equal(compareBounds(parseDate("2300-13-40", LONG_YEAR), parseDate("2300", LONG_YEAR)), 0);
    assert.ok(compareBounds(parseDate("2301-01-01", LONG_YEAR), parseDate("2300", LONG_YEAR)) > 0);
  });

  it("covers the last day of a custom-calendar range", () => {
    const range = parseDate("2300-01-01..2300-02-20", LONG_YEAR);
    assert.equal(compareBounds(parseDate("2300-02-20", LONG_YEAR), range), 0);
    assert.ok(compareBounds(parseDate("2300-02-21", LONG_YEAR), range) > 0);
  });
});

/** A small deterministic PRNG, so the property test is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

describe("the order under random calendars", () => {
  it("agrees with the calendar's own count of days", () => {
    const random = mulberry32(20261117);
    for (let trial = 0; trial < 200; trial += 1) {
      const monthCount = randomInt(random, 2, 24);
      const options: ParseOptions =
        trial % 3 === 0
          ? {}
          : trial % 3 === 1
            ? { calendar: { months: monthCount, days_per_month: randomInt(random, 5, 60) } }
            : {
                calendar: {
                  months: monthCount,
                  days_per_month: Array.from({ length: monthCount }, () => randomInt(random, 5, 60)),
                },
              };
      const months = options.calendar?.months;
      const monthTotal = Array.isArray(months) ? months.length : (months ?? 12);

      const drawn: { stamp: string; year: number; month: number; day: number }[] = [];
      for (let i = 0; i < 40; i += 1) {
        const year = randomInt(random, 1, 900);
        const month = randomInt(random, 1, monthTotal);
        const dayMax = daysInMonth(year, month, options) ?? 30;
        const day = randomInt(random, 1, dayMax);
        drawn.push({ stamp: `${year}-${month}-${day}`, year, month, day });
      }

      const sorted = [...drawn].sort(
        (a, b) => a.year - b.year || a.month - b.month || a.day - b.day,
      );
      for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1];
        const next = sorted[i];
        if (previous.stamp === next.stamp) {
          continue;
        }
        const label = `${previous.stamp} against ${next.stamp} in ${JSON.stringify(options)}`;
        assert.ok(compareOrder(parseDate(previous.stamp, options), parseDate(next.stamp, options)) < 0, label);
        assert.ok(compareDates(parseDate(previous.stamp, options), parseDate(next.stamp, options)) < 0, label);
        assert.ok(compareBounds(parseDate(previous.stamp, options), parseDate(next.stamp, options)) < 0, label);
      }
    }
  });
});
