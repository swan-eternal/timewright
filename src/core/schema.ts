/**
 * The world format, as Zod schemas.
 *
 * These schemas are the single source of truth: they produce the runtime
 * types, the JSON Schema handed to agents, and the validation errors the
 * creator sees. Unknown fields are kept, not rejected - agents add extras
 * and the world still builds.
 */

import { z } from "zod";

/** A date as written in YAML: a string, or a bare number for a year. */
export const DateLike = z.union([z.string(), z.number()]);

export const EraSchema = z.looseObject({
  name: z.string().min(1),
  start: z.number().int(),
});

export const CalendarSchema = z.looseObject({
  /** Month names, or a count of unnamed months. */
  months: z.union([z.array(z.string().min(1)), z.number().int().positive()]).optional(),
  /** Days per month, or one count per month. */
  days_per_month: z.union([z.number().int().positive(), z.array(z.number().int().positive())]).optional(),
  eras: z.array(EraSchema).optional(),
});

export const MapImageSchema = z.looseObject({
  file: z.string().min(1),
  from: DateLike.optional(),
  until: DateLike.optional(),
  caption: z.string().optional(),
});

export const MapSchema = z.looseObject({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  /** Single-image shorthand for maps that never change. */
  file: z.string().min(1).optional(),
  /** Image pixel size. Read from the file when omitted. */
  size: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  images: z.array(MapImageSchema).optional(),
  /** The map this one sits inside, for breadcrumbs. */
  parent: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  notes: z.string().optional(),
  sources: z.array(z.string().min(1)).optional(),
});

export const StaySchema = z.looseObject({
  /** A location name, or the name of a mobile location to be aboard. */
  at: z.string().min(1),
  from: DateLike.optional(),
  until: DateLike.optional(),
  note: z.string().optional(),
});

/** Pixel coordinates on a map image. */
export const PointSchema = z.tuple([z.number(), z.number()]);

export const WhereSchema = z.union([
  z.string().min(1),
  z.looseObject({
    map: z.string().min(1),
    at: PointSchema,
  }),
]);

export const LocationSchema = z.looseObject({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  /** "mobile" for ships, armies, caravans - anything that moves. */
  kind: z.literal("mobile").optional(),
  aliases: z.array(z.string().min(1)).optional(),
  map: z.string().min(1).optional(),
  /** Pixel position on that map. */
  at: PointSchema.optional(),
  /** A sub-map this location opens. */
  opens: z.string().min(1).optional(),
  /** When the location exists. */
  exists: z
    .looseObject({
      from: DateLike.optional(),
      until: DateLike.optional(),
    })
    .optional(),
  /** Where a mobile location is over time. */
  stays: z.array(StaySchema).optional(),
  tags: z.array(z.string().min(1)).optional(),
  card: z.string().optional(),
  bio: z.string().optional(),
  image: z.string().min(1).optional(),
  notes: z.string().optional(),
  sources: z.array(z.string().min(1)).optional(),
});

export const PersonSchema = z.looseObject({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  born: DateLike.optional(),
  died: DateLike.optional(),
  /** Path colour when this person is traced. */
  color: z.string().optional(),
  /** Where this person is over time. */
  stays: z.array(StaySchema).optional(),
  tags: z.array(z.string().min(1)).optional(),
  image: z.string().min(1).optional(),
  bio: z.string().optional(),
  notes: z.string().optional(),
  sources: z.array(z.string().min(1)).optional(),
});

export const EventSchema = z.looseObject({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  when: DateLike,
  /** A location name, or a raw point on a map. */
  where: WhereSchema.optional(),
  people: z.array(z.string().min(1)).optional(),
  locations: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  /** Tie-break inside one date. */
  order: z.number().optional(),
  card: z.string().optional(),
  notes: z.string().optional(),
  sources: z.array(z.string().min(1)).optional(),
});

export const WorldSchema = z.looseObject({
  title: z.string().min(1),
  /** The map the viewer opens on. */
  overworld: z.string().min(1).optional(),
  calendar: z.union([z.literal("gregorian"), CalendarSchema]).optional(),
  /** Default timeline span. */
  start: DateLike.optional(),
  end: DateLike.optional(),
  /** Maps may be defined here instead of in maps/. */
  maps: z.array(MapSchema).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const WorldBundleSchema = z.looseObject({
  world: WorldSchema,
  maps: z.array(MapSchema),
  people: z.array(PersonSchema),
  locations: z.array(LocationSchema),
  events: z.array(EventSchema),
});

export type EraRecord = z.infer<typeof EraSchema>;
export type CalendarRecord = z.infer<typeof CalendarSchema>;
export type MapImageRecord = z.infer<typeof MapImageSchema>;
export type MapRecord = z.infer<typeof MapSchema>;
export type StayRecord = z.infer<typeof StaySchema>;
export type LocationRecord = z.infer<typeof LocationSchema>;
export type PersonRecord = z.infer<typeof PersonSchema>;
export type EventRecord = z.infer<typeof EventSchema>;
export type WorldRecord = z.infer<typeof WorldSchema>;

/** The field names a schema knows about, for unknown-field warnings. */
export function knownKeys(schema: { readonly shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape);
}

/** The JSON Schema for the whole world format, for agents and editors. */
export function worldJsonSchema(): unknown {
  return z.toJSONSchema(WorldBundleSchema, { io: "input" });
}
