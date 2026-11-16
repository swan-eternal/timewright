/**
 * The timeline axis: what range the strip covers, and where a date sits on it.
 *
 * The domain is bounded by the content, so there is no "outside" to stray
 * into. The earliest event to the latest, with the creator's `start` and
 * `end` overriding when they are written down.
 *
 * Events with no place on the map do not widen the axis. One background
 * event six centuries earlier would stretch the strip and squash the years
 * that actually have a map into a sliver - the same trap the Revelation
 * Space timeline hit. Those events still appear, pinned to the edges.
 *
 * The mapping is plain linear: one year is always the same width. If a world
 * ever needs a broken axis, that is a change to `dateFraction` alone.
 */

import { compareDates, dateValue, type DateBound, type ParsedDate } from "./dates.js";
import { eventHasPosition } from "./derive.js";
import type { ResolvedWorld } from "./model.js";

export interface TimeDomain {
  from: DateBound;
  to: DateBound;
}

export interface DomainOptions {
  /** Let events with no place on the map widen the axis. */
  includeUnplaced?: boolean;
}

/** The range the strip covers. */
export function eventDomain(world: ResolvedWorld, options: DomainOptions = {}): TimeDomain | undefined {
  // An event whose place is not placed yet has no position on the map, so
  // it does not widen the strip - it is pinned to the edge instead.
  const placed = world.events.filter((event) => eventHasPosition(world, event));
  const pool = options.includeUnplaced === true || placed.length === 0 ? world.events : placed;
  if (pool.length === 0) {
    return undefined;
  }
  const sorted = [...pool].sort((a, b) => compareDates(a.when, b.when));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }
  return {
    from: world.start ?? first.when,
    to: endOfDate(world.end ?? last.when),
  };
}

/**
 * The end of a date: the end bound of a range, or the date itself.
 *
 * The strip runs to the last moment the world covers, so a world whose
 * last event is a range runs to the end of that range and not to the
 * moment it began.
 */
function endOfDate(date: ParsedDate): DateBound {
  return date.kind === "range" && date.to !== undefined ? date.to : date;
}

/** A date as a number of years, so two dates can be compared. */
export { dateValue } from "./dates.js";

/** Where a date sits on the axis, from 0 to 1. */
export function dateFraction(date: DateBound, domain: TimeDomain): number {
  const from = dateValue(domain.from);
  const to = dateValue(domain.to);
  if (to === from) {
    return 0.5;
  }
  const value = dateValue(date);
  if (value <= from) {
    return 0;
  }
  if (value >= to) {
    return 1;
  }
  return (value - from) / (to - from);
}

/** The date at a point on the axis. */
export function fractionDate(fraction: number, domain: TimeDomain): DateBound {
  const from = dateValue(domain.from);
  const to = dateValue(domain.to);
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const value = from + (to - from) * clamped;
  const year = Math.floor(value);
  const spanYears = Math.abs(to - from);
  const hasMonths = domain.from.month !== undefined || domain.to.month !== undefined;
  if (spanYears <= 20 || hasMonths) {
    const month = Math.min(12, Math.max(1, Math.floor((value - year) * 12) + 1));
    if (spanYears <= 5) {
      const raw = `${year}-${String(month).padStart(2, "0")}`;
      return { raw, approx: false, year, month };
    }
    return { raw: String(year), approx: false, year, month };
  }
  return { raw: String(year), approx: false, year };
}

/** A human label for the ends of the axis. */
export function domainLabel(domain: TimeDomain): string {
  const from = domain.from.raw;
  const to = domain.to.raw;
  return from === to ? from : `${from} – ${to}`;
}
