/**
 * `timewright build` - turn a world folder into a static site.
 *
 * The output is a folder that any web host can serve: index.html, the
 * viewer's assets, world.json, and the map images.
 */

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

import { resolveWorld } from "../../core/derive.js";
import { validateWorld } from "../../core/validate.js";
import { loadWorld, resolveImagePath } from "../load.js";
import { writeSingleFile } from "../single-file.js";

export interface BuildOptions {
  world?: string | undefined;
  out?: string | undefined;
  base?: string | undefined;
  /** Also write one self-contained HTML file. */
  singleFile?: boolean | undefined;
}

export async function runBuild(options: BuildOptions = {}): Promise<number> {
  const root = path.resolve(options.world ?? process.cwd());
  const outDir = path.resolve(options.out ?? path.join(root, "dist"));
  const base = options.base ?? "./";

  const loaded = await loadWorld(root);
  const issues = [...loaded.issues, ...validateWorld(loaded.data)];
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    console.error(`timewright build: ${errors.length} error${errors.length === 1 ? "" : "s"} in ${root}`);
    for (const issue of errors) {
      const where = [issue.file, issue.record, issue.field].filter((part) => part !== undefined && part !== "");
      console.error(`  ${issue.severity} ${where.join("  ")}`);
      console.error(`          ${issue.message}`);
    }
    return 1;
  }

  const world = resolveWorld(loaded.data);

  // The viewer is built first, because Vite empties the output folder.
  // The map images and world.json are written after it, so they survive.
  await viteBuild({
    configFile: false,
    root: findViewerRoot(),
    base,
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
    },
  });

  await mkdir(outDir, { recursive: true });

  // Copy the map images and record where each one ended up.
  await Promise.all(
    world.maps.flatMap((map, index) => {
      const source = loaded.data.maps[index];
      if (source === undefined) {
        return [];
      }
      return map.images.map(async (image, imageIndex) => {
        const raw = source.data.images?.[imageIndex] ?? (imageIndex === 0 ? source.data : undefined);
        const file = raw !== undefined && "file" in raw && raw.file !== undefined ? raw.file : image.file;
        const resolved = await resolveImagePath(root, source.file, file);
        if (resolved === undefined) {
          return;
        }
        const name = path.basename(file);
        const target = path.join(outDir, "maps", map.id, name);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(resolved, target);
        image.path = `maps/${map.id}/${name}`;
      });
    }),
  );

  await writeFile(path.join(outDir, "world.json"), `${JSON.stringify(world, null, 2)}\n`, "utf8");

  if (options.singleFile === true) {
    const single = await writeSingleFile(outDir, world);
    const megabytes = single.bytes / (1024 * 1024);
    console.log(`  one file: ${single.file} (${megabytes.toFixed(1)} MB)`);
    if (megabytes > 50) {
      console.log("  That is large. It will open, but slowly.");
    }
  }

  const warnings = issues.filter((issue) => issue.severity === "warning");
  console.log(`timewright build: ${world.title}`);
  console.log(
    `  ${world.maps.length} maps, ${world.locations.length} locations, ${world.people.length} people, ${world.events.length} events`,
  );
  console.log(`  -> ${outDir}`);
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
