#!/usr/bin/env node
/**
 * The timewright command line.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runBuild } from "./commands/build.js";
import { runDev } from "./commands/dev.js";
import { runInit } from "./commands/init.js";
import { runPick } from "./commands/pick.js";
import { runSchema } from "./commands/schema.js";
import { runValidate } from "./commands/validate.js";

const USAGE = `timewright - build interactive timeline maps from YAML worlds

Usage:
  timewright init [folder]       Make a starter world
  timewright validate [options]   Check a world folder and explain what to fix
  timewright build [options]     Build a world into a static site
  timewright dev [options]       Run the viewer locally, reloading on changes
  timewright pick [options]      Pick coordinates on a map, and place locations
  timewright schema [options]    Print the JSON Schema for the world format
  timewright help                Show this help
  timewright version             Print the version

Options:
  -w, --world <dir>   The world folder (default: the current folder)
      --json          Machine-readable output (validate)
      --strict        Treat warnings as errors (validate)
  -o, --out <path>    Output folder (build) or file (schema)
      --base <path>   Base path the site is served from (build), e.g. /repo/
      --single-file   Also write one self-contained HTML file (build)
      --port <n>      Port for the dev server (5173) or the picker (5174)
      --force         Write into a folder that already has something in it (init)
  -h, --help          Show this help

Examples:
  timewright init my-world
  timewright validate --world ./my-world
  timewright pick --world ./my-world
  timewright build --world ./my-world --out ./my-world/dist --base /my-world/
`;

interface ParsedArgs {
  command: string;
  /** Anything after the command that was not a flag. */
  rest: string[];
  world?: string;
  out?: string;
  base?: string;
  port?: number;
  json: boolean;
  strict: boolean;
  singleFile: boolean;
  force: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: "",
    rest: [],
    json: false,
    strict: false,
    singleFile: false,
    force: false,
    help: false,
  };
  const rest: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }
    if (argument === "-h" || argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (argument === "-w" || argument === "--world") {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.world = value;
        index += 1;
      }
      continue;
    }
    if (argument === "-o" || argument === "--out") {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.out = value;
        index += 1;
      }
      continue;
    }
    if (argument === "--base") {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.base = value;
        index += 1;
      }
      continue;
    }
    if (argument === "--port") {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value)) {
        parsed.port = value;
        index += 1;
      }
      continue;
    }
    if (argument === "--json" || argument === "-j") {
      parsed.json = true;
      continue;
    }
    if (argument === "--strict" || argument === "-s") {
      parsed.strict = true;
      continue;
    }
    if (argument === "--single-file") {
      parsed.singleFile = true;
      continue;
    }
    if (argument === "--force") {
      parsed.force = true;
      continue;
    }
    if (argument.startsWith("-")) {
      continue;
    }
    rest.push(argument);
  }

  parsed.command = rest[0] ?? "";
  parsed.rest = rest.slice(1);
  return parsed;
}

function packageVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, "package.json");
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
      if (typeof parsed.version === "string") {
        return parsed.version;
      }
    } catch {
      // keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return "unknown";
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help === true || args.command === "help" || args.command === "") {
    console.log(USAGE);
    return 0;
  }

  switch (args.command) {
    case "init":
      return runInit({ folder: args.world ?? args.rest[0], force: args.force });
    case "validate":
      return runValidate({ world: args.world, json: args.json, strict: args.strict });
    case "build":
      return runBuild({
        world: args.world,
        out: args.out,
        base: args.base,
        singleFile: args.singleFile,
      });
    case "dev":
      return runDev({ world: args.world, port: args.port });
    case "pick":
      return runPick({ world: args.world, port: args.port });
    case "schema":
      return runSchema({ out: args.out });
    case "version":
      console.log(packageVersion());
      return 0;
    default:
      console.error(`Unknown command: ${args.command}`);
      console.error(USAGE);
      return 2;
  }
}

/** The folder after the command name, for `timewright init my-world`. */

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
