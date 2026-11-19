# Timewright agent guide

You are writing a **world**: a folder of YAML that Timewright turns into an
interactive map. A world has maps, locations, people and events. You never
write pixel coordinates by guessing — you write names, and the creator places
them with `timewright pick`.

## The shape of a world

```
my-world/
  world.yaml        title, calendar, which map to open on
  maps/
    europe.yaml     map definitions
    europe-1800.jpg map images
  people/
    napoleon.yaml   one file per person, or one list per file
  locations/
  events/
```

Both layouts work: one file per record (good for git) or one list per file
(good when pasting a whole timeline at once). File names do not matter.

## The records

**world.yaml** — the only required file.

```yaml
format: 1                # the world format version; write it into new worlds
title: Napoleonic Europe
overworld: europe        # the map to open on (a map id or name)
calendar: gregorian      # or a custom calendar, see below
start: 1769              # optional: the default timeline span
end: 1821
```

**maps** — one map per place you can zoom into.

```yaml
- id: europe
  name: Europe
  size: [4000, 3000]          # image pixel size; read from the file if omitted
  images:
    - file: europe-1800.jpg   # relative to this file, or to the world folder
      until: 1812
    - file: europe-1815.jpg
      from: 1812
- id: london
  name: London
  parent: europe              # for the breadcrumb
  images:
    - file: london.png
```

Ranges are inclusive at both ends: `from` and `until` both include the date
they name.

**locations** — places, and the things that move.

```yaml
- name: London
  map: europe                 # which map it sits on
  at: [2120, 1180]           # pixel position on that map
  opens: london               # a sub-map this location opens
  tags: [city, britain]

- name: Nostalgia for Infinity
  kind: mobile                # ships, armies, caravans: anything that moves
  stays:                      # where it is over time
    - { at: Resurgam, from: 2524, until: 2546 }
```

**people** — who is in the story.

```yaml
- name: Napoleon Bonaparte
  aliases: [Napoleon, Bonaparte]
  born: 1769-08-15
  died: 1821-05-05
  color: "#1f4fa0"            # the path colour when traced
  bio: |
    Markdown. Shown on their card.
  stays:                      # where they were, over time
    - { at: Elba, from: 1814-05, until: 1815-02 }
    - { at: Nostalgia for Infinity, from: 2524 }   # aboard a ship
```

**events** — what happened.

```yaml
- title: Battle of Waterloo
  when: 1815-06-18
  where: Waterloo             # a location name...
  # where: { map: europe, at: [2290, 1265] }   # ...or a raw point
  people: [Napoleon, Wellington]
  tags: [battle]
  order: 2                    # tie-break inside one date
  card: |
    Markdown: what happened.
  sources: ["Chandler, Campaigns of Napoleon, ch. 98"]
```

An event with no `where` is allowed: it has no map marker but still appears
on the timeline.

## Dates

Write the date the way you mean it. Timewright never rejects a date it
understands.

| Form | Example |
|---|---|
| Year | `1815`, `-480`, `2524` |
| Year and month | `1815-06` |
| Full date | `1815-06-18` |
| Approximate | `~1200`, `c. 1200` |
| Range | `1805..1807` |
| Before / after | `<2300`, `>2300` |
| Era | `AF 312`, `312 AF` |

A custom calendar goes in `world.yaml`:

```yaml
calendar:
  months: [Hammer, Alturiak, Ches]     # or a count: 13
  days_per_month: 30                    # or one count per month
  eras:
    - { name: DR, start: 0 }
    - { name: AF, start: 1200 }         # AF 1 is absolute year 1201
```

## A world without dates

Order events by chapter instead. Write the chapter number as `when:`
(`when: 3`), use `order:` to sort events inside one chapter, and put a
`chapters:` map in world.yaml to give the numbers titles:

```yaml
chapters:
  1: Arrival
  2: The Storm
```

Do not mix chapters and dates in one world — pick one axis. Ranges and
approximations still work: `3..5`, `~3`. The Studio and the viewer pick
chapters from a list when the chapters map is present.

## References are names

Write `"where: Waterloo"`, not an id. Names, aliases and ids all resolve, and
an unknown name is reported with a suggestion of what was meant. So write
`people: [Napoleon]` and it finds Napoleon Bonaparte.

A map is the exception: it is referenced by its id, as in `map: europe`. Give
a map an explicit `id:` when you write it, and the id stays put whatever the
map is renamed to.

## Working with an agent

The loop is: **write → validate → fix**. `timewright validate --json` returns
the problems as machine-readable objects:

```json
{
  "errors": [
    {
      "code": "unknown-reference",
      "message": "unknown person \"Napolon\"",
      "file": "events/events.yaml",
      "record": "Battle of Waterloo",
      "field": "people",
      "suggestion": "Did you mean \"Napoleon Bonaparte\"?"
    }
  ],
  "warnings": []
}
```

Errors stop the build. Warnings do not: an event that names a place nobody
has created yet is a warning, not an error — the creator places it later.

## A worked example

From this biography:

> Ada Keene commanded the lighthugger *Nostalgia for Infinity* from 2620,
> when she took it to Delta Pavonis, until 2651, when it reached 61 Cygni.

Write:

```yaml
# people/ada-keene.yaml
- name: Ada Keene
  aliases: [Keene]
  tags: [captain]
  bio: |
    Commanded the Nostalgia for Infinity.

# locations/locations.yaml
- name: Nostalgia for Infinity
  kind: mobile
  tags: [vessel, lighthugger]
  stays:
    - { at: Delta Pavonis, from: 2620, until: 2633 }
    - { at: 61 Cygni, from: 2651 }

- name: Delta Pavonis
  map: region

- name: 61 Cygni
  map: region

# events/events.yaml
- title: Keene takes the Nostalgia for Infinity to Delta Pavonis
  when: 2620
  where: Delta Pavonis
  people: [Ada Keene]
  tags: [voyage]
```

The two locations have no `at` yet, so `timewright validate` will report them
as needing placement. That is expected: the creator places them on the map
with `timewright pick`, and the coordinates are written into the YAML.

## What not to do

- Do not invent pixel coordinates. Names first; the creator places.
- Do not write ids for places and people. Names and aliases are what a human
  can read. (Maps carry an id — give those one.)
- Do not put secrets in the world. It is published with the site.
- Do not repeat a place as two records. Aliases exist for that.

## The commands

```bash
timewright validate --world .          # check it
timewright validate --world . --json   # check it, for an agent
timewright schema                      # the JSON Schema, if you want the rules
timewright pick --world .              # place locations (a local page)
timewright build --world . --out dist  # build the site
```
