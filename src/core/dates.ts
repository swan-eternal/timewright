/**
 * Flexible dates for Timewright.
 *
 * The rule that shapes this module: never reject a date the creator meant.
 * Only text that cannot be interpreted at all is an error. An out-of-range
 * month or day warns and still builds, and display always uses the raw text
 * the creator wrote.
 */

export type DateKind = "exact" | "approx" | "range" | "before" | "after";

export interface DateBound {
  /** Exactly what the creator wrote. */
  raw: string;
  /** The creator marked the date approximate (~1200, c. 1200). */
  approx: boolean;
  /** Absolute year, era-adjusted. */
  year?: number;
  /** 1-based month. */
  month?: number;
  /** 1-based day. */
  day?: number;
  /** Era label as written, when the date was era-qualified. */
  era?: string;
}

export interface ParsedDate extends DateBound {
  kind: DateKind;
  /** Range start, when the kind is "range". */
  from?: DateBound;
  /** Range end, when the kind is "range". */
  to?: DateBound;
  /** Non-fatal problems: out-of-range day, unknown era, unknown month. */
  warnings: string[];
}

export interface EraSpec {
  name: string;
  /** Absolute year of era year 0. Era year 1 is start + 1. */
  start: number;
}

export interface CalendarSpec {
  /** Month names, or a count of unnamed months. */
  months?: string[] | number;
  /** Days per month, or one count per month. */
  days_per_month?: number | number[];
  eras?: EraSpec[];
}

export interface ParseOptions {
  calendar?: CalendarSpec;
}

export class DateParseError extends Error {
  readonly raw: string;

  constructor(raw: string, message: string) {
    super(message);
    this.name = "DateParseError";
    this.raw = raw;
  }
}

const GREGORIAN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const APPROX_PREFIX = /^(?:~|approx\.?|approximately|ca\.?|circa|c\.)\s*/i;
const NUMERIC = /^([+-]?\d{1,9})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/;
const DAY_MONTH_YEAR =
  /^(\d{1,3})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z][A-Za-z' ]*?)\s*,?\s+([+-]?\d{1,9})$/;
const MONTH_DAY_YEAR =
  /^([A-Za-z][A-Za-z' ]*?)\s+(\d{1,3})(?:st|nd|rd|th)?\s*,?\s+([+-]?\d{1,9})$/;
const MONTH_YEAR = /^([A-Za-z][A-Za-z' ]*?)\s+([+-]?\d{1,9})$/;
const ERA_FIRST = /^([+-]?\d+)?\s*([A-Za-z]+)\s+([+-]?\d{1,9})$/;
const ERA_LAST = /^([+-]?\d{1,9})\s+([A-Za-z]+)$/;

/** Parse a date the creator wrote. Throws DateParseError on unparseable text. */
export function parseDate(input: string | number, options: ParseOptions = {}): ParsedDate {
  const raw = String(input).trim();
  if (raw === "") {
    throw new DateParseError(raw, "date is empty");
  }
  const warnings: string[] = [];

  if (raw.includes("..")) {
    const parts = raw.split("..");
    if (parts.length !== 2) {
      throw new DateParseError(raw, `"${raw}" has more than one ".." separator`);
    }
    const from = parseBound(parts[0], options, warnings);
    const to = parseBound(parts[1], options, warnings);
    return { raw, kind: "range", approx: false, from, to, warnings };
  }

  if (raw.startsWith("<") || raw.startsWith(">")) {
    const kind: DateKind = raw.startsWith("<") ? "before" : "after";
    const bound = parseBound(raw.slice(1), options, warnings);
    return { ...bound, raw, kind, warnings };
  }

  const bound = parseBound(raw, options, warnings);
  return { ...bound, kind: bound.approx ? "approx" : "exact", warnings };
}

export type DateParseResult =
  | { ok: true; value: ParsedDate }
  | { ok: false; error: string };

/** Parse a date without throwing. */
export function tryParseDate(input: string | number, options: ParseOptions = {}): DateParseResult {
  try {
    return { ok: true, value: parseDate(input, options) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseBound(text: string, options: ParseOptions, warnings: string[]): DateBound {
  const raw = text.trim();
  if (raw === "") {
    throw new DateParseError(text, "date is empty");
  }

  let approx = false;
  let body = raw;
  const approxMatch = APPROX_PREFIX.exec(body);
  if (approxMatch) {
    approx = true;
    body = body.slice(approxMatch[0].length).trim();
  }

  const numeric = NUMERIC.exec(body);
  if (numeric) {
    const year = Number(numeric[1]);
    const month = numeric[2] === undefined ? undefined : Number(numeric[2]);
    const day = numeric[3] === undefined ? undefined : Number(numeric[3]);
    checkRange(year, month, day, options, warnings);
    return { raw, approx, year, month, day };
  }

  const dayMonth = DAY_MONTH_YEAR.exec(body);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const monthName = dayMonth[2].trim();
    const year = Number(dayMonth[3]);
    const month = lookupMonthName(monthName, options);
    if (month === undefined) {
      throw new DateParseError(raw, `unknown month "${monthName}" in "${raw}"`);
    }
    checkRange(year, month, day, options, warnings);
    return { raw, approx, year, month, day };
  }

  const monthDay = MONTH_DAY_YEAR.exec(body);
  if (monthDay) {
    const monthName = monthDay[1].trim();
    const day = Number(monthDay[2]);
    const year = Number(monthDay[3]);
    const month = lookupMonthName(monthName, options);
    if (month === undefined) {
      throw new DateParseError(raw, `unknown month "${monthName}" in "${raw}"`);
    }
    checkRange(year, month, day, options, warnings);
    return { raw, approx, year, month, day };
  }

  const monthYear = MONTH_YEAR.exec(body);
  if (monthYear) {
    const monthName = monthYear[1].trim();
    const year = Number(monthYear[2]);
    const month = lookupMonthName(monthName, options);
    if (month !== undefined) {
      checkRange(year, month, undefined, options, warnings);
      return { raw, approx, year, month };
    }
    // Not a month we know: the word may be an era, so keep going.
  }

  let eraToken: string | undefined;
  let eraYear: number | undefined;
  const eraFirst = ERA_FIRST.exec(body);
  if (eraFirst) {
    eraToken = `${eraFirst[1] ?? ""}${eraFirst[2]}`;
    eraYear = Number(eraFirst[3]);
  } else {
    const eraLast = ERA_LAST.exec(body);
    if (eraLast) {
      eraToken = eraLast[2];
      eraYear = Number(eraLast[1]);
    }
  }
  if (eraToken !== undefined && eraYear !== undefined) {
    const resolved = resolveEra(eraToken, eraYear, options);
    if (resolved.warning !== undefined) {
      warnings.push(resolved.warning);
    }
    return { raw, approx, year: resolved.year, era: eraToken };
  }

  throw new DateParseError(raw, `cannot parse date "${raw}"`);
}

/** Month names resolve against the world's calendar, or the Gregorian names. */
function lookupMonthName(name: string, options: ParseOptions): number | undefined {
  const key = name.trim().toLowerCase();
  if (key === "") {
    return undefined;
  }
  const months = options.calendar?.months;
  if (Array.isArray(months)) {
    const index = months.findIndex((month) => month.trim().toLowerCase() === key);
    return index === -1 ? undefined : index + 1;
  }
  if (months !== undefined) {
    // A custom calendar with unnamed months cannot resolve a month name.
    return undefined;
  }
  const exact = GREGORIAN_MONTHS.findIndex((month) => month.toLowerCase() === key);
  if (exact !== -1) {
    return exact + 1;
  }
  const abbreviated = GREGORIAN_MONTHS.findIndex(
    (month) => month.toLowerCase().startsWith(key) && key.length >= 3,
  );
  return abbreviated === -1 ? undefined : abbreviated + 1;
}

function resolveEra(
  token: string,
  year: number,
  options: ParseOptions,
): { year: number; warning?: string } {
  const eras = options.calendar?.eras ?? [];
  const candidates = [token];
  const withoutPrefix = token.replace(/^\d+/, "");
  if (withoutPrefix !== "" && withoutPrefix !== token) {
    candidates.push(withoutPrefix);
  }
  for (const candidate of candidates) {
    const found = eras.find(
      (era) => era.name.trim().toLowerCase() === candidate.trim().toLowerCase(),
    );
    if (found) {
      return { year: found.start + year };
    }
  }
  return {
    year,
    warning: `unknown era "${token}"; treating ${year} as an absolute year`,
  };
}

function monthCountOf(options: ParseOptions): number {
  const months = options.calendar?.months;
  if (months === undefined) {
    return 12;
  }
  return Array.isArray(months) ? months.length : months;
}

export function isLeapYear(year: number | undefined): boolean {
  if (year === undefined) {
    return false;
  }
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Days in a month, or undefined when the calendar does not say. */
export function daysInMonth(
  year: number | undefined,
  month: number,
  options: ParseOptions,
): number | undefined {
  const calendar = options.calendar;
  if (calendar?.days_per_month !== undefined) {
    const value = calendar.days_per_month;
    return Array.isArray(value) ? value[month - 1] : value;
  }
  if (calendar?.months !== undefined) {
    return undefined;
  }
  if (month < 1 || month > 12) {
    return undefined;
  }
  const lengths = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return lengths[month - 1];
}

function checkRange(
  year: number | undefined,
  month: number | undefined,
  day: number | undefined,
  options: ParseOptions,
  warnings: string[],
): void {
  if (month === undefined) {
    return;
  }
  const months = monthCountOf(options);
  if (month < 1 || month > months) {
    warnings.push(`month ${month} is outside 1-${months}`);
    return;
  }
  if (day === undefined) {
    return;
  }
  if (day < 1) {
    warnings.push(`day ${day} is not a valid day`);
    return;
  }
  const days = daysInMonth(year, month, options);
  if (days !== undefined && day > days) {
    warnings.push(`day ${day} is outside 1-${days} for month ${month}`);
  }
}

/**
 * How far a bounded date sits from the bound it names, in years.
 *
 * A date that reaches back ("before 2300") is a quarter of a year
 * before the bound; one that reaches forward ("after 2300") is a
 * quarter of a year after it. Enough to keep the two apart on the
 * timeline and in the order, and not enough to look like a different
 * year.
 */
const REACH = 0.25;

/**
 * The first instant a bound covers, as a number of years.
 *
 * A bare year starts on 1 January; a bare month on its first day.
 */
function instantOf(bound: DateBound): number {
  const year = bound.year ?? 0;
  const month = (bound.month ?? 1) - 1;
  const day = (bound.day ?? 1) - 1;
  return year + month / 12 + day / 365.25;
}

/**
 * The last instant a bound covers, as a number of years: the end of its
 * last day.
 */
function endOf(bound: DateBound): number {
  const year = bound.year ?? 0;
  const month = bound.month ?? 12;
  const day = bound.day ?? daysInMonth(bound.year, month, {}) ?? 31;
  return year + (month - 1) / 12 + (day - 1) / 365.25;
}

/**
 * How precise a bound is: a year, a year and a month, or a full date.
 *
 * Used to break ties, so that the less precise date comes first.
 */
function precisionOf(bound: DateBound): number {
  if (bound.day !== undefined) {
    return 3;
  }
  if (bound.month !== undefined) {
    return 2;
  }
  return 1;
}

/**
 * A date as a number of years, so two dates can be compared.
 *
 * A range is placed by where it starts: the range's bounds live in `from`
 * and `to`, and the date itself carries no year of its own. A bounded
 * date sits just outside the bound it names, so `<2300` and `2300` are
 * two places on the timeline rather than one.
 */
export function dateValue(date: DateBound): number {
  const parsed = date as ParsedDate;
  if (parsed.kind === "range") {
    return parsed.from !== undefined ? dateValue(parsed.from) : 0;
  }
  if (parsed.kind === "before") {
    return instantOf(parsed) - REACH;
  }
  if (parsed.kind === "after") {
    return instantOf(parsed) + REACH;
  }
  return instantOf(parsed);
}

/** Compare two dates that may only be a year apart. */
export function compareDateBounds(a: DateBound, b: DateBound): number {
  return dateValue(a) - dateValue(b);
}

/**
 * The order a date takes: when it is, and how precise it is.
 *
 * One key for every kind of date. A range sorts by its start, a
 * bounded date sorts just outside the bound it names, and the less
 * precise of two dates at the same moment comes first.
 */
export function orderKey(date: DateBound): number[] {
  const parsed = date as ParsedDate;
  if (parsed.kind === "range") {
    return parsed.from !== undefined ? orderKey(parsed.from) : [Number.NEGATIVE_INFINITY, 0];
  }
  if (parsed.year === undefined) {
    return [Number.NEGATIVE_INFINITY, 0];
  }
  return [dateValue(parsed), precisionOf(parsed)];
}

/**
 * The period a date covers: the first instant it includes, and the
 * last.
 *
 * A bare year covers that whole year, and a bare month that whole
 * month. A range covers the span between its bounds. A date that
 * reaches back covers everything before the bound it names, and one
 * that reaches forward everything after it.
 */
function periodOf(date: DateBound): { start: number; end: number } {
  const parsed = date as ParsedDate;
  // A range is checked first: its year lives on its bounds, not on the
  // range itself, so the "no year" case below would otherwise swallow it
  // and make every range cover all of time.
  if (parsed.kind === "range") {
    return {
      start: parsed.from !== undefined ? instantOf(parsed.from) : Number.NEGATIVE_INFINITY,
      end: parsed.to !== undefined ? endOf(parsed.to) : Number.POSITIVE_INFINITY,
    };
  }
  if (parsed.year === undefined) {
    // A bound with no year covers everything, as it always has.
    return { start: Number.NEGATIVE_INFINITY, end: Number.POSITIVE_INFINITY };
  }
  if (parsed.kind === "before") {
    return { start: Number.NEGATIVE_INFINITY, end: instantOf(parsed) };
  }
  if (parsed.kind === "after") {
    return { start: instantOf(parsed), end: Number.POSITIVE_INFINITY };
  }
  return { start: instantOf(parsed), end: endOf(parsed) };
}

/**
 * Compare two bounds as the periods they cover.
 *
 * Two bounds that overlap compare equal, so a date inside a year is
 * inside that year however precise either was written. This is what
 * makes a range inclusive at both ends: "until 1815" covers 1815-06-18,
 * and not only the first instant of 1815.
 *
 * This is deliberately not a total order - "1815" equals "1815-06-18",
 * and both equal "1815-12-31". To sort, use `compareOrder`.
 */
export function compareBounds(a: DateBound, b: DateBound): number {
  const left = periodOf(a);
  const right = periodOf(b);
  if (left.end < right.start) {
    return -1;
  }
  if (left.start > right.end) {
    return 1;
  }
  return 0;
}

/**
 * Compare two bounds in the order of time.
 *
 * This is the total order: every kind of date has one place in it. A
 * range sorts by its start, a date that reaches back or forward sorts
 * just outside the bound it names, and the less precise of two dates at
 * the same moment comes first.
 *
 * For whether one bound covers another, use `compareBounds`.
 */
export function compareOrder(a: DateBound, b: DateBound): number {
  return compareKeys(orderKey(a), orderKey(b));
}

/** Compare two sort keys, part by part. */
function compareKeys(keyA: number[], keyB: number[]): number {
  for (let index = 0; index < keyA.length; index += 1) {
    if (keyA[index] < keyB[index]) {
      return -1;
    }
    if (keyA[index] > keyB[index]) {
      return 1;
    }
  }
  return 0;
}

/**
 * Compare two dates in the order of time.
 *
 * The same total order as `compareOrder`; this name is what the rest of
 * the core reaches for.
 */
export function compareDates(a: ParsedDate, b: ParsedDate): number {
  return compareOrder(a, b);
}

/** The bounds a date covers: one for a plain date, two for a range. */
export function dateBounds(date: ParsedDate): DateBound[] {
  if (date.kind === "range" && date.from !== undefined && date.to !== undefined) {
    return [date.from, date.to];
  }
  return [date];
}

/** Display always uses the raw text the creator wrote. */
export function formatDate(date: DateBound): string {
  return date.raw;
}
