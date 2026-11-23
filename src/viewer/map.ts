/**
 * Interactive Leaflet map for the Timewright viewer.
 *
 * Uses Leaflet's CRS.Simple directly in image pixel space:
 * - Image bounds are `[[0, 0], [imageHeight, imageWidth]]`
 * - Image pixel `(x, y)` from top-left maps cleanly to Leaflet LatLng `[imageHeight - y, x]`
 *
 * Because markers live natively in CRS.Simple coordinate space, they never
 * drift or vanish during zoom/pan animations, and off-screen markers remain
 * properly placed when the reader pans to them.
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { DateBound } from "../core/dates.js";
import { compareBounds } from "../core/dates.js";
import {
  eventPlace,
  imageForDate,
  landingPlace,
  locationVisibleAt,
  projectToMap,
  resolveLocationAt,
} from "../core/derive.js";
import type { ResolvedEvent, ResolvedWorld } from "../core/model.js";
import type { PathPoint, Span } from "../core/steps.js";
import { escapeHtml } from "./cards.js";

/** Event focus zooms this far above the whole-map fit. */
const FOCUS_ZOOM_OFFSET = 1.5;

export interface MapViewOptions {
  element: HTMLElement;
  onLocation: (id: string, openSubmap?: string) => void;
  onEvent: (id: string) => void;
  onJumpMap: (mapId: string) => void;
  onImageMissing: (message: string) => void;
  onMapClick?: () => void;
}

export function assetUrl(path: string | undefined): string | undefined {
  if (path === undefined || path === "") {
    return undefined;
  }
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${import.meta.env.BASE_URL}${path}`;
}

export interface RenderMapOptions {
  world: ResolvedWorld;
  mapId: string;
  date?: DateBound | undefined;
  span?: Span | undefined;
  focusEventId?: string | undefined;
  selectedId?: string | undefined;
  /** The selected event, when the reader has one open. */
  selectedEventId?: string | undefined;
  visibleEventIds?: Set<string> | undefined;
}

export class MapView {
  private readonly map: L.Map;
  private readonly markers: L.LayerGroup;
  private readonly pathLayer: L.LayerGroup;
  private readonly options: MapViewOptions;
  private overlay?: L.ImageOverlay;
  private currentMapId?: string;
  private currentImage?: string;
  private imageWidth = 1000;
  private imageHeight = 700;
  private hasView = false;
  private lastRender?: RenderMapOptions;
  private paths: { points: PathPoint[]; color: string }[] = [];
  /** The zoom that fits the whole current map, for focus math. */
  private fitZoom?: number | undefined;
  /** A focus waiting for the current image to finish loading. */
  private pendingFocus?: { x: number; y: number; offsetYPx: number } | undefined;
  private imageLoaded = false;
  private currentCredit: string | undefined;

  constructor(options: MapViewOptions) {
    this.options = options;
    this.map = L.map(options.element, {
      crs: L.CRS.Simple,
      minZoom: -4,
      maxZoom: 4,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      // Pinch is the zoom gesture on touch screens; the corner buttons
      // only spend map space there.
      zoomControl: !window.matchMedia("(pointer: coarse)").matches,
      attributionControl: true,
    });
    this.map.on("click", () => this.options.onMapClick?.());
    this.map.attributionControl.setPrefix("");
    this.map.attributionControl.addAttribution("Timewright");
    this.pathLayer = L.layerGroup().addTo(this.map);
    this.markers = L.layerGroup().addTo(this.map);
  }

  get zoom(): number {
    return this.map.getZoom();
  }

  get overlayImage(): HTMLImageElement | undefined {
    const element = this.overlay?.getElement();
    return element instanceof HTMLImageElement ? element : undefined;
  }

  /** Convert image pixel `(x, y)` (origin top-left) to CRS.Simple LatLng. */
  private pixelToLatLng(x: number, y: number): L.LatLng {
    return L.latLng(this.imageHeight - y, x);
  }

  /** Smoothly pan to an image pixel if it is outside the comfortable viewport. */
  panToPixel(x: number, y: number): void {
    const target = this.pixelToLatLng(x, y);
    if (!this.map.getBounds().pad(-0.12).contains(target)) {
      this.map.panTo(target, { animate: true });
    }
  }

  /**
   * Center on an image pixel and zoom in so it reads: an event focus
   * should fill about a third of the viewport, not stay a speck on a
   * whole-map view. Never zooms out, and waits for a loading image so a
   * map switch cannot clobber the view with its fit-everything reset.
   */
  focusPixel(x: number, y: number, offsetYPx = 0): void {
    this.pendingFocus = { x, y, offsetYPx };
    if (this.imageLoaded) {
      this.applyPendingFocus();
    }
  }

  private applyPendingFocus(): void {
    const focus = this.pendingFocus;
    if (focus === undefined) {
      return;
    }
    const zoom = Math.min(
      this.map.getMaxZoom(),
      Math.max(this.zoom, (this.fitZoom ?? 0) + FOCUS_ZOOM_OFFSET),
    );
    let center = this.pixelToLatLng(focus.x, focus.y);
    if (focus.offsetYPx > 0) {
      // Shift the center down so the point lands above mid-screen, clear
      // of whatever opens over the lower part of the map.
      const point = this.map.latLngToContainerPoint(center);
      center = this.map.containerPointToLatLng(point.add([0, focus.offsetYPx / 2]));
    }
    this.map.setView(center, zoom, { animate: false });
    this.pendingFocus = undefined;
  }

  /**
   * Show the map's credit in the corner, next to the Timewright tag. The
   * string arrives from world data, so it stays text: no markup is let
   * through into the attribution control.
   */
  private setCredit(credit: string | undefined): void {
    const text = credit?.trim().replace(/[<>]/g, "");
    if (text === undefined || text === "") {
      if (this.currentCredit !== undefined) {
        this.map.attributionControl.removeAttribution(this.currentCredit);
        this.currentCredit = undefined;
      }
      return;
    }
    if (text === this.currentCredit) {
      return;
    }
    if (this.currentCredit !== undefined) {
      this.map.attributionControl.removeAttribution(this.currentCredit);
    }
    this.map.attributionControl.addAttribution(text);
    this.currentCredit = text;
  }

  render(opts: RenderMapOptions): void {
    this.lastRender = opts;
    const { world, mapId, date } = opts;
    const mapRecord = world.maps.find((entry) => entry.id === mapId);
    if (mapRecord === undefined) {
      this.markers.clearLayers();
      this.pathLayer.clearLayers();
      this.options.onImageMissing("No map found to display.");
      return;
    }
    this.setCredit(mapRecord.credit);

    const image = imageForDate(mapRecord, date);
    const url = assetUrl(image?.path);
    const mapChanged = mapId !== this.currentMapId;
    this.currentMapId = mapId;

    if (url !== this.currentImage || mapChanged) {
      this.currentImage = url;
      this.setImage(url, mapRecord.size, mapChanged);
      return;
    }

    this.drawMarkers();
    this.drawPath();
  }

  setPaths(paths: { points: PathPoint[]; color?: string | undefined }[]): void {
    this.paths = paths.map((path) => ({
      points: path.points,
      color: path.color !== undefined && path.color !== "" ? path.color : "#b3541e",
    }));
    this.drawPath();
  }

  private setImage(
    url: string | undefined,
    declaredSize: [number, number] | undefined,
    resetFit: boolean,
  ): void {
    this.imageLoaded = false;
    if (this.overlay !== undefined) {
      this.overlay.remove();
      this.overlay = undefined;
    }
    this.markers.clearLayers();
    this.pathLayer.clearLayers();

    if (url === undefined) {
      this.options.onImageMissing("This map has no image configured yet.");
      return;
    }

    this.imageWidth = declaredSize?.[0] ?? 1000;
    this.imageHeight = declaredSize?.[1] ?? 700;

    if (!this.hasView || resetFit) {
      this.map.setView([this.imageHeight / 2, this.imageWidth / 2], 0, { animate: false });
      this.hasView = true;
    }

    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [this.imageHeight, this.imageWidth],
    ];
    const overlay = L.imageOverlay(url, bounds);
    this.overlay = overlay;

    overlay.on("load", () => {
      const element = overlay.getElement();
      const measuredW = element instanceof HTMLImageElement ? element.naturalWidth : 0;
      const measuredH = element instanceof HTMLImageElement ? element.naturalHeight : 0;
      // Use declared dimensions when specified so coordinates match the world definition;
      // fall back to natural dimensions when unspecified.
      this.imageWidth = declaredSize?.[0] ?? (measuredW > 0 ? measuredW : this.imageWidth);
      this.imageHeight = declaredSize?.[1] ?? (measuredH > 0 ? measuredH : this.imageHeight);

      const finalBounds = L.latLngBounds([
        [0, 0],
        [this.imageHeight, this.imageWidth],
      ]);
      overlay.setBounds(finalBounds);
      this.imageLoaded = true;
      this.fitZoom = this.map.getBoundsZoom(finalBounds);
      if (resetFit) {
        if (this.pendingFocus === undefined) {
          this.map.fitBounds(finalBounds, { padding: [18, 18], animate: false });
        } else {
          this.applyPendingFocus();
        }
      }
      this.options.onImageMissing("");
      this.drawMarkers();
      this.drawPath();
    });

    overlay.on("error", () => {
      this.options.onImageMissing(`Could not load map image (${url}).`);
    });

    overlay.addTo(this.map);
  }

  private drawMarkers(): void {
    this.markers.clearLayers();
    const opts = this.lastRender;
    if (opts === undefined) {
      return;
    }
    const { world, mapId, date, span, focusEventId, selectedId, selectedEventId, visibleEventIds } = opts;

    // The events that land on a place's pin. An event that happens at a
    // place is counted on that place's badge instead of floating beside
    // it as a diamond of its own.
    const eventsAtPin = new Map<string, ResolvedEvent[]>();
    const countOn = (locationId: string, event: ResolvedEvent): void => {
      const list = eventsAtPin.get(locationId);
      if (list === undefined) {
        eventsAtPin.set(locationId, [event]);
      } else {
        list.push(event);
      }
    };

    // The events that need a pin of their own: a point the creator typed
    // on the map, or the one being traced.
    const eventsToDraw: {
      event: ResolvedEvent;
      x: number;
      y: number;
      projectedVia?: string | undefined;
    }[] = [];

    for (const event of world.events) {
      if (focusEventId !== undefined) {
        if (event.id !== focusEventId) {
          continue;
        }
      } else {
        if (visibleEventIds !== undefined && !visibleEventIds.has(event.id)) {
          continue;
        }
        if (span !== undefined) {
          if (compareBounds(event.when, span.from) < 0 || compareBounds(event.when, span.to) > 0) {
            continue;
          }
        }
      }

      const place = eventPlace(world, event, date ?? event.when);
      if (place?.mapId === undefined || place.at === undefined) {
        continue;
      }
      if (place.mapId === mapId) {
        if (place.location !== undefined && focusEventId === undefined) {
          // It happens at a place on this map: it belongs on that place's
          // badge, not beside it as a diamond.
          countOn(place.location.id, event);
        } else {
          eventsToDraw.push({ event, x: place.at[0], y: place.at[1] });
        }
      } else {
        // Check if this event sits inside a sub-map anchored on the current map
        const projected = projectToMap(world, place.mapId, place.at, mapId, date ?? event.when);
        if (projected?.viaLocation !== undefined) {
          countOn(projected.viaLocation.id, event);
          if (focusEventId === event.id) {
            eventsToDraw.push({
              event,
              x: projected.at[0],
              y: projected.at[1],
              projectedVia: projected.viaLocation.name,
            });
          }
        }
      }
    }

    // The place the reader has open, so its pin can be marked.
    const activeEvent =
      selectedEventId !== undefined
        ? world.events.find((entry) => entry.id === selectedEventId)
        : undefined;
    const activePlace =
      activeEvent !== undefined ? landingPlace(world, activeEvent, mapId, date) : undefined;

    // 1. Draw Fixed + Active Mobile Locations on this map
    if (focusEventId === undefined) {
      for (const location of world.locations) {
        if (!locationVisibleAt(location, date)) {
          continue;
        }

        let locCoords: [number, number] | undefined;
        if (location.kind === "mobile") {
          const resolved = resolveLocationAt(world, location.id, date);
          if (resolved?.mapId === mapId) {
            locCoords = resolved.at;
          }
        } else if (location.map === mapId && location.at !== undefined) {
          locCoords = location.at;
        }

        if (locCoords === undefined) {
          continue;
        }

        const isSubmapPortal = location.opens !== undefined;
        const isMobile = location.kind === "mobile";
        const eventsHere = eventsAtPin.get(location.id) ?? [];
        // The pin is marked when the place itself is selected, and when
        // the place the reader has open is this one.
        const isSelected = selectedId === location.id || activePlace?.id === location.id;

        const classes = [
          "tw-pin",
          "tw-pin-location",
          isSubmapPortal ? "has-submap" : "",
          isMobile ? "is-mobile" : "",
          isSelected ? "is-selected" : "",
        ]
          .filter(Boolean)
          .join(" ");

        // The count of events at this place, and the way into the sub-map
        // it opens. Both can be true at once, so they sit on opposite
        // corners of the pin.
        const badgeHtml =
          eventsHere.length > 0
            ? `<span class="tw-pin-badge" title="${eventsHere.length} event${eventsHere.length === 1 ? "" : "s"} here">${eventsHere.length}</span>`
            : "";
        const portalHtml = isSubmapPortal
          ? `<span class="tw-pin-portal" title="Opens sub-map">↘</span>`
          : "";

        const icon = L.divIcon({
          className: "tw-div-icon",
          html: `<div class="${classes}"><span class="tw-pin-dot"></span>${badgeHtml}${portalHtml}<span class="tw-pin-label">${escapeHtml(location.name)}</span></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });

        const marker = L.marker(this.pixelToLatLng(locCoords[0], locCoords[1]), { icon });
        const submapName =
          location.opens !== undefined
            ? world.maps.find((m) => m.id === location.opens)?.name ?? location.opens
            : undefined;
        const tip = submapName
          ? `<strong>${escapeHtml(location.name)}</strong><br/><span class="tip-sub">Click for card · Opens ${escapeHtml(submapName)}</span>`
          : escapeHtml(location.name);
        marker.bindTooltip(tip, { direction: "top", offset: [0, -10] });
        marker.on("click", () => {
          this.options.onLocation(location.id);
        });
        marker.on("dblclick", (ev) => {
          if (location.opens !== undefined) {
            L.DomEvent.stopPropagation(ev);
            this.options.onJumpMap(location.opens);
          }
        });
        marker.addTo(this.markers);
      }
    }

    // 2. Draw the events that have a pin of their own. A point is drawn
    // exactly where it was put - no offset, so it never drifts as the
    // reader zooms. Two events on the same point would sit on top of
    // each other, so they are nudged apart by a few screen pixels.
    const coordCounts = new Map<string, number>();
    for (const item of eventsToDraw) {
      const key = `${Math.round(item.x)}:${Math.round(item.y)}`;
      const seenIndex = coordCounts.get(key) ?? 0;
      coordCounts.set(key, seenIndex + 1);

      const isFocused = selectedEventId === item.event.id || focusEventId === item.event.id;
      const offsetClass = seenIndex === 0 ? "" : ` tw-pin-offset-${Math.min(seenIndex, 4)}`;
      const icon = L.divIcon({
        className: "tw-div-icon",
        html: `<div class="tw-pin tw-pin-event${isFocused ? " is-selected" : ""}${offsetClass}"><span class="tw-pin-diamond"></span></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const marker = L.marker(this.pixelToLatLng(item.x, item.y), {
        icon,
        zIndexOffset: isFocused ? 500 : 200,
      });
      const viaText =
        item.projectedVia !== undefined ? ` <em>(in ${escapeHtml(item.projectedVia)})</em>` : "";
      marker.bindTooltip(
        `<strong>${escapeHtml(item.event.title)}</strong>${viaText}<br/><span class="tip-sub">${escapeHtml(item.event.when.raw)}</span>`,
        { direction: "top", offset: [0, -10] },
      );
      marker.on("click", () => this.options.onEvent(item.event.id));
      marker.addTo(this.markers);
    }
  }

  private drawPath(): void {
    this.pathLayer.clearLayers();
    const opts = this.lastRender;
    if (opts === undefined || this.paths.length === 0) {
      return;
    }
    const { world, mapId, date } = opts;

    for (const path of this.paths) {
      let run: L.LatLng[] = [];

      for (const point of path.points) {
        if (point.mapId === undefined || point.at === undefined) {
          continue;
        }

        // Project sub-map points onto parent maps so cross-level journeys stay continuous on the overworld!
        const onThisMap =
          point.mapId === mapId
            ? { at: point.at }
            : projectToMap(world, point.mapId, point.at, mapId, point.date ?? date);

        if (onThisMap !== undefined) {
          const latLng = this.pixelToLatLng(onThisMap.at[0], onThisMap.at[1]);
          run.push(latLng);

          L.circleMarker(latLng, {
            radius: 4.5,
            color: "#fff",
            weight: 1.5,
            fillColor: path.color,
            fillOpacity: 1,
          })
            .bindTooltip(`${point.date.raw}${point.locationName ? ` · ${point.locationName}` : ""}`, {
              direction: "top",
            })
            .addTo(this.pathLayer);
        } else {
          // Path left this map hierarchy for an unrelated or parent map; flush current run
          if (run.length > 0) {
            const lastLatLng = run[run.length - 1];
            this.addPolylineRun(run, path.color);
            run = [];
            if (lastLatLng !== undefined && point.mapId !== undefined) {
              const targetMapId = point.mapId;
              const targetMapName =
                world.maps.find((m) => m.id === targetMapId)?.name ?? targetMapId;
              const jumpMarker = L.circleMarker(lastLatLng, {
                radius: 8,
                color: "#fff",
                weight: 2,
                fillColor: "#6a3fb5",
                fillOpacity: 0.92,
              }).bindTooltip(`Continues on ${targetMapName} (click to switch map)`, {
                direction: "top",
              });
              jumpMarker.on("click", () => this.options.onJumpMap(targetMapId));
              jumpMarker.addTo(this.pathLayer);
            }
          }
        }
      }

      this.addPolylineRun(run, path.color);
    }
  }

  private addPolylineRun(run: L.LatLng[], color: string): void {
    if (run.length < 2) {
      return;
    }
    L.polyline(run, {
      color,
      weight: 3.5,
      opacity: 0.88,
      dashArray: "8 6",
    }).addTo(this.pathLayer);
  }
}
