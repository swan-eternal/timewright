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
  locationVisibleAt,
  projectToMap,
  resolveLocationAt,
} from "../core/derive.js";
import type { ResolvedEvent, ResolvedWorld } from "../core/model.js";
import type { PathPoint, Span } from "../core/steps.js";
import { escapeHtml } from "./cards.js";

export interface MapViewOptions {
  element: HTMLElement;
  onLocation: (id: string, openSubmap?: string) => void;
  onEvent: (id: string) => void;
  onJumpMap: (mapId: string) => void;
  onImageMissing: (message: string) => void;
  onCaptionChange?: (caption: string | undefined) => void;
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
  private pathPoints: PathPoint[] = [];
  private pathColor = "#b3541e";

  constructor(options: MapViewOptions) {
    this.options = options;
    this.map = L.map(options.element, {
      crs: L.CRS.Simple,
      minZoom: -4,
      maxZoom: 4,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      attributionControl: true,
    });
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

    const image = imageForDate(mapRecord, date);
    this.options.onCaptionChange?.(image?.caption);
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

  setPath(points: PathPoint[], color?: string): void {
    this.pathPoints = points;
    this.pathColor = color !== undefined && color !== "" ? color : "#b3541e";
    this.drawPath();
  }

  private setImage(
    url: string | undefined,
    declaredSize: [number, number] | undefined,
    resetFit: boolean,
  ): void {
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
      if (resetFit) {
        this.map.fitBounds(finalBounds, { padding: [18, 18], animate: false });
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
    const { world, mapId, date, span, focusEventId, selectedId, visibleEventIds } = opts;

    // Count sub-map events inside visible span so parent locations can show activity counts
    const submapEventCounts = new Map<string, number>();

    // Collect events to draw on this map
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
        eventsToDraw.push({ event, x: place.at[0], y: place.at[1] });
      } else {
        // Check if this event sits inside a sub-map anchored on the current map
        const projected = projectToMap(world, place.mapId, place.at, mapId, date ?? event.when);
        if (projected?.viaLocation !== undefined) {
          submapEventCounts.set(
            projected.viaLocation.id,
            (submapEventCounts.get(projected.viaLocation.id) ?? 0) + 1,
          );
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
        const isSelected = selectedId === location.id;
        const nestedCount = submapEventCounts.get(location.id) ?? 0;

        const classes = [
          "tw-pin",
          "tw-pin-location",
          isSubmapPortal ? "has-submap" : "",
          isMobile ? "is-mobile" : "",
          isSelected ? "is-selected" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const badgeHtml =
          isSubmapPortal && nestedCount > 0
            ? `<span class="tw-pin-badge">${nestedCount}</span>`
            : isSubmapPortal
              ? `<span class="tw-pin-portal" title="Opens sub-map">↘</span>`
              : "";

        const icon = L.divIcon({
          className: "tw-div-icon",
          html: `<div class="${classes}"><span class="tw-pin-dot"></span>${badgeHtml}<span class="tw-pin-label">${escapeHtml(location.name)}</span></div>`,
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

    // 2. Draw Event markers (Slightly offset if multiple events share identical coordinates)
    const coordCounts = new Map<string, number>();
    for (const item of eventsToDraw) {
      const key = `${Math.round(item.x)}:${Math.round(item.y)}`;
      const seenIndex = coordCounts.get(key) ?? 0;
      coordCounts.set(key, seenIndex + 1);

      // Gentle spiral offset in screen/image space when several events happen at the same place
      const angle = seenIndex * 1.15;
      const radius = seenIndex === 0 ? 0 : 12 + seenIndex * 3;
      const ox = item.x + Math.cos(angle) * radius;
      const oy = item.y + Math.sin(angle) * radius;

      const isFocused = selectedId === item.event.id || focusEventId === item.event.id;
      const icon = L.divIcon({
        className: "tw-div-icon",
        html: `<div class="tw-pin tw-pin-event${isFocused ? " is-selected" : ""}"><span class="tw-pin-diamond"></span></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const marker = L.marker(this.pixelToLatLng(ox, oy), {
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
    if (opts === undefined || this.pathPoints.length === 0) {
      return;
    }
    const { world, mapId, date } = opts;

    let run: L.LatLng[] = [];

    for (const point of this.pathPoints) {
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
          fillColor: this.pathColor,
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
          this.addPolylineRun(run);
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

    this.addPolylineRun(run);
  }

  private addPolylineRun(run: L.LatLng[]): void {
    if (run.length < 2) {
      return;
    }
    L.polyline(run, {
      color: this.pathColor,
      weight: 3.5,
      opacity: 0.88,
      dashArray: "8 6",
    }).addTo(this.pathLayer);
  }
}
