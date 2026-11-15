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

/** A date as a number of years, so two dates can be compared. */
export function dateValue(date: DateBound): number {
  const year = date.year ?? 0;
  const month = (date.month ?? 1) - 1;
  const day = (date.day ?? 1) - 1;
  return year + month / 12 + day / 365.25;
}

/** Compare two dates that may only be a year apart. */
export function compareDateBounds(a: DateBound, b: DateBound): number {
  return dateValue(a) - dateValue(b);
}

/** Sort key for one bound. Missing parts sort before present ones. */
export function sortKey(bound: DateBound): number[] {
  return [
    bound.year ?? Number.NEGATIVE_INFINITY,
    bound.month ?? Number.NEGATIVE_INFINITY,
    bound.day ?? Number.NEGATIVE_INFINITY,
  ];
}

export function compareBounds(a: DateBound, b: DateBound): number {
  const keyA = sortKey(a);
  const keyB = sortKey(b);
  for (let index = 0; index < 3; index += 1) {
    if (keyA[index] < keyB[index]) {
      return -1;
    }
    if (keyA[index] > keyB[index]) {
      return 1;
    }
  }
  return 0;
}

/** Sort key for a whole date, including ranges and bounded dates. */
export function effectiveSortKey(date: ParsedDate): number[] {
  if (date.kind === "range") {
    return date.from !== undefined
      ? sortKey(date.from)
      : [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  }
  const key = sortKey(date);
  if (date.year !== undefined) {
    if (date.kind === "before") {
      key[0] = date.year - 0.25;
    }
    if (date.kind === "after") {
      key[0] = date.year + 0.25;
    }
  }
  return key;
}

export function compareDates(a: ParsedDate, b: ParsedDate): number {
  const keyA = effectiveSortKey(a);
  const keyB = effectiveSortKey(b);
  for (let index = 0; index < 3; index += 1) {
    if (keyA[index] < keyB[index]) {
      return -1;
    }
    if (keyA[index] > keyB[index]) {
      return 1;
    }
  }
  return 0;
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
