/**
 * `timewright init` - make a starter world.
 *
 * The starter world is empty of content on purpose: the map is real, the
 * content files hold commented-out examples, and the world's title comes
 * from the folder name. Nothing has to be deleted before real history starts.
 */

import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
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

  // The world's title follows the folder the creator chose.
  const worldFile = path.join(target, "world.yaml");
  const worldText = await readFile(worldFile, "utf8");
  await writeFile(
    worldFile,
    worldText.replace(/^title:.*$/m, `title: ${JSON.stringify(path.basename(target))}`),
    "utf8",
  );

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
      "(for a person). The content files start as comments: delete the # marks",
      "to write your first record, or use the editor's New buttons.",
      "",
      "The starter's map is a placeholder. Replace `maps/region.svg` with your own",
      "map image, and place locations on it with:",
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
  console.log("  locations/       places on your maps");
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
