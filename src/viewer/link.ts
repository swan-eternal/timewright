/**
 * Deep links. The whole view can be written down in the address bar:
 * `#map=london&date=1815-06-18&span=1812..1815&trace=napoleon&event=waterloo`
 */

export interface LinkState {
  map?: string;
  date?: string;
  span?: string;
  trace?: string;
  /** Comma-separated ids of traces shown together on the map. */
  traces?: string;
  event?: string;
  query?: string;
}

const KEYS = ["map", "date", "span", "trace", "traces", "event", "query"] as const;

export function readLink(hash: string): LinkState {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  const state: LinkState = {};
  for (const part of text.split("&")) {
    if (part === "") {
      continue;
    }
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index);
    let value: string;
    try {
      value = decodeURIComponent(part.slice(index + 1));
    } catch {
      // A stray "%" is not a value. The link is read without it, rather
      // than the whole viewer failing to start.
      continue;
    }
    if ((KEYS as readonly string[]).includes(key)) {
      state[key as keyof LinkState] = value;
    }
  }
  return state;
}

export function writeLink(state: LinkState): string {
  const parts: string[] = [];
  if (state.map !== undefined) {
    parts.push(`map=${encodeURIComponent(state.map)}`);
  }
  if (state.date !== undefined) {
    parts.push(`date=${encodeURIComponent(state.date)}`);
  }
  if (state.span !== undefined) {
    parts.push(`span=${encodeURIComponent(state.span)}`);
  }
  if (state.trace !== undefined) {
    parts.push(`trace=${encodeURIComponent(state.trace)}`);
  }
  if (state.traces !== undefined) {
    parts.push(`traces=${encodeURIComponent(state.traces)}`);
  }
  if (state.event !== undefined) {
    parts.push(`event=${encodeURIComponent(state.event)}`);
  }
  if (state.query !== undefined) {
    parts.push(`query=${encodeURIComponent(state.query)}`);
  }
  return parts.length > 0 ? `#${parts.join("&")}` : "";
}
