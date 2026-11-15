/**
 * `timewright init` - make a starter world.
 *
 * The starter world is small on purpose: one map, two locations, one person
 * and one event. It validates, it builds, and one of the locations is left
 * unplaced so that `timewright pick` has something to do.
 */

import { copyFile, cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { packageDir } from "../paths.js";

export interface InitOptions {
  folder?: string | undefined;
  /** Write into a folder that already has something in it. */
  force?: boolean | undefined;
}

export async function runInit(options: InitOptions = {}): Promise<number> {
  const target = path.resolve(options.folder ?? "my-world");
  const template = packageDir(path.join("templates", "starter-world"));

  if (!existsSync(template)) {
    console.error(`timewright init: the starter template is missing from the package (${template}).`);
    return 1;
  }

  if (existsSync(target) && readdirSync(target).length > 0 && options.force !== true) {
    console.error(`timewright init: ${target} already exists and is not empty.`);
    console.error("  Use --force to write into it anyway.");
    return 1;
  }

  await mkdir(target, { recursive: true });
  await cp(template, target, { recursive: true });

  // The agent guide travels with the world, so a creator's agent has the
  // format in front of it.
  const guide = packageDir(path.join("docs", "AGENT_GUIDE.md"));
  if (existsSync(guide)) {
    await copyFile(guide, path.join(target, "AGENT_GUIDE.md"));
  }

  await writeFile(
    path.join(target, "README.md"),
    [
      `# ${path.basename(target)}`,
      "",
      "A Timewright world. The files are the source of truth; edit them, then run",
      "",
      "```bash",
      "timewright validate --world .",
      "timewright build --world . --out dist",
      "```",
      "",
      "The format is in `AGENT_GUIDE.md` (for an agent) and in the package's `docs/FORMAT.md`",
      "(for a person).",
      "",
      "One location, `The Old Mill`, has no position yet. Place it with:",
      "",
      "```bash",
      "timewright pick --world .",
      "```",
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`timewright init: made a starter world in ${target}`);
  console.log("");
  console.log("  world.yaml       the world's title, calendar and maps");
  console.log("  maps/            a map and its image");
  console.log("  locations/       places, one of them still to be placed");
  console.log("  people/          who is in the story");
  console.log("  events/          what happened");
  console.log("  AGENT_GUIDE.md   the format, written for an agent");
  console.log("");
  console.log("Next:");
  console.log(`  timewright validate --world ${path.relative(process.cwd(), target) || "."}`);
  console.log(`  timewright pick --world ${path.relative(process.cwd(), target) || "."}`);
  console.log(`  timewright build --world ${path.relative(process.cwd(), target) || "."} --out ${path.join(path.relative(process.cwd(), target) || ".", "dist")}`);
  return 0;
}
