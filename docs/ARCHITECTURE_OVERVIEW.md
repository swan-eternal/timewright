# Timewright — Architecture & Extensibility Guide

This guide explains how **Timewright** is structured from end to end: how YAML world files become an interactive timeline map, how the Studio editor modifies those files safely in place, how static website bundles are exported, and where to hook in new features later.

---

## 1. High-Level Design Principles

1. **Plain YAML + Images as the Single Source of Truth**
   Every world is an ordinary folder (`world.yaml`, `maps/`, `locations/`, `people/`, `events/`). There is no database or proprietary project file. Both humans (via the browser Studio) and AI agents / Git workflows edit the exact same YAML files.
2. **Comment-Preserving AST Edits**
   When the Studio or coordinate picker saves changes, `src/cli/world-edit.ts` uses the `yaml` package's CST/AST (`parseDocument`) rather than `JSON.stringify` or re-serializing from scratch. Comments, blank lines, and untouched keys survive browser edits.
3. **Strict Separation of Layers (`core` → `cli` → `viewer`)**
   - `src/core/` is pure TypeScript with **zero DOM or Node filesystem dependencies** (except byte-buffer image header inspection). It parses dates, validates schemas, resolves names/aliases, derives positions over time, and computes timeline steps.
   - `src/cli/` handles filesystem loading, in-place YAML editing, local HTTP tooling (`edit`, `pick`, `dev`), Vite static builds, single-file HTML inlining, and `.zip` archive creation.
   - `src/viewer/` is the standalone browser client compiled by Vite. It never sees raw YAML — it consumes a single resolved `ResolvedWorld` (`world.json` or inline `<script id="world-data">`).
4. **Native Pixel Space on Leaflet `CRS.Simple`**
   Map images use top-left pixel coordinates `[x, y]` in YAML (`[0, 0]` = top-left, `[width, height]` = bottom-right). Both the Viewer (`src/viewer/map.ts`) and Studio (`src/cli/editor.html`) map `[x, y]` to Leaflet `CRS.Simple` coordinates via `L.latLng(imageHeight - y, x)` with bounds `[[0, 0], [imageHeight, imageWidth]]`. Because pins live natively in Leaflet's coordinate space, markers never drift during zoom or pan animations.

---

## 2. Directory & Module Map

```text
timewright/
├── src/
│   ├── core/                  # Pure domain logic (no fs, no DOM)
│   │   ├── schema.ts          # Zod schemas for raw YAML records
│   │   ├── dates.ts           # Flexible date parser & comparators (years, ranges, ~approx, custom calendars/eras)
│   │   ├── resolve.ts         # Slug generation, case-insensitive name/alias lookup, Levenshtein suggestions
│   │   ├── building.ts        # Builds lookup indices (maps, locations, people, events) from raw records
│   │   ├── validate.ts        # Cross-record validation (broken refs, unknown fields, image dimension mismatches)
│   │   ├── derive.ts          # Raw WorldData -> ResolvedWorld; resolves mobile stays, sub-map projections & era images
│   │   ├── steps.ts           # Timeline step lists (`span` mode vs `trace` mode) and traced movement paths
│   │   ├── scale.ts           # Maps dates <-> [0..1] timeline fractions for scrubbing & zoom windows
│   │   ├── images.ts          # Zero-dependency PNG/JPEG/GIF/WebP/BMP/SVG dimension reader
│   │   └── model.ts           # TypeScript interfaces for `ResolvedWorld` (the viewer contract)
│   │
│   ├── cli/                   # Node CLI, Studio server, YAML writer & exporters
│   │   ├── index.ts           # CLI argument parser & command router (`timewright <cmd>`)
│   │   ├── load.ts            # Reads world folder YAML files & inspects map image dimensions
│   │   ├── world-edit.ts      # Comment-preserving YAML CRUD, coordinate moves, map/portrait image saving
│   │   ├── local-server.ts    # Loopback-only (`127.0.0.1`) HTTP server with Origin/Host CSRF protection
│   │   ├── editor.html        # Visual Studio single-page app served by `timewright edit`
│   │   ├── picker.html        # Lightweight coordinate picker served by `timewright pick`
│   │   ├── single-file.ts     # Bundles `index.html` + JS + CSS + base64 images + `world.json` into `world.html`
│   │   ├── zip.ts             # Pure-Node (`node:zlib`) `.zip` archive builder for 1-click website export
│   │   └── commands/
│   │       ├── init.ts        # Scaffolds a starter world from `templates/starter-world`
│   │       ├── validate.ts    # CLI validation report (`--json`, `--strict`)
│   │       ├── edit.ts        # Studio API (`/api/editor`, `/api/record`, `/api/create`, `/api/move`, `/api/preview`, `/api/export`)
│   │       ├── dev.ts         # Live-reloading Vite viewer server (`timewright dev`)
│   │       ├── pick.ts        # Coordinate picker server (`timewright pick`)
│   │       ├── build.ts       # Static site builder (`buildWorldSite`) & in-memory exporter (`exportWorldArtifact`)
│   │       └── schema.ts      # Emits JSON Schema for IDE autocomplete
│   │
│   └── viewer/                # Interactive reader UI (built by Vite into static assets)
│       ├── index.html         # Viewer DOM shell (topbar, stepbar, map stage, timeline, card drawer)
│       ├── main.ts            # App bootstrap, URL hash deep-linking, cards, search/tag filters, keyboard nav
│       ├── state.ts           # Reactive `Store<AppState>` with changed-key tracking
│       ├── map.ts             # Leaflet `CRS.Simple` map, portal badges, spiral co-located pins, projected paths
│       ├── timeline.ts        # Two-tier timeline: full-domain overview window + interactive event strip
│       ├── stepbar.ts         # Prev / Next stepper & step readout
│       ├── cards.ts           # Markdown (`marked`) + `DOMPurify` HTML sanitization
│       ├── link.ts            # `#map=...&date=...&span=...&trace=...&event=...` hash serializer
│       └── styles.css         # Responsive mobile-bottom-sheet / desktop-side-panel styling
│
├── scripts/copy-assets.mjs    # Copies `editor.html` and `picker.html` into `dist/cli/` during build
├── docs/                      # FORMAT.md, AGENT_GUIDE.md, and this ARCHITECTURE_OVERVIEW.md
├── examples/                  # `napoleon/` and `revelation-space/` reference worlds
└── test/                      # Node `--test` suite covering core logic, YAML edits, security, and exports
```

---

## 3. Data Pipeline: From YAML to Interactive Viewer

Every command follows the same four-stage pipeline:

1. **Load (`src/cli/load.ts` → `loadWorld`)**
   Walks `world.yaml` plus `maps/`, `locations/`, `people/`, and `events/`. Each YAML file can hold either a single object (`napoleon.yaml`) or a sequence of objects (`events.yaml`). Every loaded item remembers its source `{ file, index }` so the Studio knows exactly where to write edits back.
2. **Index & Validate (`src/core/building.ts` + `src/core/validate.ts`)**
   `buildIndex()` registers every entity's canonical `id` (explicit `id` or slugified `name`/`title`) and `aliases` into `NameTable`s. `validateWorld()` checks date syntax, missing or ambiguous names (offering `"did you mean ...?"` via edit distance), duplicate IDs, and map image sizes.
3. **Resolve (`src/core/derive.ts` → `resolveWorld`)**
   Produces a serializable `ResolvedWorld`:
   - Human names in `parent`, `map`, `opens`, `where`, `people`, and `stays` become canonical IDs.
   - Raw date strings become structured `ParsedDate` objects sorted by calendar rules.
4. **Query & Render (`src/core/derive.ts`, `src/core/steps.ts`, `src/viewer/*`)**
   At runtime in the browser, as `AppState` changes (`date`, `span`, `mapId`, `mode`, `traceId`, `query`, `tags`):
   - **Era-switching map layers:** `imageForDate(map, date)` picks the map image whose `from..until` window covers `date`.
   - **Sub-maps & upward projection:** A location with `opens: london` acts as a portal from `europe` into `london`. `projectToMap()` walks upward through `opens` anchors so events or character journeys inside sub-maps still show activity counts and continuous paths on parent maps.
   - **Mobile locations & nested stays:** Ships, armies, or trains (`kind: mobile`) resolve their position at `date` through `stays`. People aboard a mobile location automatically inherit the vessel's coordinates at that date (`resolveLocationAt`).
   - **Three event placement modes:**
     1. *Named location* (`where: Waterloo`) — follows fixed or mobile locations.
     2. *Exact map point* (`where: { map: europe, at: [420, 310] }`) — pinned directly to map pixels without needing a location record.
     3. *General timeline event* (`where` omitted) — appears on the timeline strip (styled as a square timeline tick) and displays a floating banner on the map when stepped onto.

---

## 4. How the Visual Studio (`timewright edit`) & Export Work

- **Local Security (`src/cli/local-server.ts`):** Binds strictly to `127.0.0.1` and validates `Host` and `Origin` headers on every request to block DNS-rebinding or cross-origin POSTs from other browser tabs.
- **Studio Endpoints (`src/cli/commands/edit.ts`):**
  - `GET /api/editor` — returns world metadata, maps (with breadcrumb chains), locations, people, events, and live validation issues.
  - `POST /api/world` — updates `world.yaml` (`title`, `overworld`, `start`, `end`).
  - `POST /api/create` — appends to the kind's list file (e.g. `locations/locations.yaml`) or creates a new `.yaml` file; for sub-maps, can auto-generate a starter SVG canvas and link `opens` on the parent location.
  - `POST /api/record` & `POST /api/delete` — updates or deletes a specific `{ file, index }` YAML node in place.
  - `POST /api/move` — updates `at: [x, y]` when dragging a location pin or a raw-point event pin.
  - `POST /api/image` & `POST /api/asset` — writes uploaded map images (auto-detecting pixel dimensions) or person/location illustrations into the world folder.
  - `GET /api/preview` — builds a fresh in-memory single-file viewer so creators can test the live reader inside an iframe modal at any moment.
  - `GET /api/export?format=zip|single-file` & `POST /api/build-disk` — invokes `exportWorldArtifact()` / `buildWorldSite()` to download a ready-to-host `.zip` website bundle, a standalone `.html` file, or write `dist/` to disk.

---

## 5. How to Extend Timewright (Common Recipes)

### A. Adding a New Field to Events, People, Locations, or Maps
Suppose you want to add a `faction: string` field to `person`:
1. **Schema (`src/core/schema.ts`):** Add `faction: z.string().optional()` to `PersonSchema` (and add `"faction"` to the known-keys set in `src/core/validate.ts` if checked).
2. **Resolved Model (`src/core/model.ts` & `src/core/derive.ts`):** Add `faction?: string` to `ResolvedPerson` and pass it through in `resolveWorld()`.
3. **YAML Writer (`src/cli/world-edit.ts`):** Add `"faction"` to `EDITABLE_FIELDS.person.optional` so form saves write/clear it automatically, and include it in `describe()` inside `src/cli/commands/edit.ts`.
4. **Studio & Viewer UI (`src/cli/editor.html` & `src/viewer/main.ts`):** Add an `<input name="faction">` in `renderPersonForm()` and display `person.faction` in `personCard()`.

### B. Adding a New Entity Kind (e.g., Factions, Artifacts, or Routes)
1. Define `FactionSchema` in `src/core/schema.ts` and load `factions/` in `src/cli/load.ts`.
2. Register a `factionNames` `NameTable` in `src/core/building.ts` so events/people can reference factions by human name or alias.
3. Add `factions` to `ResolvedWorld` in `src/core/model.ts` and `resolveWorld()` in `src/core/derive.ts`.
4. Add `"faction"` to `EditableKind` in `src/cli/world-edit.ts` and add a new tab in `src/cli/editor.html`.

### C. Adding Regions / Polygons or Drawn Paths on Maps
Because `MapView` (`src/viewer/map.ts`) and the Studio (`src/cli/editor.html`) both use `pixelToLatLng(x, y)` on `L.CRS.Simple`:
- Store polygon vertices in YAML as `polygon: [[x1, y1], [x2, y2], ...]` in image pixels.
- Render them in `MapView` with `L.polygon(points.map(([x, y]) => this.pixelToLatLng(x, y)), style)` — they will scale and pan with zero drift alongside pins.

### D. Adding Audio, Timeline Playback ("Play" Button), or New Card Media
- **Auto-play timer:** `Store` in `src/viewer/state.ts` drives the entire viewer. A Play/Pause button in `stepbar.ts` / `main.ts` only needs a `setInterval` that triggers `nextButton.click()` (or advances `state.date` via `fractionDate` in `src/core/scale.ts`).
- **Additional media:** Follow `copyEntityImages()` in `src/cli/commands/build.ts` and `inlinePath()` in `src/cli/single-file.ts` so assets are copied into `dist/media/` for `.zip` sites and base64-inlined for standalone `.html` exports.
