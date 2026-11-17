# Timewright — Time-First Authoring & Bug-Fix Implementation Plan

Baseline committed at `24703cd` (*"Build visual Studio editor, CRS.Simple viewer upgrade, and zip/html export"*).

This plan breaks the next upgrade into **five small, self-contained phases** so each step stays fast, easy to review, and safe against context/output timeouts. Every phase leaves `npm run build` and `npm test` green.

---

## Goals & Decisions Locked In

1. **Creator Workflow (Map → People → Step Through Time → Tweak):**
   - **Editor Timeline Bar** docked beneath the Studio map canvas with a **Current Date** control, `‹ Prev` / `Next ›` event stepper, clickable chronological event ticks, and a **`Filter by Date` vs. `All Time`** view toggle.
   - **Zero `prompt()` popups:** Creating maps, locations, people, or events opens an **inline draft form** in the sidebar pre-populated from context (active map, clicked `[x, y]`, current editor date).
   - **Character pills** on event forms so people built in Step 2 can be toggled onto events in one click.
2. **Location-Attached Events = Badge + Linked List (Choice 1A):**
   - Events whose `where` is a **named Location** do **not** spawn separate floating diamond pins around the location.
   - Instead, the Location pin displays an **event count badge** (for the visible span / current date), and clicking the Location opens its card/panel with a **chronological list of its events as clickable links** (in both the Viewer and the Studio).
   - Raw coordinate events (`where: { map, at: [x, y] }`) continue to render at their exact `[x, y]` with zero offset.
3. **All 4 Reported Bugs Fixed:**
   - **Preview & standalone `world.html` blank screen** (`single-file.ts` script execution order).
   - **Sub-map double-click broken** (`editor.html` destroying marker DOM nodes on first click).
   - **Mobile locations invisible in Studio** (`edit.ts` + `editor.html` date-aware resolution & rendering).
   - **Event marker offset drift** (eliminated by Choice 1A badge + exact `[x, y]` for raw-point events).

---

## Phased Execution Plan

### Phase 1 — Fix Preview / `world.html` & Sub-Map Navigation (`single-file.ts`, `editor.html`)
*Scope: Quick, high-impact bug fix pass.*
- **`src/cli/single-file.ts`:**
  - Strip `<script ... src="...">` tags from `<head>` during asset inlining and inject `<script id="world-data" type="application/json">...</script>` **followed by** the inlined viewer `<script>...</script>` right before `</body>`.
  - Add a regression assertion in `test/phase5.test.ts` verifying `#world-data` precedes the executable bundle script and both sit inside `<body>` after `<div id="app">`.
- **`src/cli/editor.html`:**
  - Stop calling `drawPins()` inside marker `click` handlers; toggle `.selected` CSS class on existing marker DOM nodes so the second click of a `dblclick` hits the live marker cleanly.
  - Also make the `↘` portal badge on a location pin a 1-click shortcut to open its sub-map.
- **Verify:** `npm run build && npm test`, plus verify `/api/preview` HTML order.

---

### Phase 2 — Location Event Badges & Linked Event Lists (`viewer/map.ts`, `viewer/main.ts`, `viewer/styles.css`)
*Scope: Upgrade Viewer to Choice 1A (zero offset clutter).*
- **`src/viewer/map.ts`:**
  - Group placed events whose `where.location` resolves to a location on the active map (within the active span / trace filter) onto that location's count badge instead of spawning separate spiral-offset markers.
  - Keep standalone diamond pins **only** for raw coordinate events (`where: { map, at: [x, y] }`) at exact `[x, y]` (or when a sub-map event projects onto a parent location in focus).
  - Highlight the location pin when one of its events is currently active/selected.
- **`src/viewer/main.ts` & `src/viewer/styles.css`:**
  - In `locationCard()`, render an **"Events here"** section listing all events tied to that location (sorted chronologically, highlighting those in the current span/date) as clickable links (`data-kind="event" data-id="..."`) that open the event card and jump to its date.
- **Verify:** `npm run typecheck && npm run build && npm test`.

---

### Phase 3 — Date-Aware Studio Backend (`/api/editor?date=...`) & Mobile Location Support (`edit.ts`)
*Scope: Teach the Studio API about the editor's active date so maps, mobile locations, character stays, and timeline ticks all resolve accurately.*
- **`src/cli/commands/edit.ts` (`describe(root, dateStr?)`):**
  - Accept optional `?date=<raw>` on `GET /api/editor`.
  - Parse `date` with `world.calendar` (defaulting to `world.start` or earliest event date) and return:
    - `activeDate`: resolved raw date string, plus `timeline`: `{ start, end, events: [{ id, title, when, fraction, whereMode, map, locationId }] }` using `eventDomain` & `dateFraction` from `src/core/scale.js`.
    - For each **map**: `activeImage` chosen via `imageForDate(map, parsedDate)`.
    - For each **location**: `visibleAtDate` (`locationVisibleAt`), `resolvedMap` & `resolvedAt` at `parsedDate` via `resolveLocationAt` (so **mobile locations** inside another location get concrete `{ resolvedMap, resolvedAt, hostLocationName }`!), plus `eventIds` at that location.
    - For each **person**: `activeLocationId` at `parsedDate` (so Studio can optionally show who is present at a location).
- **Verify:** `npm run typecheck && npm test`.

---

### Phase 4 — Editor Timeline Bar & Date-Reactive Canvas (`editor.html` — Map & Timeline)
*Scope: Add the bottom Timeline Bar to the Studio canvas and render mobile locations + location event badges.*
- **`src/cli/editor.html`:**
  - Add `#editor-timeline` below `#map` inside `#map-stage`:
    - **Current Date input** + `Go`
    - **`‹ Prev` / `Next ›`** buttons to step chronologically through events
    - **Interactive timeline strip** with clickable event ticks + draggable/clickable playhead
    - **View mode toggle:** `At Date` (shows active era map, mobile locations at their stay for that date, dims out-of-era locations, highlights current-date events) vs. `All Time` (shows everything for full-world auditing).
  - Render **mobile locations** on the editor map at their `resolvedAt` coordinates (with a distinct mobile/ship chip offset by fixed CSS screen pixels so it sits neatly next to its host location instead of vanishing).
  - Render **location event count badges** on Studio location pins (matching the Viewer), and list clickable **Events at this Location** links inside the Studio's Location form!

---

### Phase 5 — Inline Creation Forms (No `prompt()`), Character Pills & Guided Workflow Bar (`editor.html` — Sidebar & Header)
*Scope: Replace every browser `prompt()` with smooth inline forms tailored to your 1 → 2 → 3 → 4 workflow.*
- **Workflow Header Order:** Reorder tabs to match the natural creation order: **`Maps` → `People` → `Locations` → `Events` → `World`** (with quick counts on each tab and a 1-click **"Upload Main Map"** callout when the world still uses the placeholder SVG).
- **Eliminate all `prompt()` calls:**
  - `+ Map` / `+ Create Sub-map` → opens an inline **New Map** draft in the sidebar (pre-filling `parent` and `linkFromLocationId`).
  - `+ Place Location` + map click → places a temporary preview pin at `[x, y]` and opens an inline **New Location** form with `map` and `[x, y]` pre-filled (focusing the Name input immediately).
  - `+ Place Event` + map click (or clicking **`+ Add Event Here`** on a Location, or **`+ Event at Current Date`** on the timeline bar) → opens an inline **New Event** form with `when` pre-filled to the **Current Date** and `where` pre-filled to that Location or `[x, y]`.
  - Saving an event with a new date automatically advances the Editor's **Current Date** to that event's date so chronological storytelling flows naturally forward.
- **Clickable Character Pills on Event Form:**
  - Replace the plain comma-separated `people` text input with **clickable toggle pills** for every character in `People` (plus an inline `+ Quick Add Person` mini-input if a new character appears mid-scene).
- **Final Verification:** `npm run build && npm test`, smoke-test end-to-end, and commit cleanly.
