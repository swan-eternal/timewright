/**
 * Name resolution. Creators write names; the data model works in ids.
 * Every reference is resolved at build time, and an unknown name comes back
 * with a suggestion rather than a bare failure.
 */

export interface NameEntry {
  id: string;
  /** Primary display name. */
  name: string;
  /** Every name and alias this record answers to, normalised. */
  keys: string[];
}

export interface NameCollision {
  key: string;
  first: string;
  second: string;
}

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Napoleon Bonaparte" -> "napoleon-bonaparte". */
export function slugify(name: string): string {
  return normalizeName(name).replace(/\s+/g, "-");
}

export class NameIndex {
  private readonly entries: NameEntry[] = [];
  private readonly byKey = new Map<string, string>();
  readonly collisions: NameCollision[] = [];

  add(id: string, name: string, aliases: string[] = []): void {
    const keys: string[] = [];
    for (const candidate of [name, ...aliases]) {
      const key = normalizeName(candidate);
      if (key !== "" && !keys.includes(key)) {
        keys.push(key);
      }
    }
    this.entries.push({ id, name, keys });
    for (const key of keys) {
      const existing = this.byKey.get(key);
      if (existing !== undefined && existing !== id) {
        this.collisions.push({ key, first: existing, second: id });
        continue;
      }
      this.byKey.set(key, id);
    }
  }

  /** The id a reference points at, or undefined when nothing answers to it. */
  resolve(reference: string): string | undefined {
    return this.byKey.get(normalizeName(reference));
  }

  has(reference: string): boolean {
    return this.resolve(reference) !== undefined;
  }

  /** Display names close to a mistyped reference. */
  suggest(reference: string, limit = 3): string[] {
    const key = normalizeName(reference);
    if (key === "") {
      return [];
    }
    const threshold = Math.max(2, Math.floor(key.length / 3));
    const scored: { name: string; distance: number }[] = [];
    for (const entry of this.entries) {
      let best = Number.POSITIVE_INFINITY;
      for (const candidate of entry.keys) {
        const distance = levenshtein(key, candidate);
        if (distance < best) {
          best = distance;
        }
        // Compare against the words too: "Napolon" is close to "Napoleon",
        // not to "Napoleon Bonaparte".
        for (const word of candidate.split(" ")) {
          if (word.length < 3) {
            continue;
          }
          const wordDistance = levenshtein(key, word);
          if (wordDistance < best) {
            best = wordDistance;
          }
        }
      }
      if (best <= threshold) {
        scored.push({ name: entry.name, distance: best });
      }
    }
    scored.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
    return scored.slice(0, limit).map((entry) => entry.name);
  }

  get size(): number {
    return this.entries.length;
  }
}

export function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }
  let previous: number[] = [];
  for (let index = 0; index <= b.length; index += 1) {
    previous[index] = index;
  }
  for (let row = 1; row <= a.length; row += 1) {
    const current: number[] = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}
