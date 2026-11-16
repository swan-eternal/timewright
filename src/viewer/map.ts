/**
 * The map: Leaflet over a flat image, with markers on it.
 *
 * Leaflet's CRS.Simple is used so the map is a picture, not the world. Image
 * pixels are the coordinates: a location at [2120, 1180] is the pixel 2120
 * across and 1180 down. The pixel-to-marker conversion is measured from the
 * image as it is actually drawn, so it stays right at every zoom.
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { DateBound } from "../core/dates.js";
import { eventPlace, imageForDate, locationVisibleAt } from "../core/derive.js";
import type { ResolvedWorld } from "../core/model.js";
import type { PathPoint } from "../core/steps.js";

export interface MapViewOptions {
  element: HTMLElement;
  onLocation: (id: string) => void;
  onEvent: (id: string) => void;
  onImageMissing: (message: string) => void;
}

/**
 * Where an asset lives.
 *
 * In a normal build that is a path under the site. In the single-file
 * build it is a data URI, already in the file.
 */
export function assetUrl(path: string | undefined): string | undefined {
  if (path === undefined) {
    return undefined;
  }
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${import.meta.env.BASE_URL}${path}`;
}

interface MarkerItem {
  x: number;
  y: number;
  kind: "location" | "event";
  id: string;
  label: string;
}

export class MapView {
  private readonly map: L.Map;
  private readonly markers: L.LayerGroup;
  private readonly pathLayer: L.LayerGroup;
  private readonly options: MapViewOptions;
  private overlay?: L.ImageOverlay;
  private currentImage?: string;
  private items: MarkerItem[] = [];
  private pathPoints: PathPoint[] = [];

  constructor(options: MapViewOptions) {
    this.options = options;
    this.map = L.map(options.element, {
      crs: L.CRS.Simple,
      minZoom: -4,
      maxZoom: 4,
      zoomSnap: 0.25,
      attributionControl: true,
    });
    this.map.attributionControl.addAttribution("Leaflet");
    this.markers = L.layerGroup().addTo(this.map);
    this.pathLayer = L.layerGroup().addTo(this.map);
  }

  /** Draw the given map at the given date. */
  render(world: ResolvedWorld, mapId: string, date?: DateBound, focusEventId?: string): void {
    const map = world.maps.find((entry) => entry.id === mapId);
    if (map === undefined) {
      return;
    }

    const image = imageForDate(map, date);
    const url = assetUrl(image?.path);
    const size = map.size;

    if (url !== this.currentImage) {
      this.currentImage = url;
      this.setImage(url, size);
    }

    this.items = [];
    if (focusEventId === undefined) {
      for (const location of world.locations) {
        if (location.map !== mapId || location.at === undefined) {
          continue;
        }
        if (!locationVisibleAt(location, date)) {
          continue;
        }
        this.items.push({
          x: location.at[0],
          y: location.at[1],
          kind: "location",
          id: location.id,
          label: location.name,
        });
      }
    }
    for (const event of world.events) {
      if (focusEventId !== undefined && event.id !== focusEventId) {
        continue;
      }
      const place = eventPlace(world, event);
      if (place === undefined || place.mapId !== mapId || place.at === undefined) {
        continue;
      }
      this.items.push({
        x: place.at[0],
        y: place.at[1],
        kind: "event",
        id: event.id,
        label: event.title,
      });
    }
    this.placeMarkers();
  }

  /** The path of a traced person or vessel. */
  setPath(points: PathPoint[]): void {
    this.pathPoints = points;
    this.drawPath();
  }

  private setImage(url: string | undefined, size: [number, number] | undefined): void {
    if (this.overlay !== undefined) {
      this.overlay.remove();
      this.overlay = undefined;
    }
    this.markers.clearLayers();
    if (url === undefined) {
      this.options.onImageMissing("This map has no image for this date.");
      return;
    }

    const placeholder: [number, number] = size ?? [1000, 1000];
    const overlay = L.imageOverlay(url, [[0, 0], [placeholder[1], placeholder[0]]]);
    this.overlay = overlay;
    overlay.on("load", () => {
      const element = overlay.getElement();
      // A browser can report zero for an image it cannot measure. The
      // declared size is the fallback, and the image is never sized to
      // nothing - a zero-sized overlay is invisible, with nothing to show.
      const measuredWidth = element instanceof HTMLImageElement ? element.naturalWidth : 0;
      const measuredHeight = element instanceof HTMLImageElement ? element.naturalHeight : 0;
      const width = measuredWidth > 0 ? measuredWidth : (size?.[0] ?? 1000);
      const height = measuredHeight > 0 ? measuredHeight : (size?.[1] ?? 700);
      overlay.setBounds(L.latLngBounds([[0, 0], [height, width]]));
      this.map.fitBounds([[0, 0], [height, width]]);
      this.placeMarkers();
      this.drawPath();
    });
    overlay.on("error", () => {
      this.options.onImageMissing(`The map image could not be loaded (${url}).`);
    });
    overlay.addTo(this.map);
  }

  private placeMarkers(): void {
    this.markers.clearLayers();
    const element = this.overlay?.getElement();
    if (!(element instanceof HTMLImageElement) || element.naturalWidth === 0) {
      return;
    }
    for (const item of this.items) {
      const latLng = this.latLngForPixel(element, item.x, item.y);
      const marker = L.circleMarker(latLng, {
        radius: item.kind === "event" ? 8 : 6,
        color: item.kind === "event" ? "#b3541e" : "#1f4fa0",
        weight: 2,
        fillColor: item.kind === "event" ? "#e08b57" : "#6f9ad8",
        fillOpacity: 0.75,
      });
      marker.bindTooltip(item.label, { direction: "top", offset: [0, -6] });
      marker.on("click", () => {
        if (item.kind === "event") {
          this.options.onEvent(item.id);
        } else {
          this.options.onLocation(item.id);
        }
      });
      marker.addTo(this.markers);
    }
  }

  /**
   * The path of a traced person, drawn on the map.
   *
   * Points on the same map join up. When the path changes map, a marker
   * shows where it went.
   */
  private drawPath(): void {
    this.pathLayer.clearLayers();
    const element = this.overlay?.getElement();
    if (!(element instanceof HTMLImageElement) || element.naturalWidth === 0) {
      return;
    }

    let run: L.LatLng[] = [];
    let runMap: string | undefined;
    let previousMap: string | undefined;

    for (const point of this.pathPoints) {
      if (point.mapId === undefined || point.at === undefined) {
        continue;
      }
      if (point.mapId !== runMap) {
        this.addRun(run);
        run = [];
        if (previousMap !== undefined && previousMap !== point.mapId) {
          const latLng = this.latLngForPixel(element, point.at[0], point.at[1]);
          L.circleMarker(latLng, {
            radius: 8,
            color: "#6a3fb5",
            weight: 2,
            fillColor: "#b18ce0",
            fillOpacity: 0.9,
          })
            .bindTooltip(`→ ${point.locationName ?? "another map"}`)
            .addTo(this.pathLayer);
        }
        runMap = point.mapId;
      }
      previousMap = point.mapId;
      run.push(this.latLngForPixel(element, point.at[0], point.at[1]));
    }
    this.addRun(run);
  }

  private addRun(run: L.LatLng[]): void {
    if (run.length < 2) {
      return;
    }
    L.polyline(run, { color: "#b3541e", weight: 3, opacity: 0.85, dashArray: "7 5" }).addTo(this.pathLayer);
  }

  /**
   * The marker position for an image pixel.
   *
   * The image is measured where it is actually drawn, converted back into
   * the map's own coordinates, and unprojected. That way the answer does
   * not depend on the zoom or on how Leaflet numbers its axes.
   */
  private latLngForPixel(image: HTMLImageElement, x: number, y: number): L.LatLng {
    const rect = image.getBoundingClientRect();
    const containerRect = this.map.getContainer().getBoundingClientRect();
    const scale = image.clientWidth > 0 ? rect.width / image.clientWidth : 1;
    const left = (rect.left - containerRect.left) / scale;
    const top = (rect.top - containerRect.top) / scale;
    const offsetX = (x / image.naturalWidth) * image.clientWidth;
    const offsetY = (y / image.naturalHeight) * image.clientHeight;
    return this.map.containerPointToLatLng(L.point(left + offsetX, top + offsetY));
  }
}
