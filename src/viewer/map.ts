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

export interface MapViewOptions {
  element: HTMLElement;
  onLocation: (id: string) => void;
  onEvent: (id: string) => void;
  onImageMissing: (message: string) => void;
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
  private readonly options: MapViewOptions;
  private overlay?: L.ImageOverlay;
  private currentImage?: string;
  private items: MarkerItem[] = [];

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
  }

  /** Draw the given map at the given date. */
  render(world: ResolvedWorld, mapId: string, date?: DateBound): void {
    const map = world.maps.find((entry) => entry.id === mapId);
    if (map === undefined) {
      return;
    }

    const image = imageForDate(map, date);
    const url = image?.path !== undefined ? `${import.meta.env.BASE_URL}${image.path}` : undefined;
    const size = map.size;

    if (url !== this.currentImage) {
      this.currentImage = url;
      this.setImage(url, size);
    }

    this.items = [];
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
    for (const event of world.events) {
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
      const width = element instanceof HTMLImageElement ? element.naturalWidth : placeholder[0];
      const height = element instanceof HTMLImageElement ? element.naturalHeight : placeholder[1];
      overlay.setBounds(L.latLngBounds([[0, 0], [height, width]]));
      this.map.fitBounds([[0, 0], [height, width]]);
      this.placeMarkers();
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
