# The world format

Every field, and what it means. The [agent guide](AGENT_GUIDE.md) is the
short version; this is the reference.

## The folder

```
my-world/
  world.yaml        the world
  maps/
    <map>.yaml      map definitions, one file or one list
    <image>.png     map images (png, jpg, webp, gif, bmp or svg)
  people/
  locations/
  events/
```

A folder of YAML may hold one record per file, or a list of records in one
file. Both are read. File names do not have to match anything.

Records are found by *name*, not by file: `where: Waterloo` finds the
location called Waterloo, and its aliases answer too. Ids are accepted as
well, and are used as the slug when a record has no explicit `id`.

### Ids and references

An `id` is permanent. Once a record has one, it keeps it — the Studio
writes an `id:` into every record it makes, and a rename leaves it alone. A
record with no `id` gets one from its name, so renaming it moves the id
too.

How a reference is written:

| Reference | Written as | Example |
|---|---|---|
| a map | its id | `map: europe` |
| a place | its name | `where: Waterloo` |
| a person | its name | `people: [Napoleon Bonaparte]` |

Both spellings are read, so a world written by hand is never wrong. The
writers follow the table, so the Studio, the picker and the agent guide
all write the same way.

Renaming a record in the Studio carries the references that pointed at it:
the events at the place, the stays of the people who were there, the maps
that sit inside a renamed map. When the new name answers to another record
as well, the references are left alone and `timewright validate` says so.

## world.yaml

| Field | Type | Meaning |
|---|---|---|
| `title` | string, required | the world's name |
| `overworld` | string | the map the viewer opens on |
| `calendar` | string or object | `gregorian`, or a custom calendar (below) |
| `start` | date | the default timeline span, from |
| `end` | date | the default timeline span, to |
| `maps` | list | map definitions, if you would rather not use `maps/` |
| `settings` | object | anything you want to keep with the world |

`start` and `end` set the range the timeline covers. Without them, the range
runs from the first event to the last. Events that have no place on the map do
not widen the range — one background event six centuries early would squash
the years that have a map into a sliver.

## A custom calendar

```yaml
calendar:
  months: [Hammer, Alturiak, Ches, …]   # names, or a count: 13
  days_per_month: 30                    # or one count per month
  eras:
    - { name: DR, start: 0 }
    - { name: AF, start: 1200 }          # AF 1 is absolute year 1201
```

An era's `start` is the absolute year of era year 0, so era year *n* is
`start + n`.

## maps

| Field | Type | Meaning |
|---|---|---|
| `id` | string | the map's id; defaults to a slug of its name |
| `name` | string, required | shown in the breadcrumb |
| `aliases` | list | other names for the map |
| `file` | string | one image, for a map that never changes |
| `images` | list | images, each with a date range |
| `size` | [width, height] | the image's pixel size; read from the file when omitted |
| `parent` | string | the map this one sits inside, for the breadcrumb |
| `tags` | list | free tags |
| `notes` | string | never shown |
| `sources` | list | where the facts came from |

Each image:

| Field | Type | Meaning |
|---|---|---|
| `file` | string, required | the image file |
| `from` | date | from this date on |
| `until` | date | up to and including this date |
| `caption` | string | shown in the card |

The image covering the current date is the one shown. If none covers it, the
nearest earlier one is used. **Every image of a map must have the same pixel
size**, or locations would move between them — that is an error.

## locations

| Field | Type | Meaning |
|---|---|---|
| `name` | string, required | the place's name |
| `id` | string | the id; defaults to a slug of the name |
| `kind` | `mobile` | for ships, armies, caravans: anything that moves |
| `aliases` | list | other names |
| `map` | string | the map it sits on |
| `at` | [x, y] | its pixel position on that map |
| `opens` | string | a sub-map this location opens |
| `exists` | object | `from` and `until`: when the place exists |
| `stays` | list | where a mobile location is over time |
| `tags` | list | free tags |
| `card` | string | Markdown, shown on the place's card |
| `bio` | string | Markdown, shown if there is no card |
| `image` | string | a picture of the place |
| `notes` | string | never shown |
| `sources` | list | where the facts came from |

A stay:

| Field | Type | Meaning |
|---|---|---|
| `at` | string, required | a location name — or a mobile location, meaning "aboard" |
| `from` | date | from this date |
| `until` | date | up to and including this date |
| `note` | string | never shown |

A mobile location has no `at`: its position comes from its stays. Where
nothing is known, it is simply not drawn, rather than being guessed at.

## people

| Field | Type | Meaning |
|---|---|---|
| `name` | string, required | the person's name |
| `id` | string | the id; defaults to a slug of the name |
| `aliases` | list | other names — another name for the same person, not a second person |
| `born` | date | |
| `died` | date | |
| `color` | string | the path colour when traced |
| `stays` | list | where they were, over time |
| `tags` | list | free tags |
| `bio` | string | Markdown, shown on their card |
| `image` | string | a portrait |
| `notes` | string | never shown |
| `sources` | list | where the facts came from |

## events

| Field | Type | Meaning |
|---|---|---|
| `title` | string, required | what happened |
| `id` | string | the id; defaults to a slug of the title |
| `when` | date, required | when it happened |
| `where` | string or object | a location name, or `{ map: …, at: [x, y] }` |
| `people` | list | who took part |
| `locations` | list | other places involved |
| `tags` | list | free tags |
| `order` | number | tie-break inside one date |
| `card` | string | Markdown, shown on the event's card |
| `notes` | string | never shown |
| `sources` | list | where the facts came from |

An event with no `where` has no map marker, and still appears on the timeline.

## Dates

| Form | Example | Meaning |
|---|---|---|
| Year | `1815`, `-480`, `2524`, `99999` | year only |
| Year and month | `1815-06` | |
| Full date | `1815-06-18` | |
| Approximate | `~1200`, `c. 1200` | shown with "c." |
| Range | `1805..1807` | spans it; sorts by its start |
| Before | `<2300` | |
| After | `>2300` | |
| Era | `AF 312`, `312 AF`, `3E 201` | needs a calendar with that era |

Rules:

- A date is parsed into a year, and optionally a month and a day. Both are
  always optional.
- **Out-of-range months and days are allowed and produce a warning, not an
  error.** "40th of Thirdmonth" builds. Only text that cannot be read at all
  is an error.
- Missing parts sort before present ones: `1815` sorts before `1815-06`.
- **Display always uses the raw text** you wrote.
- Ranges are **inclusive at both ends**. `from` and `until` both include the
  date they name.
- The Gregorian calendar is the default but is not enforced: February 30
  warns, it does not fail.

## Paths and movement

A person's path is derived, never stored:

1. Every event they appear in places them at that event's place.
2. Stays fill the gaps. A stay at a mobile location means "aboard": the
   person follows that vessel.
3. The path is those points in date order. Consecutive points on the same map
   draw a line; a move to another map shows a marker.

## Validation

`timewright validate` reports:

- **Errors** — the build stops. Unknown references, duplicate ids, a map
  whose images have different sizes, a date that cannot be read, a loop in
  the map parents.
- **Warnings** — the build continues. A location with no position yet, an
  unknown field, a person born after they died, two records answering to
  one name.

Unknown fields are kept, not rejected: agents add extras, and the world still
builds. `--strict` turns warnings into errors.

`--json` returns the issues as objects, with `file`, `record`, `field`,
`message` and `suggestion`, so an agent can loop: write, validate, fix.
