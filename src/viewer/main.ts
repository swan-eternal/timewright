/**
 * The viewer: load the world, show the map, walk the timeline.
 */

import "./styles.css";

import { compareDateBounds, parseDate, type DateBound } from "../core/dates.js";
import { chapterBadge, chapterLabel, displayDate, isChapterWorld } from "../core/chapters.js";
import { dateFraction, eventDomain, fractionDate } from "../core/scale.js";
import {
  eventHasPosition,
  eventPlace,
  eventsAtPlace,
  mapChain,
  placeMap,
  sortedEvents,
} from "../core/derive.js";
import {
  findStep,
  tracePath,
  traceStart,
  traceSteps,
  traceable,
  viewSteps,
  type PathPoint,
  type Span,
} from "../core/steps.js";
import type { ResolvedEvent, ResolvedLocation, ResolvedPerson, ResolvedWorld } from "../core/model.js";
import { escapeHtml, renderMarkdown } from "./cards.js";
import { debugOn, installDebug } from "./debug.js";
import { readLink, writeLink } from "./link.js";
import { assetUrl, MapView } from "./map.js";
import { StepBar } from "./stepbar.js";
import { Store, type AppState, type Changed } from "./state.js";
import { Timeline } from "./timeline.js";

const statusElement = document.querySelector<HTMLElement>("#status");
const cardElement = document.querySelector<HTMLElement>("#card");
const worldTitleElement = document.querySelector<HTMLElement>("#world-title");
const crumbSepElement = document.querySelector<HTMLElement>("#crumb-sep");
const breadcrumbElement = document.querySelector<HTMLElement>("#breadcrumb");
const mapElement = document.querySelector<HTMLElement>("#map");
const generalBannerElement = document.querySelector<HTMLElement>("#general-banner");
const activeFiltersElement = document.querySelector<HTMLElement>("#active-filters");
const dateForm = document.querySelector<HTMLFormElement>("#date-form");
const dateInput = document.querySelector<HTMLInputElement>("#date-input");

/** In a world that counts chapters, the typed date becomes a picker. */
let chapterInput: HTMLSelectElement | null = null;
function ensureChapterInput(world: ResolvedWorld): void {
  if (chapterInput !== null || dateInput === null || !isChapterWorld(world)) {
    return;
  }
  const keys = Object.keys(world.chapters ?? {})
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  if (keys.length === 0) {
    return;
  }
  const label = document.querySelector<HTMLLabelElement>('label[for="date-input"]');
  if (label !== null) {
    label.textContent = "Chapter";
    label.htmlFor = "chapter-input";
  }
  dateInput.hidden = true;
  const select = document.createElement("select");
  select.id = "chapter-input";
  select.autocomplete = "off";
  select.setAttribute("aria-label", "Chapter");
  select.innerHTML = keys
    .map((key) => `<option value="${key}">${escapeHtml(chapterLabel(world, key))}</option>`)
    .join("");
  select.addEventListener("change", () => {
    void select.form?.requestSubmit();
  });
  dateInput.after(select);
  chapterInput = select;
}
const prevButton = document.querySelector<HTMLButtonElement>("#prev-step");
const nextButton = document.querySelector<HTMLButtonElement>("#next-step");
const stepLabel = document.querySelector<HTMLElement>("#step-label");
const traceSelect = document.querySelector<HTMLSelectElement>("#trace-select");
const clearTraceButton = document.querySelector<HTMLButtonElement>("#clear-trace");
const searchInput = document.querySelector<HTMLInputElement>("#search");
const resultsElement = document.querySelector<HTMLElement>("#results");
const domainReadoutElement = document.querySelector<HTMLElement>("#domain-readout");
const playheadReadoutElement = document.querySelector<HTMLElement>("#playhead-readout");
const resetSpanButton = document.querySelector<HTMLButtonElement>("#reset-span");
const filtersToggleElement = document.querySelector<HTMLButtonElement>("#filters-toggle");
const filtersPanelElement = document.querySelector<HTMLElement>("#filters-panel");
const contextElement = document.querySelector<HTMLElement>("#context");
const stripElement = document.querySelector<HTMLElement>("#strip");

/** The opening timeline window: this share of the world's whole range. */
const DEFAULT_SPAN_FRACTION = 0.05;
/** Where the first event sits in the opening window, from its left edge. */
const DEFAULT_SPAN_ANCHOR = 0.2;

/** Phone-width layout: the card collapses to a peek row and secondary
 *  controls fold into the filters panel. */
const phoneMedia = window.matchMedia("(max-width: 899.98px)");
function isPhoneView(): boolean {
  return phoneMedia.matches;
}

/** The card's collapse state, meaningful on phone only. */
let cardCollapsed = false;
let lastSelectionKey: string | undefined;

function setStatus(message: string, error = false): void {
  if (statusElement !== null) {
    statusElement.textContent = message;
    statusElement.classList.toggle("error", error);
  }
}

function personLink(person: ResolvedPerson): string {
  return `<a href="#" class="person" data-person="${escapeHtml(person.id)}">${escapeHtml(person.name)}</a>`;
}

function tagChips(tags: string[]): string {
  if (tags.length === 0) {
    return "";
  }
  return `<p class="tags">${tags
    .map((tag) => `<button type="button" class="tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)
    .join(" ")}</p>`;
}

function portraitHtml(rawPath: string | undefined, alt: string): string {
  const src = assetUrl(rawPath);
  if (src === undefined) {
    return "";
  }
  return `<div class="card-media"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" /></div>`;
}

/** The chapter note on an event's card, in a world that has dates. */
function chapterNote(world: ResolvedWorld, event: ResolvedEvent): string {
  if (event.chapter === undefined || isChapterWorld(world)) {
    return "";
  }
  return ` · ${escapeHtml(chapterBadge(world, event.chapter))}`;
}

function eventCard(world: ResolvedWorld, event: ResolvedEvent): string {
  const place = world.locations.find((location) => event.where?.location === location.id);
  const mapObj =
    event.where?.map !== undefined ? world.maps.find((m) => m.id === event.where?.map) : undefined;
  const whereHtml =
    place !== undefined
      ? `<a href="#" data-kind="location" data-id="${escapeHtml(place.id)}">${escapeHtml(place.name)}</a>`
      : mapObj !== undefined
        ? `<a href="#" data-map="${escapeHtml(mapObj.id)}">${escapeHtml(mapObj.name)}</a>`
        : "Timeline event";
  const people = event.people
    .map((id) => world.people.find((person) => person.id === id))
    .filter((person): person is ResolvedPerson => person !== undefined)
    .map((person) => personLink(person))
    .join(", ");
  return [
    `<h2>${escapeHtml(event.title)}</h2>`,
    `<p class="meta">${escapeHtml(displayDate(world, event.when))}${chapterNote(world, event)} · ${whereHtml}</p>`,
    people !== "" ? `<p class="people"><strong>People:</strong> ${people}</p>` : "",
    tagChips(event.tags),
    renderMarkdown(event.card),
  ].join("\n");
}

function locationCard(
  state: AppState,
  location: ResolvedLocation,
  visibleEventIds: Set<string>,
): string {
  const world = state.world;
  const people = world.people
    .filter((person) => person.stays.some((stay) => stay.at === location.id))
    .map((person) => personLink(person));
  const submap =
    location.opens !== undefined ? world.maps.find((m) => m.id === location.opens) : undefined;
  const enterSubmapBtn =
    submap !== undefined
      ? `<p class="card-actions"><button type="button" class="action-btn" data-map="${escapeHtml(submap.id)}">Enter ${escapeHtml(submap.name)} ↘</button></p>`
      : location.opens !== undefined
        ? `<p class="card-actions"><button type="button" class="action-btn" data-map="${escapeHtml(location.opens)}">Enter sub-map ↘</button></p>`
        : "";
  const existsMeta =
    location.exists !== undefined
      ? [
          location.exists.from !== undefined ? displayDate(world, location.exists.from) : undefined,
          location.exists.until !== undefined ? displayDate(world, location.exists.until) : undefined,
        ]
          .filter(Boolean)
          .join(" – ")
      : "";
  const metaParts = [location.kind === "mobile" ? "Mobile" : "", existsMeta].filter((p) => p !== "");
  // The events that happen here, oldest first. The ones the reader can
  // see now are marked, so a place with a long history reads as the
  // reader's window and what lies outside it.
  const hereIds = new Set(
    eventsAtPlace(world, location.id, placeMap(world, location, state.date), state.date).map(
      (event) => event.id,
    ),
  );
  const eventsHere = sortedEvents(world).filter((event) => hereIds.has(event.id));
  const eventsHtml =
    eventsHere.length === 0
      ? ""
      : `<div class="events-here"><h3>Events here</h3><ul>${eventsHere
          .map(
            (event) =>
              `<li class="${visibleEventIds.has(event.id) ? "is-visible" : ""}"><a href="#" data-kind="event" data-jump="event" data-id="${escapeHtml(event.id)}">${escapeHtml(event.title)}</a><span class="when">${escapeHtml(displayDate(world, event.when))}</span></li>`,
          )
          .join("")}</ul></div>`;
  return [
    portraitHtml(location.image, location.name),
    `<h2>${escapeHtml(location.name)}</h2>`,
    metaParts.length > 0 ? `<p class="meta">${escapeHtml(metaParts.join(" · "))}</p>` : "",
    enterSubmapBtn,
    eventsHtml,
    people.length > 0 ? `<p class="people"><strong>People:</strong> ${people.join(", ")}</p>` : "",
    tagChips(location.tags),
    renderMarkdown(location.card ?? location.bio),
  ].join("\n");
}

function personCard(world: ResolvedWorld, person: ResolvedPerson): string {
  const life = [person.born, person.died]
    .filter((part) => part !== undefined)
    .map((part) => displayDate(world, part))
    .join(" – ");
  const staysList = person.stays
    .map((s) => {
      const loc = world.locations.find((l) => l.id === s.at);
      const label = loc?.name ?? s.at;
      const dates = [s.from?.raw, s.until?.raw].filter(Boolean).join("–");
      return dates !== "" ? `${escapeHtml(label)} (${escapeHtml(dates)})` : escapeHtml(label);
    })
    .join(", ");
  return [
    portraitHtml(person.image, person.name),
    `<h2>${escapeHtml(person.name)}</h2>`,
    life !== "" ? `<p class="meta">${escapeHtml(life)}</p>` : "",
    `<p class="card-actions"><button type="button" class="action-btn" data-person="${escapeHtml(person.id)}">Follow path on timeline</button></p>`,
    staysList !== "" ? `<p class="people"><strong>Stays:</strong> ${staysList}</p>` : "",
    tagChips(person.tags),
    renderMarkdown(person.bio),
  ].join("\n");
}

function renderCard(state: AppState, visibleEventIds: Set<string>): void {
  if (cardElement === null) {
    return;
  }
  const selection = state.selection;
  if (selection === undefined) {
    cardElement.hidden = true;
    cardElement.innerHTML = "";
    lastSelectionKey = undefined;
    return;
  }
  const key = `${selection.kind}:${selection.id}`;
  if (key !== lastSelectionKey) {
    // A new card opens collapsed on a phone: the peek row carries title
    // and date, and the map keeps its space.
    cardCollapsed = isPhoneView();
    lastSelectionKey = key;
  }
  let html = "";
  let peekTitle = "";
  let peekDate = "";
  if (selection.kind === "event") {
    const event = state.world.events.find((entry) => entry.id === selection.id);
    html = event !== undefined ? eventCard(state.world, event) : "";
    peekTitle = event?.title ?? "";
    peekDate = event !== undefined ? displayDate(state.world, event.when) : "";
  } else if (selection.kind === "location") {
    const location = state.world.locations.find((entry) => entry.id === selection.id);
    html = location !== undefined ? locationCard(state, location, visibleEventIds) : "";
    peekTitle = location?.name ?? "";
  } else {
    const person = state.world.people.find((entry) => entry.id === selection.id);
    html = person !== undefined ? personCard(state.world, person) : "";
    peekTitle = person?.name ?? "";
    peekDate = [person?.born, person?.died]
      .filter((part) => part !== undefined)
      .map((part) => displayDate(state.world, part))
      .join(" – ");
  }
  const closeHtml =
    '<div class="card-header-close"><button type="button" id="close-card" class="ghost-btn" aria-label="Close card">✕ Close</button></div>';
  cardElement.innerHTML =
    `<div class="card-sheet-head" role="button" tabindex="0" aria-label="Toggle details">` +
    `<span class="sheet-grip" aria-hidden="true"></span>` +
    `<span class="peek-title">${escapeHtml(peekTitle)}</span>` +
    (peekDate !== "" ? ` <span class="peek-date">${escapeHtml(peekDate)}</span>` : "") +
    `</div><div class="card-body">${closeHtml}${html}</div>`;
  cardElement.classList.toggle("collapsed", cardCollapsed);
  cardElement.hidden = false;
}

/** Phone-only card gestures: tap the peek to expand, swipe down to
 *  collapse, swipe down again to dismiss. */
function setupCardSheet(store: Store): void {
  if (cardElement === null) {
    return;
  }
  let drag: { startY: number; moved: boolean } | undefined;
  let suppressClick = false;
  cardElement.addEventListener("pointerdown", (event) => {
    if (!isPhoneView() || cardElement.hidden) {
      return;
    }
    if (event.target instanceof Element && event.target.closest(".card-sheet-head") !== null) {
      drag = { startY: event.clientY, moved: false };
    }
  });
  window.addEventListener("pointermove", (event) => {
    const active = drag;
    if (active === undefined) {
      return;
    }
    const dy = event.clientY - active.startY;
    if (dy > 10) {
      active.moved = true;
      cardElement.classList.add("dragging");
      cardElement.style.transform = `translateY(${Math.min(dy, 180)}px)`;
    }
  });
  window.addEventListener("pointerup", (event) => {
    const active = drag;
    drag = undefined;
    if (active === undefined) {
      return;
    }
    const dy = event.clientY - active.startY;
    cardElement.style.transform = "";
    cardElement.classList.remove("dragging");
    if (!active.moved) {
      return;
    }
    suppressClick = true;
    window.setTimeout(() => {
      suppressClick = false;
    }, 300);
    if (dy > 56) {
      if (cardCollapsed) {
        store.set({ selection: undefined });
      } else {
        cardCollapsed = true;
        cardElement.classList.add("collapsed");
      }
    }
  });
  cardElement.addEventListener("click", (event) => {
    if (!isPhoneView() || !(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest(".card-sheet-head") === null) {
      return;
    }
    if (suppressClick) {
      event.preventDefault();
      return;
    }
    cardCollapsed = !cardCollapsed;
    cardElement.classList.toggle("collapsed", cardCollapsed);
  });
  cardElement.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (event.target instanceof Element && event.target.closest(".card-sheet-head") !== null) {
      event.preventDefault();
      cardCollapsed = !cardCollapsed;
      cardElement.classList.toggle("collapsed", cardCollapsed);
    }
  });
}

/** Colors for shown traces. The follow trace keeps the world's event
 *  orange, so the palette stays clear of it. */
const TRACE_PALETTE = [
  "#1e60b3",
  "#2e7d32",
  "#6a3fb5",
  "#a04700",
  "#0e7c86",
  "#8a2d5b",
  "#5a5a15",
  "#37474f",
];

/** A shown trace's color: the person's own when the world declares one,
 *  otherwise a stable turn of the palette. */
function shownTraceColor(world: ResolvedWorld, id: string): string {
  const person = world.people.find((entry) => entry.id === id);
  if (person?.color !== undefined && person.color !== "") {
    return person.color;
  }
  const entries = traceable(world);
  const index = Math.max(0, entries.findIndex((entry) => entry.id === id));
  return TRACE_PALETTE[index % TRACE_PALETTE.length];
}

/** Showing a trace whose first point is still ahead of the reader draws
 *  nothing at all, which reads as broken. Bring the reader to the trace's
 *  first placed point instead; a reader already past it keeps their place. */
function jumpToStart(
  world: ResolvedWorld,
  id: string,
  date: DateBound | undefined,
): Partial<AppState> {
  const start = traceStart(world, id);
  if (start === undefined) {
    return {};
  }
  if (date !== undefined && compareDateBounds(date, start) >= 0) {
    return {};
  }
  return { date: start, stepKey: undefined };
}

/** The "Show traces" checklist: several traces at once, each in its own
 *  color, independent of the Follow dropdown's single-life walk. */
function buildTracesSection(world: ResolvedWorld, store: Store): HTMLElement {
  const section = document.createElement("div");
  section.className = "traces-section";
  const head = document.createElement("div");
  head.className = "traces-head";
  const label = document.createElement("span");
  label.className = "filter-label";
  label.textContent = "Show traces";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "mini-link";
  clear.id = "clear-shown-traces";
  clear.textContent = "Clear all";
  clear.hidden = true;
  clear.addEventListener("click", () => {
    store.set({ shownTraces: [] });
  });
  head.append(label, clear);
  const list = document.createElement("div");
  list.className = "traces-list";
  list.id = "traces-list";
  for (const entry of traceable(world)) {
    const row = document.createElement("label");
    row.className = "trace-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.traceId = entry.id;
    const dot = document.createElement("span");
    dot.className = "trace-dot";
    dot.style.background = shownTraceColor(world, entry.id);
    const name = document.createElement("span");
    name.textContent = entry.name;
    row.append(box, dot, name);
    list.appendChild(row);
  }
  section.append(head, list);
  section.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.traceId === undefined) {
      return;
    }
    const id = target.dataset.traceId;
    const current = new Set(store.get().shownTraces ?? []);
    if (target.checked) {
      current.add(id);
    } else {
      current.delete(id);
    }
    store.set({
      shownTraces: [...current],
      ...(target.checked ? jumpToStart(world, id, store.get().date) : {}),
    });
  });
  return section;
}

/** The filters panel: date jump, search and the trace select fold behind
 *  one topbar button on the phone; the traces checklist lives in it on
 *  every screen, so the toggle works on desktop too. */
function setupFiltersPanel(tracesSection: HTMLElement): void {
  if (filtersToggleElement === null || filtersPanelElement === null) {
    return;
  }
  // The checklist lives at the bottom of the panel on every screen; the
  // controls folded in on the phone land above it. It must be attached
  // before place() uses it as an insertion reference.
  filtersPanelElement.appendChild(tracesSection);
  const traceRow = document.querySelector<HTMLElement>(".trace-controls");
  const movable = [dateForm, searchInput, traceRow].filter(
    (node): node is HTMLElement => node !== null && node !== undefined,
  );
  const homes = movable.map((node) => node.parentElement);
  const place = (): void => {
    if (isPhoneView()) {
      for (const node of movable) {
        filtersPanelElement.insertBefore(node, tracesSection);
      }
      return;
    }
    filtersToggleElement.setAttribute("aria-expanded", "false");
    filtersPanelElement.classList.remove("open");
    for (const [index, node] of movable.entries()) {
      homes[index]?.appendChild(node);
    }
  };
  place();
  phoneMedia.addEventListener("change", place);
  filtersToggleElement.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = filtersPanelElement.classList.toggle("open");
    filtersToggleElement.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (!filtersPanelElement.classList.contains("open")) {
      return;
    }
    const target = event.target;
    if (
      target instanceof Node &&
      (filtersPanelElement.contains(target) || filtersToggleElement.contains(target))
    ) {
      return;
    }
    filtersPanelElement.classList.remove("open");
    filtersToggleElement.setAttribute("aria-expanded", "false");
  });
}

function renderActiveFilters(state: AppState): void {
  if (activeFiltersElement === null) {
    return;
  }
  const tags = state.tags ?? [];
  const query = (state.query ?? "").trim();
  const shown = state.shownTraces ?? [];
  if (tags.length === 0 && query === "" && shown.length === 0) {
    activeFiltersElement.hidden = true;
    activeFiltersElement.innerHTML = "";
    return;
  }
  const chips: string[] = [];
  for (const tag of tags) {
    chips.push(
      `<button type="button" class="filter-chip" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)} ✕</button>`,
    );
  }
  if (query !== "") {
    chips.push(
      `<button type="button" class="filter-chip" id="clear-query-chip">Search: "${escapeHtml(query)}" ✕</button>`,
    );
  }
  for (const id of shown) {
    const entry = traceable(state.world).find((candidate) => candidate.id === id);
    chips.push(
      `<button type="button" class="filter-chip" data-trace-clear="${escapeHtml(id)}"><span class="chip-dot" style="background:${escapeHtml(shownTraceColor(state.world, id))}"></span>${escapeHtml(entry?.name ?? id)} ✕</button>`,
    );
  }
  activeFiltersElement.innerHTML = `<span class="filter-label">Active filters:</span> ${chips.join(" ")}`;
  activeFiltersElement.hidden = false;
}

function renderBreadcrumb(state: AppState): void {
  if (breadcrumbElement === null) {
    return;
  }
  const chain = mapChain(state.world, state.mapId);
  breadcrumbElement.innerHTML = chain
    .map((map, index) =>
      index === chain.length - 1
        ? `<span>${escapeHtml(map.name)}</span>`
        : `<button type="button" data-map="${escapeHtml(map.id)}">${escapeHtml(map.name)}</button>`,
    )
    .join(" › ");
}

function renderResults(state: AppState): void {
  if (resultsElement === null) {
    return;
  }
  const query = (state.query ?? "").trim().toLowerCase();
  if (query === "") {
    resultsElement.hidden = true;
    resultsElement.innerHTML = "";
    return;
  }
  const matches: { kind: string; id: string; label: string }[] = [];
  for (const event of state.world.events) {
    if (event.title.toLowerCase().includes(query)) {
      matches.push({ kind: "event", id: event.id, label: event.title });
    }
  }
  for (const person of state.world.people) {
    if (person.name.toLowerCase().includes(query)) {
      matches.push({ kind: "person", id: person.id, label: person.name });
    }
  }
  for (const location of state.world.locations) {
    if (location.name.toLowerCase().includes(query)) {
      matches.push({ kind: "location", id: location.id, label: location.name });
    }
  }
  resultsElement.innerHTML = matches
    .slice(0, 12)
    .map(
      (match) =>
        `<button type="button" class="result" data-kind="${match.kind}" data-id="${escapeHtml(match.id)}">${escapeHtml(match.label)}</button>`,
    )
    .join("");
  resultsElement.hidden = matches.length === 0;
}

async function boot(): Promise<void> {
  installDebug();
  if (
    mapElement === null ||
    cardElement === null ||
    contextElement === null ||
    stripElement === null ||
    prevButton === null ||
    nextButton === null ||
    stepLabel === null ||
    traceSelect === null
  ) {
    setStatus("The viewer is missing its elements.");
    return;
  }
  setupEmbedLink();

  let world: ResolvedWorld;
  const inline = document.querySelector<HTMLScriptElement>("#world-data");
  try {
    if (inline !== null && inline.textContent !== null && inline.textContent !== "") {
      // The single-file build carries the world inside the page.
      world = JSON.parse(inline.textContent) as ResolvedWorld;
    } else {
      const response = await fetch(`${import.meta.env.BASE_URL}world.json`);
      if (!response.ok) {
        setStatus(`Could not load world.json (${response.status}).`);
        return;
      }
      world = (await response.json()) as ResolvedWorld;
    }
  } catch (error) {
    setStatus(`Could not load the world: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  document.title = `${world.title} — Timewright`;
  if (worldTitleElement !== null) {
    worldTitleElement.textContent = world.title;
  }
  if (crumbSepElement !== null) {
    crumbSepElement.hidden = world.maps.length === 0;
  }

  const link = readLink(window.location.hash);
  const firstEvent = sortedEvents(world)[0];

  // The world's calendar, so a date written in its eras reads the same
  // here as it does in the validator.
  const calendar = { calendar: world.calendar };

  let initialDate: DateBound | undefined = world.start ?? firstEvent?.when;
  if (link.date !== undefined) {
    try {
      initialDate = parseDate(link.date, calendar);
    } catch {
      // A bad date in the link is ignored.
    }
  }
  let initialSpan: Span | undefined;
  if (link.span !== undefined) {
    const [from, to] = link.span.split("..");
    try {
      if (from !== undefined && to !== undefined) {
        initialSpan = { from: parseDate(from, calendar), to: parseDate(to, calendar) };
      }
    } catch {
      // A bad span in the link is ignored.
    }
  }
  if (initialSpan === undefined && link.trace !== undefined) {
    // A trace shared without a span opens on the traced person's reach.
    const tracedSpan = traceSpanOf(world, link.trace);
    if (tracedSpan !== undefined) {
      initialSpan = tracedSpan;
      if (link.date === undefined) {
        initialDate = tracedSpan.from;
      }
    }
  }
  if (initialSpan === undefined) {
    // Open on a readable window around the story's start: a phone cannot
    // show centuries legibly. The first event sits a fifth of the window
    // in from the left edge.
    const domain = eventDomain(world);
    if (domain !== undefined && firstEvent !== undefined) {
      const anchor = dateFraction(firstEvent.when, domain);
      const from = Math.min(
        Math.max(anchor - DEFAULT_SPAN_ANCHOR * DEFAULT_SPAN_FRACTION, 0),
        1 - DEFAULT_SPAN_FRACTION,
      );
      initialSpan = {
        from: fractionDate(from, domain),
        to: fractionDate(from + DEFAULT_SPAN_FRACTION, domain),
      };
      if (link.date === undefined) {
        initialDate = firstEvent.when;
      }
    }
  }

  const store = new Store({
    world,
    mapId: link.map ?? world.overworld ?? world.maps[0]?.id ?? "",
    date: initialDate,
    span: initialSpan,
    mode: link.trace !== undefined ? "trace" : "span",
    traceId: link.trace,
    shownTraces: (link.traces ?? "")
      .split(",")
      .filter((id) => traceable(world).some((entry) => entry.id === id)),
    selection: link.event !== undefined ? { kind: "event", id: link.event } : undefined,
    query: link.query,
  });

  const mapView = new MapView({
    element: mapElement,
    onLocation: (id) => {
      store.set({ selection: { kind: "location", id } });
    },
    onEvent: (id) => {
      store.set({ selection: { kind: "event", id } });
    },
    onJumpMap: (mapId) => {
      store.set({ mapId });
    },
    onMapClick: () => {
      // A tap on open map closes the card, like tapping away a sheet.
      if (store.get().selection !== undefined) {
        store.set({ selection: undefined });
      }
    },
    onImageMissing: (message) => setStatus(message, message !== ""),
  });

  if (debugOn) {
    // The debug panel reads the map's own state.
    (window as unknown as { __timewright?: unknown }).__timewright = { mapView };
  }

  const selectStepAtIndex = (index: number, openCard = true): void => {
    const state = store.get();
    const currentDom = eventDomain(state.world);
    const span =
      state.span ?? (currentDom !== undefined ? { from: currentDom.from, to: currentDom.to } : undefined);
    const steps = viewSteps(state.world, {
      mode: state.mode,
      traceId: state.traceId,
      span,
      query: state.query,
      tags: state.tags,
    });
    const step = steps[index];
    if (step === undefined) {
      return;
    }
    store.set({
      date: step.date,
      stepKey: step.key,
      mapId: step.mapId ?? state.mapId,
      selection:
        openCard && step.eventId !== undefined ? { kind: "event", id: step.eventId } : state.selection,
    });
    if (step.mapId === (step.mapId ?? state.mapId) && step.at !== undefined) {
      mapView.focusPixel(step.at[0], step.at[1], cardFocusOffset());
    }
  };

  const stepBar = new StepBar({
    prev: prevButton,
    next: nextButton,
    label: stepLabel,
    onStep: (index) => selectStepAtIndex(index, true),
    onSelectCurrent: (index) => selectStepAtIndex(index, true),
  });

  const timeline = new Timeline({
    context: contextElement,
    strip: stripElement,
    onDate: (date) => store.set({ date, stepKey: undefined }),
    onSpan: (span) => store.set({ span }),
    onEvent: (eventId) => {
      const event = world.events.find((entry) => entry.id === eventId);
      if (event === undefined) {
        return;
      }
      const place = eventPlace(world, event);
      store.set({
        date: event.when,
        stepKey: `event:${eventId}`,
        mapId: place?.mapId ?? store.get().mapId,
        selection: { kind: "event", id: eventId },
      });
      if (place?.at !== undefined) {
        mapView.focusPixel(place.at[0], place.at[1], cardFocusOffset());
      }
    },
  });

  traceSelect.innerHTML = [
    '<option value="">Nobody traced</option>',
    ...traceable(world).map(
      (entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`,
    ),
  ].join("");
  traceSelect.value = store.get().traceId ?? "";

  setupCardSheet(store);
  setupFiltersPanel(buildTracesSection(world, store));

  const renderState = (state: AppState, changed: Changed): void => {
    // An empty changed set means "nothing in particular" - render it all.
    const everything = changed.size === 0;
    const currentDomain = eventDomain(state.world);
    const domainSpan =
      currentDomain !== undefined ? { from: currentDomain.from, to: currentDomain.to } : undefined;

    // A trace seeds the span with the person's own reach when it starts;
    // after that the window belongs to the reader in both modes.
    const traced =
      state.mode === "trace" && state.traceId !== undefined
        ? traceSteps(state.world, state.traceId)
        : [];
    const traceSpan =
      traced.length > 0
        ? { from: traced[0]?.date, to: traced[traced.length - 1]?.date }
        : undefined;

    const span = state.span ?? traceSpan ?? domainSpan;

    const steps = viewSteps(state.world, {
      mode: state.mode,
      traceId: state.traceId,
      span,
      query: state.query,
      tags: state.tags,
    });
    // The arrows move through the steps, so the position is remembered
    // rather than worked out from the date: two steps can share a date,
    // and the reader has to be able to step back into the earlier of
    // them. When the step is not in the list any more - the trace or the
    // filter changed - the date decides instead.
    const index = findStep(steps, state.stepKey, state.date);
    const focused = steps[index];

    const tickIds = new Set<string>();
    for (const step of steps) {
      if (step.eventId !== undefined) {
        tickIds.add(step.eventId);
      }
    }
    const activeEventId =
      state.selection?.kind === "event" ? state.selection.id : focused?.eventId;
    timeline.render(state.world, currentDomain, span, state.date, tickIds, activeEventId);
    stepBar.render(
      steps.map((step) => ({ label: step.label, date: displayDate(state.world, step.date) })),
      index,
    );

    if (traceSelect.value !== (state.traceId ?? "")) {
      traceSelect.value = state.traceId ?? "";
    }
    const shownNow = new Set(state.shownTraces ?? []);
    for (const box of document.querySelectorAll<HTMLInputElement>(
      "#traces-list input[type=checkbox]",
    )) {
      box.checked = shownNow.has(box.dataset.traceId ?? "");
    }
    const clearShownTraces = document.querySelector<HTMLButtonElement>("#clear-shown-traces");
    if (clearShownTraces !== null) {
      clearShownTraces.hidden = shownNow.size === 0;
    }
    if (clearTraceButton !== null) {
      clearTraceButton.hidden = state.mode !== "trace";
    }
    if (domainReadoutElement !== null) {
      domainReadoutElement.textContent =
        currentDomain !== undefined ? `${currentDomain.from.raw} – ${currentDomain.to.raw}` : "";
    }
    if (playheadReadoutElement !== null) {
      playheadReadoutElement.textContent = state.date !== undefined ? `At: ${state.date.raw}` : "";
    }
    if (state.world !== undefined) {
      ensureChapterInput(state.world);
    }
    if (
      state.date !== undefined &&
      document.activeElement !== chapterInput &&
      document.activeElement !== dateInput
    ) {
      const raw = state.date.raw;
      if (chapterInput !== null) {
        if (!Array.from(chapterInput.options).some((option) => option.value === raw)) {
          chapterInput.insertAdjacentHTML(
            "beforeend",
            `<option value="${escapeHtml(raw)}">${escapeHtml(raw)}</option>`,
          );
        }
        chapterInput.value = raw;
      } else if (dateInput !== null) {
        dateInput.value = raw;
      }
    }
    if (resetSpanButton !== null) {
      const atFullSpan =
        span !== undefined &&
        domainSpan !== undefined &&
        span.from.raw === domainSpan.from.raw &&
        span.to.raw === domainSpan.to.raw;
      resetSpanButton.hidden = span === undefined || atFullSpan;
    }

    // Show floating banner when the focused/selected event is a general timeline-only event
    if (generalBannerElement !== null) {
      const activeEvent =
        activeEventId !== undefined
          ? state.world.events.find((e) => e.id === activeEventId)
          : undefined;
      if (activeEvent !== undefined && !eventHasPosition(state.world, activeEvent, state.date)) {
        generalBannerElement.innerHTML = `<span class="banner-pill">Timeline event</span> <strong>${escapeHtml(displayDate(state.world, activeEvent.when))}</strong> — <button type="button" class="banner-link" data-kind="event" data-id="${escapeHtml(activeEvent.id)}">${escapeHtml(activeEvent.title)}</button>`;
        generalBannerElement.hidden = false;
      } else {
        generalBannerElement.hidden = true;
        generalBannerElement.innerHTML = "";
      }
    }

    const tracedPerson =
      state.mode === "trace" && state.traceId !== undefined
        ? state.world.people.find((p) => p.id === state.traceId)
        : undefined;

    mapView.render({
      world: state.world,
      mapId: state.mapId,
      date: state.date,
      span,
      focusEventId: state.mode === "trace" ? focused?.eventId : undefined,
      selectedId: state.selection?.kind === "location" ? state.selection.id : undefined,
      selectedEventId: state.selection?.kind === "event" ? state.selection.id : undefined,
      visibleEventIds: tickIds,
    });
    const followId = state.mode === "trace" ? state.traceId : undefined;
    const paths: { points: PathPoint[]; color?: string | undefined }[] = [];
    if (followId !== undefined) {
      paths.push({
        points: tracePath(state.world, followId, state.date),
        color: tracedPerson?.color,
      });
    }
    for (const id of state.shownTraces ?? []) {
      if (id === followId) {
        continue;
      }
      paths.push({
        points: tracePath(state.world, id, state.date),
        color: shownTraceColor(state.world, id),
      });
    }
    mapView.setPaths(paths);

    if (everything || changed.has("mapId")) {
      renderBreadcrumb(state);
    }
    renderActiveFilters(state);
    renderCard(state, tickIds);
    renderResults(state);
    updateLink(state);
  };
  store.subscribe(renderState);

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const mapButton = target.closest<HTMLElement>("[data-map]");
    if (mapButton !== null && mapButton.dataset.map !== undefined) {
      event.preventDefault();
      store.set({ mapId: mapButton.dataset.map });
      return;
    }
    const personElement = target.closest<HTMLElement>("[data-person]");
    if (personElement !== null && personElement.dataset.person !== undefined) {
      event.preventDefault();
      const id = personElement.dataset.person;
      store.set({
        mode: "trace",
        traceId: id,
        span: traceSpanOf(world, id) ?? store.get().span,
        selection: { kind: "person", id },
      });
      return;
    }
    const resultElement = target.closest<HTMLElement>("[data-kind]");
    if (resultElement !== null && resultElement.dataset.id !== undefined) {
      event.preventDefault();
      const kind = resultElement.dataset.kind;
      const id = resultElement.dataset.id;
      if (kind === "person") {
        store.set({
          mode: "trace",
          traceId: id,
          span: traceSpanOf(world, id) ?? store.get().span,
          selection: { kind: "person", id },
        });
      } else if (kind === "location") {
        store.set({ selection: { kind: "location", id } });
      } else {
        // An event. The links in a place's card ask to jump to it: the
        // reader clicked a line in a list and wants to land on it, not
        // just read about it.
        const found = world.events.find((entry) => entry.id === id);
        const wants = resultElement.dataset.jump !== undefined && found !== undefined;
        const place = wants && found !== undefined ? eventPlace(world, found) : undefined;
        store.set({
          ...(wants && found !== undefined
            ? {
                date: found.when,
                stepKey: `event:${id}`,
                ...(place?.mapId !== undefined ? { mapId: place.mapId } : {}),
              }
            : {}),
          selection: { kind: "event", id },
        });
        if (place?.at !== undefined) {
          mapView.focusPixel(place.at[0], place.at[1], cardFocusOffset());
        }
      }
      return;
    }
    const traceClear = target.closest<HTMLElement>("[data-trace-clear]");
    if (traceClear !== null && traceClear.dataset.traceClear !== undefined) {
      event.preventDefault();
      const id = traceClear.dataset.traceClear;
      store.set({
        shownTraces: (store.get().shownTraces ?? []).filter((entry) => entry !== id),
      });
      return;
    }
    const tagElement = target.closest<HTMLElement>("[data-tag]");
    if (tagElement !== null && tagElement.dataset.tag !== undefined) {
      event.preventDefault();
      const tag = tagElement.dataset.tag;
      const current = store.get().tags ?? [];
      const next = current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag];
      store.set({ tags: next });
      return;
    }
    if (target.closest("#clear-query-chip") !== null) {
      event.preventDefault();
      if (searchInput !== null) {
        searchInput.value = "";
      }
      store.set({ query: undefined });
      return;
    }
    if (target.closest("#close-card") !== null) {
      event.preventDefault();
      store.set({ selection: undefined });
    }
  });

  clearTraceButton?.addEventListener("click", () => {
    traceSelect.value = "";
    store.set({ mode: "span", traceId: undefined });
  });

  resetSpanButton?.addEventListener("click", () => {
    // "Full timeline" means the whole domain in both modes, so it also
    // escapes a trace's seeded window.
    const domain = eventDomain(store.get().world);
    store.set({ span: domain !== undefined ? { from: domain.from, to: domain.to } : undefined });
  });

  document.addEventListener("keydown", (event) => {
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement
    ) {
      return;
    }
    if (event.key === "ArrowLeft" && !prevButton.disabled) {
      event.preventDefault();
      prevButton.click();
    } else if (event.key === "ArrowRight" && !nextButton.disabled) {
      event.preventDefault();
      nextButton.click();
    } else if (event.key === "Escape" && filtersPanelElement?.classList.contains("open")) {
      filtersPanelElement.classList.remove("open");
      filtersToggleElement?.setAttribute("aria-expanded", "false");
    } else if (event.key === "Escape" && store.get().selection !== undefined) {
      store.set({ selection: undefined });
    }
  });

  traceSelect.addEventListener("change", () => {
    const value = traceSelect.value;
    if (value === "") {
      store.set({ mode: "span", traceId: undefined });
      return;
    }
    store.set({
      mode: "trace",
      traceId: value,
      span: traceSpanOf(world, value) ?? store.get().span,
      ...jumpToStart(world, value, store.get().date),
    });
  });

  searchInput?.addEventListener("input", () => {
    store.set({ query: searchInput.value });
  });

  dateForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = (chapterInput ?? dateInput)?.value.trim() ?? "";
    if (raw === "") {
      return;
    }
    try {
      store.set({ date: parseDate(raw, calendar), stepKey: undefined });
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  if (initialDate !== undefined) {
    if (chapterInput !== null) {
      chapterInput.value = initialDate.raw;
    } else if (dateInput !== null) {
      dateInput.value = initialDate.raw;
    }
  }
  if (searchInput !== null && store.get().query !== undefined) {
    searchInput.value = store.get().query ?? "";
  }

  renderBreadcrumb(store.get());
  renderState(store.get(), new Set());
}

/**
 * When the viewer is embedded in a page, offer a way out of it.
 *
 * The link carries the current view, so it lands where the reader is.
 */
function setupEmbedLink(): void {
  if (window.self === window.top) {
    return;
  }
  const topbar = document.querySelector<HTMLElement>("#topbar");
  if (topbar === null) {
    return;
  }
  const link = document.createElement("a");
  link.href = window.location.href;
  link.className = "embed-link";
  link.textContent = "Open full screen";
  topbar.appendChild(link);
}

/** How far event focus should shift up: the open card's height, so the
 *  point centers in the visible area rather than under the card. */
function cardFocusOffset(): number {
  if (cardElement === null || cardElement.hidden || !isPhoneView()) {
    return 0;
  }
  return cardElement.offsetHeight;
}

/** The span a trace opens on: the traced person's first-to-last step. */
function traceSpanOf(world: ResolvedWorld, traceId: string): Span | undefined {
  const steps = traceSteps(world, traceId);
  if (steps.length === 0) {
    return undefined;
  }
  return { from: steps[0]?.date, to: steps[steps.length - 1]?.date };
}

function updateLink(state: AppState): void {
  const link = writeLink({
    map: state.mapId,
    date: state.date?.raw,
    span: state.span !== undefined ? `${state.span.from.raw}..${state.span.to.raw}` : undefined,
    trace: state.traceId,
    traces: (state.shownTraces ?? []).length > 0 ? state.shownTraces?.join(",") : undefined,
    event: state.selection?.kind === "event" ? state.selection.id : undefined,
    query: state.query !== undefined && state.query !== "" ? state.query : undefined,
  });
  if (link !== window.location.hash) {
    window.history.replaceState(null, "", link);
  }
}

void boot();
