/**
 * A very small store: the world, where we are, what date we are at, and
 * what is open.
 */

import type { ParsedDate } from "../core/dates.js";
import type { ResolvedWorld } from "../core/model.js";

export type SelectionKind = "event" | "location" | "person";

export interface Selection {
  kind: SelectionKind;
  id: string;
}

export interface AppState {
  world: ResolvedWorld;
  /** The map on screen. */
  mapId: string;
  /** The date the map is showing. */
  date?: ParsedDate | undefined;
  /** What is open in the card. */
  selection?: Selection | undefined;
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
    if (changed.size === 0) {
      return;
    }
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state, changed);
    }
  }

  subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }
}
