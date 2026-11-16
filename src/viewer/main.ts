/**
 * The viewer: load the world, show the map, walk the timeline.
 */

import "./styles.css";

import { parseDate, type DateBound } from "../core/dates.js";
import { eventDomain } from "../core/scale.js";
import { eventPlace, mapChain, sortedEvents } from "../core/derive.js";
import { stepIndex, tracePath, traceSteps, traceable, viewSteps, type Span } from "../core/steps.js";
import type { ResolvedEvent, ResolvedLocation, ResolvedPerson, ResolvedWorld } from "../core/model.js";
import { escapeHtml, renderMarkdown } from "./cards.js";
import { installDebug } from "./debug.js";
import { readLink, writeLink } from "./link.js";
import { MapView } from "./map.js";
import { StepBar } from "./stepbar.js";
import { Store, type AppState, type Changed } from "./state.js";
import { Timeline } from "./timeline.js";

const statusElement = document.querySelector<HTMLElement>("#status");
const cardElement = document.querySelector<HTMLElement>("#card");
const breadcrumbElement = document.querySelector<HTMLElement>("#breadcrumb");
const mapElement = document.querySelector<HTMLElement>("#map");
const dateForm = document.querySelector<HTMLFormElement>("#date-form");
const dateInput = document.querySelector<HTMLInputElement>("#date-input");
const prevButton = document.querySelector<HTMLButtonElement>("#prev-step");
const nextButton = document.querySelector<HTMLButtonElement>("#next-step");
const stepLabel = document.querySelector<HTMLElement>("#step-label");
const traceSelect = document.querySelector<HTMLSelectElement>("#trace-select");
const searchInput = document.querySelector<HTMLInputElement>("#search");
const resultsElement = document.querySelector<HTMLElement>("#results");
const contextElement = document.querySelector<HTMLElement>("#context");
const stripElement = document.querySelector<HTMLElement>("#strip");

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

function eventCard(world: ResolvedWorld, event: ResolvedEvent): string {
  const place = world.locations.find((location) => event.where?.location === location.id);
  const where = place !== undefined ? place.name : event.where?.map !== undefined ? `on ${event.where.map}` : "";
  const people = event.people
    .map((id) => world.people.find((person) => person.id === id))
    .filter((person): person is ResolvedPerson => person !== undefined)
    .map((person) => personLink(person))
    .join(", ");
  return [
    `<h2>${escapeHtml(event.title)}</h2>`,
    `<p class="meta">${escapeHtml(event.when.raw)}${where !== "" ? ` · ${escapeHtml(where)}` : ""}</p>`,
    people !== "" ? `<p class="people">${people}</p>` : "",
    tagChips(event.tags),
    renderMarkdown(event.card),
  ].join("\n");
}

function locationCard(world: ResolvedWorld, location: ResolvedLocation): string {
  const people = world.people
    .filter((person) => person.stays.some((stay) => stay.at === location.id))
    .map((person) => personLink(person));
  return [
    `<h2>${escapeHtml(location.name)}</h2>`,
    location.kind === "mobile" ? `<p class="meta">mobile</p>` : "",
    people.length > 0 ? `<p class="people">${people.join(", ")}</p>` : "",
    tagChips(location.tags),
    renderMarkdown(location.card ?? location.bio),
  ].join("\n");
}

function personCard(person: ResolvedPerson): string {
  const life = [person.born?.raw, person.died?.raw].filter((part) => part !== undefined).join(" – ");
  return [
    `<h2>${escapeHtml(person.name)}</h2>`,
    life !== "" ? `<p class="meta">${escapeHtml(life)}</p>` : "",
    tagChips(person.tags),
    renderMarkdown(person.bio),
  ].join("\n");
}

function renderCard(state: AppState): void {
  if (cardElement === null) {
    return;
  }
  const selection = state.selection;
  if (selection === undefined) {
    cardElement.hidden = true;
    cardElement.innerHTML = "";
    return;
  }
  let html = "";
  if (selection.kind === "event") {
    const event = state.world.events.find((entry) => entry.id === selection.id);
    html = event !== undefined ? eventCard(state.world, event) : "";
  } else if (selection.kind === "location") {
    const location = state.world.locations.find((entry) => entry.id === selection.id);
    html = location !== undefined ? locationCard(state.world, location) : "";
  } else {
    const person = state.world.people.find((entry) => entry.id === selection.id);
    html = person !== undefined ? personCard(person) : "";
  }
  cardElement.innerHTML = `${html}<p><a href="#" id="close-card">Close</a></p>`;
  cardElement.hidden = false;
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

  const link = readLink(window.location.hash);
  const domain = eventDomain(world);
  const firstEvent = sortedEvents(world)[0];

  let initialDate: DateBound | undefined = world.start ?? firstEvent?.when;
  if (link.date !== undefined) {
    try {
      initialDate = parseDate(link.date);
    } catch {
      // A bad date in the link is ignored.
    }
  }
  let initialSpan: Span | undefined;
  if (link.span !== undefined) {
    const [from, to] = link.span.split("..");
    try {
      if (from !== undefined && to !== undefined) {
        initialSpan = { from: parseDate(from), to: parseDate(to) };
      }
    } catch {
      // A bad span in the link is ignored.
    }
  }

  const store = new Store({
    world,
    mapId: link.map ?? world.overworld ?? world.maps[0]?.id ?? "",
    date: initialDate,
    span: initialSpan,
    mode: link.trace !== undefined ? "trace" : "span",
    traceId: link.trace,
    selection: link.event !== undefined ? { kind: "event", id: link.event } : undefined,
    query: link.query,
  });

  const mapView = new MapView({
    element: mapElement,
    onLocation: (id) => {
      const location = world.locations.find((entry) => entry.id === id);
      if (location?.opens !== undefined) {
        store.set({ mapId: location.opens, selection: { kind: "location", id } });
        return;
      }
      store.set({ selection: { kind: "location", id } });
    },
    onEvent: (id) => {
      store.set({ selection: { kind: "event", id } });
    },
    onImageMissing: (message) => setStatus(message, true),
  });

  const stepBar = new StepBar({
    prev: prevButton,
    next: nextButton,
    label: stepLabel,
    onStep: (index) => {
      const state = store.get();
      const span = state.span ?? (domain !== undefined ? { from: domain.from, to: domain.to } : undefined);
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
        mapId: step.mapId ?? state.mapId,
        selection: step.eventId !== undefined ? { kind: "event", id: step.eventId } : undefined,
      });
    },
  });

  const timeline = new Timeline({
    context: contextElement,
    strip: stripElement,
    onDate: (date) => store.set({ date }),
    onSpan: (span) => store.set({ span }),
    onEvent: (eventId) => {
      const event = world.events.find((entry) => entry.id === eventId);
      if (event === undefined) {
        return;
      }
      const place = eventPlace(world, event);
      store.set({
        date: event.when,
        mapId: place?.mapId ?? store.get().mapId,
        selection: { kind: "event", id: eventId },
      });
    },
  });

  traceSelect.innerHTML = [
    '<option value="">Nobody traced</option>',
    ...traceable(world).map(
      (entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`,
    ),
  ].join("");
  traceSelect.value = store.get().traceId ?? "";

  const renderState = (state: AppState, changed: Changed): void => {
    // An empty changed set means "nothing in particular" - render it all.
    const everything = changed.size === 0;
    const currentDomain = eventDomain(state.world);
    const domainSpan =
      currentDomain !== undefined ? { from: currentDomain.from, to: currentDomain.to } : undefined;

    // Tracing shows the traced person's own timeline, not the whole world.
    const traced =
      state.mode === "trace" && state.traceId !== undefined
        ? traceSteps(state.world, state.traceId)
        : [];
    const traceSpan =
      traced.length > 0
        ? { from: traced[0]?.date, to: traced[traced.length - 1]?.date }
        : undefined;

    const span =
      state.mode === "trace" ? (traceSpan ?? domainSpan) : (state.span ?? domainSpan);

    const steps = viewSteps(state.world, {
      mode: state.mode,
      traceId: state.traceId,
      span,
      query: state.query,
      tags: state.tags,
    });
    const index = stepIndex(steps, state.date);
    const focused = steps[index];

    const tickIds = new Set<string>();
    for (const step of steps) {
      if (step.eventId !== undefined) {
        tickIds.add(step.eventId);
      }
    }
    timeline.render(state.world, currentDomain, span, state.date, tickIds);
    stepBar.render(
      steps.map((step) => step.label),
      index,
    );

    mapView.render(
      state.world,
      state.mapId,
      state.date,
      state.mode === "trace" ? focused?.eventId : undefined,
    );
    mapView.setPath(
      state.mode === "trace" && state.traceId !== undefined
        ? tracePath(state.world, state.traceId)
        : [],
    );

    if (everything || changed.has("mapId")) {
      renderBreadcrumb(state);
    }
    renderCard(state);
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
      store.set({ mode: "trace", traceId: id, selection: { kind: "person", id } });
      return;
    }
    const resultElement = target.closest<HTMLElement>("[data-kind]");
    if (resultElement !== null && resultElement.dataset.id !== undefined) {
      event.preventDefault();
      const kind = resultElement.dataset.kind;
      const id = resultElement.dataset.id;
      if (kind === "person") {
        store.set({ mode: "trace", traceId: id, selection: { kind: "person", id } });
      } else if (kind === "location") {
        store.set({ selection: { kind: "location", id } });
      } else {
        store.set({ selection: { kind: "event", id } });
      }
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
    if (target.closest("#close-card") !== null) {
      event.preventDefault();
      store.set({ selection: undefined });
    }
  });

  traceSelect.addEventListener("change", () => {
    const value = traceSelect.value;
    if (value === "") {
      store.set({ mode: "span", traceId: undefined });
      return;
    }
    store.set({ mode: "trace", traceId: value });
  });

  searchInput?.addEventListener("input", () => {
    store.set({ query: searchInput.value });
  });

  dateForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = dateInput?.value.trim() ?? "";
    if (raw === "") {
      return;
    }
    try {
      store.set({ date: parseDate(raw) });
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  if (dateInput !== null && initialDate !== undefined) {
    dateInput.value = initialDate.raw;
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

function updateLink(state: AppState): void {
  const link = writeLink({
    map: state.mapId,
    date: state.date?.raw,
    span: state.span !== undefined ? `${state.span.from.raw}..${state.span.to.raw}` : undefined,
    trace: state.traceId,
    event: state.selection?.kind === "event" ? state.selection.id : undefined,
    query: state.query !== undefined && state.query !== "" ? state.query : undefined,
  });
  if (link !== window.location.hash) {
    window.history.replaceState(null, "", link);
  }
}

void boot();
