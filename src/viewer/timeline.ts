/**
 * The timeline: a strip showing the visible span, and an overview bar above
 * it showing the whole range.
 *
 * The range is bounded by the content - the first event to the last - so
 * there is no outside to stray into. The overview bar is where the reader
 * sees that bound, drags the window across it, and pulls its edges to
 * widen or narrow what the strip shows.
 */

import { dateFraction, fractionDate, type TimeDomain } from "../core/scale.js";
import { sortedEvents } from "../core/derive.js";
import type { DateBound } from "../core/dates.js";
import type { ResolvedWorld } from "../core/model.js";
import type { Span } from "../core/steps.js";
import { escapeHtml } from "./cards.js";

export interface TimelineOptions {
  context: HTMLElement;
  strip: HTMLElement;
  onDate: (date: DateBound) => void;
  onSpan: (span: Span) => void;
  onEvent: (eventId: string) => void;
}

interface DragState {
  handle: "window" | "left" | "right";
  startFraction: number;
  fromFraction: number;
  toFraction: number;
}

/** The narrowest a span may get, as a fraction of the whole range. */
const MIN_SPAN = 0.01;

export class Timeline {
  private readonly options: TimelineOptions;
  private domain?: TimeDomain | undefined;
  private span?: Span | undefined;
  private date?: DateBound | undefined;
  private drag?: DragState;

  constructor(options: TimelineOptions) {
    this.options = options;
    this.bind();
  }

  render(
    world: ResolvedWorld,
    domain: TimeDomain | undefined,
    span: Span | undefined,
    date: DateBound | undefined,
    tickEventIds?: Set<string>,
  ): void {
    this.domain = domain;
    this.span = span;
    this.date = date;
    this.renderContext();
    this.renderStrip(world, tickEventIds);
  }

  private renderContext(): void {
    const context = this.options.context;
    const domain = this.domain;
    const span = this.span;
    if (domain === undefined || span === undefined) {
      context.innerHTML = "";
      return;
    }
    const from = dateFraction(span.from, domain);
    const to = dateFraction(span.to, domain);
    const left = Math.min(from, to) * 100;
    const width = Math.max(Math.abs(to - from), 0.5) * 100;
    context.innerHTML = `<div class="context-window" data-handle="window" style="left:${left}%;width:${width}%"><span class="context-edge" data-handle="left"></span><span class="context-edge" data-handle="right"></span></div>`;
  }

  private renderStrip(world: ResolvedWorld, tickEventIds?: Set<string>): void {
    const strip = this.options.strip;
    const span = this.span;
    if (span === undefined) {
      strip.innerHTML = "";
      return;
    }
    const events = sortedEvents(world).filter((event) => {
      if (tickEventIds !== undefined && !tickEventIds.has(event.id)) {
        return false;
      }
      return true;
    });
    const ticks = events
      .map((event) => {
        const raw = dateFraction(event.when, span);
        // A tick outside the visible span is pinned to the edge: it belongs
        // to no map's era, so it is still worth showing.
        const pinned = raw < 0 || raw > 1;
        const fraction = Math.min(Math.max(raw, 0), 1);
        const className = pinned ? "tick pinned" : "tick";
        return `<button type="button" class="${className}" data-event="${escapeHtml(event.id)}" style="left:${fraction * 100}%" title="${escapeHtml(event.when.raw)} — ${escapeHtml(event.title)}"></button>`;
      })
      .join("");
    const playhead = this.date !== undefined ? dateFraction(this.date, span) * 100 : 0;
    strip.innerHTML = [
      '<div class="strip-line"></div>',
      ticks,
      `<div class="playhead" style="left:${playhead}%"></div>`,
      `<span class="strip-end left">${escapeHtml(span.from.raw)}</span>`,
      `<span class="strip-end right">${escapeHtml(span.to.raw)}</span>`,
    ].join("");
  }

  private bind(): void {
    this.options.context.addEventListener("pointerdown", (event) => this.onContextDown(event));
    this.options.strip.addEventListener("pointerdown", (event) => this.onStripDown(event));
    window.addEventListener("pointermove", (event) => this.onPointerMove(event));
    window.addEventListener("pointerup", () => {
      this.drag = undefined;
    });
  }

  private onContextDown(event: PointerEvent): void {
    const domain = this.domain;
    const span = this.span;
    if (domain === undefined || span === undefined) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const handle = target.dataset.handle ?? "window";
    if (handle !== "window" && handle !== "left" && handle !== "right") {
      return;
    }
    event.preventDefault();
    this.drag = {
      handle,
      startFraction: this.fractionAt(event, this.options.context),
      fromFraction: dateFraction(span.from, domain),
      toFraction: dateFraction(span.to, domain),
    };
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    const domain = this.domain;
    if (drag === undefined || domain === undefined) {
      return;
    }
    const delta = this.fractionAt(event, this.options.context) - drag.startFraction;
    let from = drag.fromFraction;
    let to = drag.toFraction;
    if (drag.handle === "window") {
      const width = to - from;
      from = Math.min(Math.max(from + delta, 0), 1 - width);
      to = from + width;
    } else if (drag.handle === "left") {
      from = Math.min(Math.max(from + delta, 0), to - MIN_SPAN);
    } else {
      to = Math.max(Math.min(to + delta, 1), from + MIN_SPAN);
    }
    this.options.onSpan({
      from: fractionDate(from, domain),
      to: fractionDate(to, domain),
    });
  }

  private onStripDown(event: PointerEvent): void {
    const span = this.span;
    if (span === undefined) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement) {
      const eventId = target.closest<HTMLElement>("[data-event]")?.dataset.event;
      if (eventId !== undefined) {
        event.preventDefault();
        this.options.onEvent(eventId);
        return;
      }
    }
    this.options.onDate(fractionDate(this.fractionAt(event, this.options.strip), span));
  }

  private fractionAt(event: PointerEvent, element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0) {
      return 0;
    }
    return Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  }
}
