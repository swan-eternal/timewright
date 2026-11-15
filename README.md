# Timewright

Build interactive timeline maps of real history or fiction from plain YAML files.

A world is a folder of YAML: maps (images), locations, people and events. Timewright
validates the world, resolves names and aliases, and derives timelines and paths.
The viewer turns that into a map you can step through.

## Status

Phase 0 and Phase 1 of the implementation plan are built. What exists today:

- `timewright validate` — checks a world folder and explains what to fix
- `timewright schema` — prints the JSON Schema for the world format
- Core library: flexible dates, custom calendars, name/alias resolution, cross-record validation

The viewer, timeline strip, tracing and map rendering are not built yet (Phases 2-3).

## Usage

```bash
npm install -g timewright      # or: npx timewright
timewright validate --world ./my-world
timewright schema > schema.json
```

`--json` gives machine-readable output, `--strict` treats warnings as errors.
Both are meant for agents: write YAML, validate, fix what the validator names.

## World folder

```
my-world/
  world.yaml            title, calendar, overworld, start/end
  maps/
    europe.yaml         map definitions
    europe-1800.jpg     map images
  people/
    napoleon.yaml       one file per person, or one list per file
  locations/
  events/
```

A full format guide ships with the package (`docs/AGENT_GUIDE.md`, `docs/FORMAT.md`)
once Phase 5 lands.

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
