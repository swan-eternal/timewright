/**
 * The timeline: a strip showing the visible span, and an overview bar above
 * it showing the whole range with draggable window + resize handles.
 */

import { dateFraction, fractionDate, type TimeDomain } from "../core/scale.js";
import { eventHasPosition, sortedEvents } from "../core/derive.js";
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
  handle: "window" | "left" | "right" | "playhead";
  startFraction: number;
  fromFraction: number;
  toFraction: number;
}

const MIN_SPAN = 0.015;

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
    activeEventId?: string,
  ): void {
    this.domain = domain;
    this.span = span;
    this.date = date;
    this.renderContext(world);
    this.renderStrip(world, tickEventIds, activeEventId);
  }

  private renderContext(world: ResolvedWorld): void {
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
    const width = Math.max(Math.abs(to - from), 0.01) * 100;

    // Mini density pips inside the overview bar
    const pips = world.events
      .map((ev) => {
        const f = dateFraction(ev.when, domain) * 100;
        return `<span class="context-pip" style="left:${f.toFixed(2)}%"></span>`;
      })
      .join("");

    context.innerHTML = `${pips}<div class="context-window" data-handle="window" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"><span class="context-edge" data-handle="left" title="Drag start of visible span"></span><span class="context-edge" data-handle="right" title="Drag end of visible span"></span></div>`;
  }

  private renderStrip(
    world: ResolvedWorld,
    tickEventIds?: Set<string>,
    activeEventId?: string,
  ): void {
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

    // Stack ticks slightly when several share the same horizontal spot
    const buckets = new Map<number, number>();
    const ticks = events
      .map((event) => {
        const raw = dateFraction(event.when, span);
        const pinned = raw < 0 || raw > 1;
        const fraction = Math.min(Math.max(raw, 0), 1);
        const bucket = Math.round(fraction * 80);
        const stack = buckets.get(bucket) ?? 0;
        buckets.set(bucket, stack + 1);

        const isGeneral = !eventHasPosition(world, event);
        const isActive = activeEventId === event.id;
        const classes = [
          "tick",
          pinned ? "pinned" : "",
          isGeneral ? "general" : "",
          isActive ? "active" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const topRem = 0.85 + Math.min(stack, 2) * 0.48;
        const kindLabel = isGeneral ? " (Timeline event)" : "";
        return `<button type="button" class="${classes}" data-event="${escapeHtml(event.id)}" style="left:${(fraction * 100).toFixed(2)}%;top:${topRem.toFixed(2)}rem" title="${escapeHtml(event.when.raw)} — ${escapeHtml(event.title)}${kindLabel}"></button>`;
      })
      .join("");

    const playhead = this.date !== undefined ? dateFraction(this.date, span) * 100 : 0;
    strip.innerHTML = [
      '<div class="strip-line"></div>',
      ticks,
      `<div class="playhead" style="left:${playhead.toFixed(2)}%"><span class="playhead-knob"></span></div>`,
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
    const handle = target.dataset.handle;
    if (handle === "window" || handle === "left" || handle === "right") {
      event.preventDefault();
      this.drag = {
        handle,
        startFraction: this.fractionAt(event, this.options.context),
        fromFraction: dateFraction(span.from, domain),
        toFraction: dateFraction(span.to, domain),
      };
      return;
    }
    // Clicking outside the window jumps the visible window center there
    const clicked = this.fractionAt(event, this.options.context);
    const width = Math.max(dateFraction(span.to, domain) - dateFraction(span.from, domain), MIN_SPAN);
    const from = Math.min(Math.max(clicked - width / 2, 0), 1 - width);
    const to = Math.min(1, from + width);
    this.options.onSpan({
      from: fractionDate(from, domain),
      to: fractionDate(to, domain),
    });
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === undefined) {
      return;
    }
    if (drag.handle === "playhead") {
      if (this.span !== undefined) {
        this.options.onDate(fractionDate(this.fractionAt(event, this.options.strip), this.span));
      }
      return;
    }
    const domain = this.domain;
    if (domain === undefined) {
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
    event.preventDefault();
    this.drag = {
      handle: "playhead",
      startFraction: 0,
      fromFraction: 0,
      toFraction: 1,
    };
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
