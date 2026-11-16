/**
 * A debug panel for the viewer: `?debug=1`.
 *
 * It reports the things that are impossible to guess at from a screenshot -
 * the URL the browser actually asked for, the size it measured, where the
 * image element ended up, and any error that fired along the way.
 */

export const debugOn =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("debug") === "1";

export function installDebug(): void {
  if (!debugOn) {
    return;
  }

  const panel = document.createElement("pre");
  panel.id = "debug-panel";
  panel.style.cssText = [
    "position:fixed",
    "left:0",
    "bottom:0",
    "z-index:99999",
    "margin:0",
    "max-height:48vh",
    "overflow:auto",
    "background:#11151c",
    "color:#b9f6ca",
    "font:11px/1.4 ui-monospace, Menlo, Consolas, monospace",
    "padding:.6rem .8rem",
    "white-space:pre-wrap",
    "border-top:2px solid #b9f6ca",
  ].join(";");
  document.body.appendChild(panel);

  const errors: string[] = [];
  window.addEventListener("error", (event) => {
    errors.push(`${event.message} (${event.filename}:${event.lineno})`);
  });
  // Resource errors do not reach window.onerror; catch them in the capture phase.
  document.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement) {
        errors.push(`image failed: ${target.src}`);
      }
    },
    true,
  );

  setInterval(() => {
    const mapElement = document.querySelector<HTMLElement>("#map");
    const container = mapElement?.querySelector<HTMLElement>(".leaflet-container") ?? undefined;
    const image = mapElement?.querySelector<HTMLImageElement>("img.leaflet-image-layer") ?? undefined;
    const pane = mapElement?.querySelector<HTMLElement>(".leaflet-overlayPane") ?? undefined;
    const mapPane = mapElement?.querySelector<HTMLElement>(".leaflet-map-pane") ?? undefined;
    const rect = image?.getBoundingClientRect();
    const view = (window as unknown as { __timewright?: { mapView?: { zoom: number; overlayImage?: HTMLImageElement } } })
      .__timewright?.mapView;

    const everyImage = Array.from(document.querySelectorAll("img")).map((element) => {
      const box = element.getBoundingClientRect();
      return [
        `      ${element.className || "(no class)"}`,
        `src=${element.getAttribute("src")}`,
        `natural=${element.naturalWidth}x${element.naturalHeight}`,
        `complete=${element.complete}`,
        `style=${element.style.width || "-"}x${element.style.height || "-"}`,
        `at=${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`,
      ].join(" ");
    });

    const lines = [
      `container: ${container !== undefined ? `${container.clientWidth} x ${container.clientHeight}` : "none"}`,
      `zoom: ${view?.zoom ?? "?"}`,
      `overlay image element: ${view?.overlayImage !== undefined ? "present" : "MISSING"}`,
      `image in the map: ${image !== undefined ? "present" : "MISSING"}`,
      image !== undefined ? `  requested: ${image.currentSrc || image.src}` : "",
      image !== undefined ? `  natural: ${image.naturalWidth} x ${image.naturalHeight}` : "",
      image !== undefined ? `  client: ${image.clientWidth} x ${image.clientHeight}` : "",
      image !== undefined ? `  style: ${image.style.width || "-"} x ${image.style.height || "-"}` : "",
      image !== undefined ? `  left/top: ${image.style.left || "-"} / ${image.style.top || "-"}` : "",
      rect !== undefined
        ? `  on screen: x ${Math.round(rect.x)} y ${Math.round(rect.y)} w ${Math.round(rect.width)} h ${Math.round(rect.height)}`
        : "",
      pane !== undefined ? `overlay pane transform: ${pane.style.transform || "-"}` : "",
      mapPane !== undefined ? `map pane transform: ${mapPane.style.transform || "-"}` : "",
      `all images on the page:`,
      ...(everyImage.length > 0 ? everyImage : ["      (none)"]),
      `errors: ${errors.length > 0 ? errors.join(" | ") : "none"}`,
    ].filter((line) => line !== "");

    panel.textContent = lines.join("\n");
  }, 400);
}
