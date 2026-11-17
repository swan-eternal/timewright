/**
 * The single-file build: one HTML file with everything in it.
 *
 * The world, the viewer and the map images all go into one document, so it
 * can be opened from a disk, emailed, or dropped anywhere that serves a
 * single file.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ResolvedWorld } from "../core/model.js";

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

export interface SingleFileResult {
  file: string;
  bytes: number;
}

export async function writeSingleFile(outDir: string, world: ResolvedWorld): Promise<SingleFileResult> {
  const indexPath = path.join(outDir, "index.html");
  let html = await readFile(indexPath, "utf8");

  // Pull the assets in.
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((match) => match[1]);
  const styles = [...html.matchAll(/<link[^>]*href="([^"]+\.css)"[^>]*>/g)].map((match) => match[1]);

  // The scripts come out of the document and go to the end of it.
  //
  // A script runs as soon as the parser reaches it. The built page keeps
  // the viewer in the head, so inlined there it ran before the page had
  // a body - it looked for its map, found nothing, and stopped. It also
  // ran before the world's data was in the document, and the viewer
  // reads the data before it looks for anything else.
  //
  // The replacement is a function, not a string: a string replacement
  // would expand `$&`, `` $` `` and `$'` inside the asset. The bundle has
  // all three - Zod's own regex-escape helper is where they come from -
  // and expanding them spliced the script tag into the middle of the
  // JavaScript and cut the file in half.
  const scriptBodies: string[] = [];
  for (const reference of scripts) {
    const file = path.join(outDir, reference.replace(/^\.?\//, ""));
    scriptBodies.push(await readFile(file, "utf8"));
  }
  for (const reference of scripts) {
    html = html.replace(
      new RegExp(`<script[^>]*src="${reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*></script>`),
      "",
    );
  }
  for (const reference of styles) {
    const file = path.join(outDir, reference.replace(/^\.?\//, ""));
    const source = await readFile(file, "utf8");
    html = html.replace(
      new RegExp(`<link[^>]*href="${reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`),
      () => `<style>\n${source}\n</style>`,
    );
  }

  // Module preloads point at files that are no longer separate.
  html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, "");

  // The map images and entity images become data URIs, so nothing points at
  // a file that is not there.
  const inlinePath = async (relPath: string | undefined): Promise<string | undefined> => {
    if (
      relPath === undefined ||
      relPath.startsWith("data:") ||
      relPath.startsWith("http://") ||
      relPath.startsWith("https://")
    ) {
      return relPath;
    }
    const file = path.join(outDir, relPath);
    try {
      const bytes = await readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      return `data:${type};base64,${bytes.toString("base64")}`;
    } catch {
      return relPath;
    }
  };

  for (const map of world.maps) {
    for (const image of map.images) {
      image.path = await inlinePath(image.path);
    }
  }
  for (const person of world.people) {
    person.image = await inlinePath(person.image);
  }
  for (const location of world.locations) {
    location.image = await inlinePath(location.image);
  }

  const json = JSON.stringify(world).replace(/</g, "\\u003c");
  const dataScript = `<script id="world-data" type="application/json">${json}</script>`;
  // The world's data first, then the viewer that reads it: the viewer
  // runs the moment the parser reaches it, and it looks for the data
  // before anything else.
  const viewerScripts = scriptBodies.map((source) => `<script>\n${source}\n</script>`).join("\n");
  const tail = `${dataScript}\n${viewerScripts}\n`;

  // The last `</body>` in the document, not the first: the bundle holds
  // one of its own - DOMPurify builds an empty document - and the first
  // one is in the middle of the JavaScript. The world's data has to go
  // at the end of the page.
  const body = html.lastIndexOf("</body>");
  if (body !== -1) {
    html = html.slice(0, body) + tail + html.slice(body);
  } else {
    html += `\n${tail}`;
  }

  const target = path.join(outDir, "world.html");
  await writeFile(target, html, "utf8");
  const info = await stat(target);
  return { file: target, bytes: info.size };
}
