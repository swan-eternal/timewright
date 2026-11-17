/**
 * `timewright build` - turn a world folder into a static site (and optionally
 * a standalone `.html` file or `.zip` website bundle ready for hosting).
 */

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveWorld } from "../../core/derive.js";
import type { ResolvedWorld } from "../../core/model.js";
import { validateWorld, type Issue } from "../../core/validate.js";
import { loadWorld, resolveImagePath } from "../load.js";
import { writeSingleFile } from "../single-file.js";
import { zipDirectory } from "../zip.js";

export interface BuildOptions {
  world?: string | undefined;
  out?: string | undefined;
  base?: string | undefined;
  /** Also write one self-contained HTML file (`world.html`). */
  singleFile?: boolean | undefined;
  /** Also write a website `.zip` archive (`<slug>-site.zip` or explicit path). */
  zip?: boolean | string | undefined;
  /** Suppress console output (used by programmatic / editor export). */
  quiet?: boolean | undefined;
}

export interface BuildSiteResult {
  ok: boolean;
  outDir: string;
  world?: ResolvedWorld | undefined;
  issues: Issue[];
  singleFilePath?: string | undefined;
  singleFileBytes?: number | undefined;
  zipPath?: string | undefined;
  zipBytes?: number | undefined;
}

/**
 * Copy referenced portrait / location images into `outDir/media/` and update
 * their paths on `world`.
 */
async function copyEntityImages(root: string, outDir: string, world: ResolvedWorld): Promise<void> {
  const copyAsset = async (
    rawFile: string | undefined,
    bucket: string,
    id: string,
  ): Promise<string | undefined> => {
    if (rawFile === undefined || rawFile === "") {
      return undefined;
    }
    if (rawFile.startsWith("http://") || rawFile.startsWith("https://") || rawFile.startsWith("data:")) {
      return rawFile;
    }
    const resolved = await resolveImagePath(root, undefined, rawFile);
    if (resolved === undefined) {
      return undefined;
    }
    const name = path.basename(resolved);
    const rel = `media/${bucket}/${id}/${name}`;
    const target = path.join(outDir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(resolved, target);
    return rel;
  };

  await Promise.all([
    ...world.people.map(async (person) => {
      const copied = await copyAsset(person.image, "people", person.id);
      if (copied !== undefined) {
        person.image = copied;
      }
    }),
    ...world.locations.map(async (location) => {
      const copied = await copyAsset(location.image, "locations", location.id);
      if (copied !== undefined) {
        location.image = copied;
      }
    }),
  ]);
}

/** Programmatic static-site builder shared by CLI `build` and Editor Export. */
export async function buildWorldSite(options: BuildOptions = {}): Promise<BuildSiteResult> {
  const root = path.resolve(options.world ?? process.cwd());
  const outDir = path.resolve(options.out ?? path.join(root, "dist"));
  const base = options.base ?? "./";

  const loaded = await loadWorld(root);
  const issues = [...loaded.issues, ...validateWorld(loaded.data)];
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    return { ok: false, outDir, issues };
  }

  const world = resolveWorld(loaded.data);

  const { build: viteBuild } = await import("vite");
  await viteBuild({
    configFile: false,
    logLevel: options.quiet === true ? "silent" : "info",
    root: findViewerRoot(),
    base,
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
    },
  });

  await mkdir(outDir, { recursive: true });

  // Copy map images
  await Promise.all(
    world.maps.flatMap((map, index) => {
      const source = loaded.data.maps[index];
      if (source === undefined) {
        return [];
      }
      const files = map.images.map((image, imageIndex) => {
        const raw = source.data.images?.[imageIndex] ?? (imageIndex === 0 ? source.data : undefined);
        return raw !== undefined && "file" in raw && raw.file !== undefined ? raw.file : image.file;
      });
      const names = files.map((file) => path.basename(file));
      const shared = new Set(names.filter((name, position) => names.indexOf(name) !== position));
      if (shared.size > 0 && options.quiet !== true) {
        console.warn(
          `timewright build: map "${map.name}" has more than one image named "${[...shared].join('", "')}"`,
        );
        console.warn("  they were written as numbered files, so none of them was lost");
      }
      return map.images.map(async (image, imageIndex) => {
        const file = files[imageIndex];
        const resolved = await resolveImagePath(root, source.file, file);
        if (resolved === undefined) {
          return;
        }
        const name = shared.has(names[imageIndex]) ? `${imageIndex}-${names[imageIndex]}` : names[imageIndex];
        const target = path.join(outDir, "maps", map.id, name);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(resolved, target);
        image.path = `maps/${map.id}/${name}`;
      });
    }),
  );

  // Copy portrait & location images
  await copyEntityImages(root, outDir, world);

  await writeFile(path.join(outDir, "world.json"), `${JSON.stringify(world, null, 2)}\n`, "utf8");

  let zipPath: string | undefined;
  let zipBytes: number | undefined;
  if (options.zip !== undefined && options.zip !== false) {
    const zipBuffer = await zipDirectory(
      outDir,
      (rel) => rel !== "world.html" && !rel.endsWith(".zip"),
    );
    zipPath =
      typeof options.zip === "string"
        ? path.resolve(options.zip)
        : path.join(outDir, "website.zip");
    await mkdir(path.dirname(zipPath), { recursive: true });
    await writeFile(zipPath, zipBuffer);
    zipBytes = zipBuffer.length;
  }

  let singleFilePath: string | undefined;
  let singleFileBytes: number | undefined;
  if (options.singleFile === true) {
    // Clone world before writeSingleFile mutates image paths into data URIs
    const worldCopy = structuredClone(world);
    const single = await writeSingleFile(outDir, worldCopy);
    singleFilePath = single.file;
    singleFileBytes = single.bytes;
  }

  return {
    ok: true,
    outDir,
    world,
    issues,
    singleFilePath,
    singleFileBytes,
    zipPath,
    zipBytes,
  };
}

/**
 * Build an in-memory export buffer (either `.zip` static site bundle or
 * standalone `.html` single file) for browser download in the editor.
 */
export async function exportWorldArtifact(
  root: string,
  format: "zip" | "single-file",
  base = "./",
): Promise<
  | { ok: true; bytes: Buffer; fileName: string; contentType: string }
  | { ok: false; message: string; issues: Issue[] }
> {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "timewright-export-"));
  try {
    const built = await buildWorldSite({
      world: root,
      out: scratch,
      base,
      singleFile: format === "single-file",
      zip: format === "zip",
      quiet: true,
    });
    if (!built.ok || built.world === undefined) {
      const errors = built.issues.filter((i) => i.severity === "error");
      return {
        ok: false,
        message: errors.map((e) => `${e.record ? `${e.record}: ` : ""}${e.message}`).join("; ") || "Build failed",
        issues: built.issues,
      };
    }

    const slug =
      built.world.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "timeline-map";

    if (format === "single-file" && built.singleFilePath !== undefined) {
      const bytes = await readFile(built.singleFilePath);
      return {
        ok: true,
        bytes,
        fileName: `${slug}.html`,
        contentType: "text/html; charset=utf-8",
      };
    }

    if (built.zipPath !== undefined) {
      const bytes = await readFile(built.zipPath);
      return {
        ok: true,
        bytes,
        fileName: `${slug}-website.zip`,
        contentType: "application/zip",
      };
    }

    return { ok: false, message: "Export produced no output file.", issues: built.issues };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function runBuild(options: BuildOptions = {}): Promise<number> {
  const root = path.resolve(options.world ?? process.cwd());
  const result = await buildWorldSite(options);

  if (!result.ok || result.world === undefined) {
    const errors = result.issues.filter((issue) => issue.severity === "error");
    console.error(`timewright build: ${errors.length} error${errors.length === 1 ? "" : "s"} in ${root}`);
    for (const issue of errors) {
      const where = [issue.file, issue.record, issue.field].filter((part) => part !== undefined && part !== "");
      console.error(`  ${issue.severity} ${where.join("  ")}`);
      console.error(`          ${issue.message}`);
    }
    return 1;
  }

  if (result.singleFilePath !== undefined && result.singleFileBytes !== undefined) {
    const megabytes = result.singleFileBytes / (1024 * 1024);
    console.log(`  one file: ${result.singleFilePath} (${megabytes.toFixed(1)} MB)`);
    if (megabytes > 50) {
      console.log("  That is large. It will open, but slowly.");
    }
  }
  if (result.zipPath !== undefined && result.zipBytes !== undefined) {
    const megabytes = result.zipBytes / (1024 * 1024);
    console.log(`  website zip: ${result.zipPath} (${megabytes.toFixed(2)} MB)`);
  }

  const warnings = result.issues.filter((issue) => issue.severity === "warning");
  console.log(`timewright build: ${result.world.title}`);
  console.log(
    `  ${result.world.maps.length} maps, ${result.world.locations.length} locations, ${result.world.people.length} people, ${result.world.events.length} events`,
  );
  console.log(`  -> ${result.outDir}`);
  if (warnings.length > 0) {
    console.log(`  ${warnings.length} warning${warnings.length === 1 ? "" : "s"} (see \`timewright validate\`)`);
  }
  return 0;
}

/** The viewer source, wherever the package happens to be installed. */
export function findViewerRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 7; depth += 1) {
    const candidate = path.join(dir, "src", "viewer");
    if (existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error("cannot find the viewer source (src/viewer/index.html)");
}
