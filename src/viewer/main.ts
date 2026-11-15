/**
 * The viewer: load the world, show the map, open cards.
 */

import "./styles.css";

import { parseDate, type ParsedDate } from "../core/dates.js";
import { mapChain, sortedEvents } from "../core/derive.js";
import type { ResolvedEvent, ResolvedLocation, ResolvedPerson, ResolvedWorld } from "../core/model.js";
import { escapeHtml, renderMarkdown } from "./cards.js";
import { MapView } from "./map.js";
import { Store, type AppState } from "./state.js";

const statusElement = document.querySelector<HTMLElement>("#status");
const cardElement = document.querySelector<HTMLElement>("#card");
const breadcrumbElement = document.querySelector<HTMLElement>("#breadcrumb");
const mapElement = document.querySelector<HTMLElement>("#map");
const dateForm = document.querySelector<HTMLFormElement>("#date-form");
const dateInput = document.querySelector<HTMLInputElement>("#date-input");

function setStatus(message: string): void {
  if (statusElement !== null) {
    statusElement.textContent = message;
  }
}

function escapeHtmlText(text: string): string {
  return escapeHtml(text);
}

function personLink(person: ResolvedPerson): string {
  return `<a href="#" class="person" data-person="${escapeHtmlText(person.id)}">${escapeHtmlText(person.name)}</a>`;
}

function eventCard(world: ResolvedWorld, event: ResolvedEvent): string {
  const place = world.locations.find((location) => event.where?.location === location.id);
  const where = place !== undefined ? place.name : event.where?.map !== undefined ? `on ${event.where.map}` : "";
  const people = event.people
    .map((id) => world.people.find((person) => person.id === id))
    .filter((person): person is ResolvedPerson => person !== undefined)
    .map((person) => personLink(person))
    .join(", ");
  const body = renderMarkdown(event.card);
  return [
    `<h2>${escapeHtmlText(event.title)}</h2>`,
    `<p class="meta">${escapeHtmlText(event.when.raw)}${where !== "" ? ` · ${escapeHtmlText(where)}` : ""}</p>`,
    people !== "" ? `<p class="people">${people}</p>` : "",
    body,
  ].join("\n");
}

function locationCard(world: ResolvedWorld, location: ResolvedLocation): string {
  const people = world.people
    .filter((person) => person.stays.some((stay) => stay.at === location.id))
    .map((person) => personLink(person));
  const body = renderMarkdown(location.card ?? location.bio);
  return [
    `<h2>${escapeHtmlText(location.name)}</h2>`,
    location.kind === "mobile" ? `<p class="meta">mobile</p>` : "",
    people.length > 0 ? `<p class="people">${people.join(", ")}</p>` : "",
    body,
  ].join("\n");
}

function personCard(person: ResolvedPerson): string {
  const life = [person.born?.raw, person.died?.raw].filter((part) => part !== undefined).join(" – ");
  const body = renderMarkdown(person.bio);
  return [
    `<h2>${escapeHtmlText(person.name)}</h2>`,
    life !== "" ? `<p class="meta">${escapeHtmlText(life)}</p>` : "",
    body,
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
  const parts = chain.map((map, index) =>
    index === chain.length - 1
      ? `<span>${escapeHtmlText(map.name)}</span>`
      : `<button type="button" data-map="${escapeHtmlText(map.id)}">${escapeHtmlText(map.name)}</button>`,
  );
  breadcrumbElement.innerHTML = parts.join(" › ");
}

async function boot(): Promise<void> {
  if (mapElement === null || cardElement === null) {
    setStatus("The viewer is missing its elements.");
    return;
  }

  let world: ResolvedWorld;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}world.json`);
    if (!response.ok) {
      setStatus(`Could not load world.json (${response.status}).`);
      return;
    }
    world = (await response.json()) as ResolvedWorld;
  } catch (error) {
    setStatus(`Could not load the world: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const firstEvent = sortedEvents(world)[0];
  const initialDate: ParsedDate | undefined = world.start ?? firstEvent?.when;
  const initialMap = world.overworld ?? world.maps[0]?.id ?? "";

  const store = new Store({
    world,
    mapId: initialMap,
    date: initialDate,
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
    onImageMissing: (message) => setStatus(message),
  });

  store.subscribe((state, changed) => {
    if (changed.has("mapId") || changed.has("date")) {
      mapView.render(state.world, state.mapId, state.date);
    }
    if (changed.has("mapId")) {
      renderBreadcrumb(state);
    }
    if (changed.has("selection")) {
      renderCard(state);
    }
  });

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
    const personLinkElement = target.closest<HTMLElement>("[data-person]");
    if (personLinkElement !== null && personLinkElement.dataset.person !== undefined) {
      event.preventDefault();
      store.set({ selection: { kind: "person", id: personLinkElement.dataset.person } });
      return;
    }
    if (target.closest("#close-card") !== null) {
      event.preventDefault();
      store.set({ selection: undefined });
    }
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

  renderBreadcrumb(store.get());
  mapView.render(store.get().world, store.get().mapId, store.get().date);
}

void boot();
