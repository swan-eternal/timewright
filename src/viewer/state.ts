import type { DateBound } from "../core/dates.js";
import type { ResolvedWorld } from "../core/model.js";
import type { Span } from "../core/steps.js";

export type SelectionKind = "event" | "location" | "person";

export interface Selection {
  kind: SelectionKind;
  id: string;
}

/** "span" walks the events in the visible span; "trace" walks one person. */
export type Mode = "span" | "trace";

export interface AppState {
  world: ResolvedWorld;
  /** The map on screen. */
  mapId: string;
  /** The date the map is showing. */
  date?: DateBound | undefined;
  /** The visible span of time. */
  span?: Span | undefined;
  mode: Mode;
  /** The person or vessel being traced. */
  traceId?: string | undefined;
  /** What is open in the card. */
  selection?: Selection | undefined;
  /** Text filter over events, people and locations. */
  query?: string | undefined;
  /** Tags the steps are filtered by. */
  tags?: string[] | undefined;
}

export type Changed = Set<keyof AppState>;
export type Listener = (state: AppState, changed: Changed) => void;

export class Store {
  private state: AppState;
  private readonly listeners: Listener[] = [];

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    const changed: Changed = new Set();
    for (const key of Object.keys(patch) as (keyof AppState)[]) {
      if (this.state[key] !== patch[key]) {
        changed.add(key);
      }
    }
    this.state = { ...this.state, ...patch };
    // Always notify, even when nothing actually changed: a caller that
    // sets a value to refresh the view should not have to know that.
    for (const listener of this.listeners) {
      listener(this.state, changed);
    }
  }

  subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }
}
