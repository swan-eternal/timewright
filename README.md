# Timewright

Build interactive timeline maps of real history or fiction from plain YAML files.

A world is a folder of YAML — maps, locations, people, events. Timewright
validates it, resolves the names, and builds a site you can step through:
click a date, follow a person across the map, read their card.

```bash
npm install -g github:swan-eternal/timewright
timewright init my-world
cd my-world
timewright validate
timewright pick          # place the locations on the map
timewright build --out dist
```

No database, no server, no build toolchain to learn. The output is a folder of
static files that any web host can serve.

## Install

```bash
npm install -g github:swan-eternal/timewright
```

That installs from GitHub, and npm does the work: it clones the repository,
builds it, and puts the `timewright` command on your path. There is no account
to make and nothing to sign up for.

If it reaches npm one day, the install line becomes `npm install -g
timewright` and nothing else changes — the command is the same either way.

## What a world looks like

```
my-world/
  world.yaml            title, calendar, which map to open on
  maps/
    europe.yaml         map definitions
    europe-1800.jpg     map images (png, jpg, webp, gif, bmp or svg)
  people/
    napoleon.yaml       one file per person, or one list per file
  locations/
  events/
```

```yaml
- title: Battle of Waterloo
  when: 1815-06-18
  where: Waterloo
  people: [Napoleon]
  card: |
    The last battle of the Napoleonic Wars.
```

Dates are flexible on purpose: `1815`, `1815-06`, `~1200`, `1805..1807`,
`<2300`, and custom calendars with named months and eras. A date that reads
as impossible warns; it does not fail.

**The format:** [docs/FORMAT.md](docs/FORMAT.md) is the reference.
[docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md) is the short version, written for
an agent — point your agent at it and let it write the YAML for you.

## The commands

| Command | What it does |
|---|---|
| `timewright init [folder]` | Make a starter world |
| `timewright validate` | Check a world folder and explain what to fix |
| `timewright build` | Build a world into a static site |
| `timewright dev` | Run the viewer locally, reloading when the world changes |
| `timewright pick` | Pick coordinates on a map, and place locations |
| `timewright edit` | Edit the world in the browser |
| `timewright schema` | Print the JSON Schema for the world format |

Useful flags: `--json` (machine-readable validation, for agents), `--strict`
(warnings become errors), `--base /repo/` (the path a site is served from),
`--single-file` (also write one self-contained HTML file).

## Publishing on GitHub Pages

1. Make the world its own repository, with the workflow from
   [templates/github-pages](templates/github-pages/.github/workflows/pages.yml).
2. Put the world files at the root of the repository.
3. Push. The workflow builds the site and publishes it.

The workflow installs the tool from GitHub, so nothing has to be published to
npm first.

The `--base` flag matters: GitHub Pages serves a project site from
`/repository-name/`, and the build has to know that. The template workflow
already passes it.

To publish somewhere else, build it and upload the folder:

```bash
timewright build --world . --out dist
```

To send one file instead of a site — by email, on a memory stick, anywhere:

```bash
timewright build --world . --out dist --single-file
```

`dist/world.html` then holds the world, the viewer and the map images all
together.

## Placing locations

Agents know names, not pixels, so you do not write coordinates:

```yaml
- name: Waterloo
  map: europe
```

`timewright validate` says "needs placing", and `timewright pick` opens a
local page where you click the map and the coordinates are written into the
YAML — comments and all. It binds to 127.0.0.1 and is never deployed.

## Editing a world

`timewright edit` opens the world in the browser: the map with everything on
it, a list of locations, people and events, and a form for whichever one you
click.

### Starting it

Double-click `start-studio.sh` — or `start-studio.cmd` on Windows. It builds
the tool if it needs building, starts the editor and opens it in your
browser:

```bash
./start-studio.sh                 # a world in this folder, or the example
./start-studio.sh ~/my-world      # a world folder
```

The same thing from an installed package, without the script:

```bash
npx timewright edit --world ~/my-world
```

### What you can do in it

- Click the map to make a location or an event there.
- Drag a marker to move it.
- Edit names, dates, tags and cards in the form.
- Upload a new map image.
- Delete a record you no longer want.

Rename a record and the references that pointed at it follow it: the events
at the place, the stays of the people who were there, the maps that sit
inside a renamed map.

Everything is written into the same YAML files, in place, comments and all.
The files stay the source of truth, so an agent can keep working on a world
you have been editing by hand. Every record the Studio writes gets a
permanent `id:`, so a rename never breaks a reference.

### The Studio keeps a clock

The Studio draws the world *at a moment*, not all at once. A bar under the
canvas holds the current date: type one, step through the events with
‹ Prev / Next ›, drag the playhead, or click a tick. Switch between **At
Date** and **All Time**.

- The map image follows the date — a world with a different map for each era
  shows the right one.
- A ship or an army (a mobile place) appears wherever it was that day, and
  the people aboard it are found there too.
- A place that did not exist yet is dimmed until it does.
- Saving an event moves the Studio's own clock to that event's date.

### The tabs run in the order you work

**Maps → People → Locations → Events → World**, each carrying a count.

- Making a place or an event opens a form of its own, filled in with what you
  already know — the map, the spot you clicked, the day on the clock.
- An event's characters are pills you click, so a name cannot be misspelled.
- A location carries the count of the events that happened there, and its form
  lists them.

## Checking on a phone

The viewer is built for a phone first. When you publish, look at it on one:

- [ ] The map fills the screen; the card slides up from the bottom.
- [ ] The step bar and the timeline strip are reachable with a thumb, and
      their buttons are big enough to hit.
- [ ] Dragging the map does not scroll the page.
- [ ] The overview bar above the strip can be dragged with one finger.
- [ ] A card with a long biography scrolls without moving the map.
- [ ] The map image is not blurry when zoomed in.
- [ ] Rotating the phone does not leave the layout half-broken.

## Examples

Two worlds ship with the source, and both are built by the same commands:

- `examples/napoleon` — small, hand-drawn SVG maps, the Gregorian path.
- `examples/revelation-space` — 11 maps, 46 locations, 14 people and 16
  events, converted from the Revelation Space map project. Multi-level maps,
  vessels that carry people, dates a century out.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Requires Node 22 or newer. CI runs the build on Windows, macOS and Ubuntu.

## Licence

MIT.
