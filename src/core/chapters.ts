/**
 * Chapter worlds: the label layer over the numeric axis.
 *
 * A world orders by chapter when its world.yaml carries a `chapters:`
 * map. Ordering does not change — chapter numbers ride the same numeric
 * axis dates do. This module only names what the numbers mean, for the
 * places a reader looks.
 */

/** The chapters of a world, as written: chapter number to title. */
export type Chapters = Record<number, string>;

/** Anything resolved that can carry a chapters map. */
export interface ChapteredWorld {
  chapters?: Chapters | undefined;
}

/** A bound with just enough on it to tell a chapter from a date. */
interface NumberishBound {
  raw: string;
  kind?: string | undefined;
  approx?: boolean | undefined;
  year?: number | undefined;
  month?: number | undefined;
  day?: number | undefined;
}

/** Whether the world's axis counts chapters rather than years. */
export function isChapterWorld(world: ChapteredWorld): boolean {
  return world.chapters !== undefined;
}

/**
 * How a chapter number reads: "Chapter 3 — The Storm" when the world
 * names it, "Chapter 3" when it does not.
 */
export function chapterLabel(world: ChapteredWorld, chapter: number): string {
  const title = world.chapters?.[chapter];
  return title !== undefined && title !== ""
    ? `Chapter ${chapter} — ${title}`
    : `Chapter ${chapter}`;
}

/**
 * The chapter a bound carries, when it is a whole bare number. A date
 * with a month or a day in it is not a chapter; neither is a range, an
 * approximation, or a bound that reaches past its number.
 */
export function chapterOf(bound: NumberishBound): number | undefined {
  if (bound.kind !== undefined && bound.kind !== "exact") {
    return undefined;
  }
  if (bound.approx === true) {
    return undefined;
  }
  if (bound.month !== undefined || bound.day !== undefined) {
    return undefined;
  }
  return bound.year !== undefined && Number.isInteger(bound.year) ? bound.year : undefined;
}

/** A bound with enough on it to tell a calendar date from a chapter number. */
interface CalendarishBound {
  kind?: string | undefined;
  month?: number | undefined;
  day?: number | undefined;
  from?: CalendarishBound | undefined;
  to?: CalendarishBound | undefined;
}

/**
 * Whether a bound carries a real calendar date — a month or a day —
 * rather than a bare chapter number. Range ends count too, so "3..5"
 * stays clean while "3..1815-06" does not.
 */
export function carriesCalendarDate(bound: CalendarishBound): boolean {
  if (bound.kind === "range") {
    return (
      (bound.from !== undefined && carriesCalendarDate(bound.from)) ||
      (bound.to !== undefined && carriesCalendarDate(bound.to))
    );
  }
  return bound.month !== undefined || bound.day !== undefined;
}

/**
 * How a date displays: the chapter label when the world counts chapters
 * and the bound is a whole bare number, the raw text otherwise. "~3"
 * and "3..5" keep their raw text — they already read.
 */
export function displayDate(world: ChapteredWorld, bound: NumberishBound): string {
  if (!isChapterWorld(world)) {
    return bound.raw;
  }
  const chapter = chapterOf(bound);
  return chapter === undefined ? bound.raw : chapterLabel(world, chapter);
}

/**
 * How an event's own chapter reference reads, for a card badge in a
 * world that has dates. A number finds its title; a string shows as
 * written.
 */
export function chapterBadge(world: ChapteredWorld, reference: number | string): string {
  return typeof reference === "number" ? chapterLabel(world, reference) : reference;
}
