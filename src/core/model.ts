/**
 * The resolved world: the model the viewer actually reads.
 *
 * The viewer never sees YAML or raw records. It gets this: ids resolved,
 * names turned into references, dates parsed. A `world.json` file is just
 * this object, serialised.
 */

import type { Chapters } from "./chapters.js";
import type { CalendarSpec, ParsedDate } from "./dates.js";

export interface ResolvedMapImage {
  /** The file as the creator wrote it. */
  file: string;
  /** Site-relative path, filled in by the build. */
  path?: string;
  from?: ParsedDate | undefined;
  until?: ParsedDate | undefined;
  caption?: string | undefined;
}

export interface ResolvedMap {
  id: string;
  name: string;
  /** The map this one sits inside. */
  parent?: string | undefined;
  /** Pixel size of the map images. */
  size?: [number, number] | undefined;
  /** Image attribution, shown in the corner of the map. */
  credit?: string | undefined;
  images: ResolvedMapImage[];
}

export interface ResolvedLocation {
  id: string;
  name: string;
  aliases: string[];
  /** "mobile" for ships, armies, caravans. */
  kind?: "mobile" | undefined;
  /** The map this location sits on. */
  map?: string | undefined;
  /** Pixel position on that map. */
  at?: [number, number] | undefined;
  /** A sub-map this location opens. */
  opens?: string | undefined;
  /** When the location exists. Both ends are inclusive. */
  exists?: { from?: ParsedDate | undefined; until?: ParsedDate | undefined } | undefined;
  /** Where a mobile location is over time. */
  stays: ResolvedStay[];
  tags: string[];
  card?: string | undefined;
  bio?: string | undefined;
  image?: string | undefined;
}

export interface ResolvedStay {
  /** The location id, or the mobile location this person was aboard. */
  at: string;
  from?: ParsedDate | undefined;
  until?: ParsedDate | undefined;
}

export interface ResolvedPerson {
  id: string;
  name: string;
  aliases: string[];
  born?: ParsedDate | undefined;
  died?: ParsedDate | undefined;
  /** Path colour when this person is traced. */
  color?: string | undefined;
  /** Where this person was over time. */
  stays: ResolvedStay[];
  tags: string[];
  bio?: string | undefined;
  image?: string | undefined;
}

export interface ResolvedEvent {
  id: string;
  title: string;
  when: ParsedDate;
  /** The end of a period event. Inclusive; never before `when`. */
  until?: ParsedDate | undefined;
  /** Either a location on the map, or a raw point. */
  where?: { location?: string | undefined; map?: string | undefined; at?: [number, number] | undefined } | undefined;
  /** Person ids. */
  people: string[];
  /** Location ids. */
  locations: string[];
  tags: string[];
  /** Tie-break inside one date. */
  order?: number | undefined;
  /** The chapter the event belongs to, in a world that also has dates. */
  chapter?: number | string | undefined;
  card?: string | undefined;
  sources?: string[] | undefined;
}

export interface ResolvedWorld {
  title: string;
  /** The map the viewer opens on. */
  overworld?: string | undefined;
  calendar?: CalendarSpec | undefined;
  /** Chapter titles, when the world orders by chapter. */
  chapters?: Chapters | undefined;
  start?: ParsedDate | undefined;
  end?: ParsedDate | undefined;
  maps: ResolvedMap[];
  locations: ResolvedLocation[];
  people: ResolvedPerson[];
  events: ResolvedEvent[];
}
