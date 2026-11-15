#!/usr/bin/env node
/**
 * The timewright command line.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSchema } from "./commands/schema.js";
import { runValidate } from "./commands/validate.js";

const USAGE = `timewright - build interactive timeline maps from YAML worlds

Usage:
  timewright validate [options]   Check a world folder and explain what to fix
  timewright schema [options]     Print the JSON Schema for the world format
  timewright help                 Show this help
  timewright version              Print the version

Options:
  -w, --world <dir>   The world folder (default: the current folder)
      --json          Machine-readable output (validate)
      --strict        Treat warnings as errors (validate)
  -o, --out <file>    Write to a file (schema)
  -h, --help          Show this help

Examples:
  timewright validate --world ./my-world
  timewright validate --world ./my-world --json
  timewright schema --out world.schema.json
`;

interface ParsedArgs {
  command: string;
  world?: string;
  out?: string;
  json: boolean;
  strict: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { command: "", json: false, strict: false, help: false };
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
    if (argument === "--json" || argument === "-j") {
      parsed.json = true;
      continue;
    }
    if (argument === "--strict" || argument === "-s") {
      parsed.strict = true;
      continue;
    }
    if (argument.startsWith("-")) {
      continue;
    }
    rest.push(argument);
  }

  parsed.command = rest[0] ?? "";
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
    case "validate":
      return runValidate({ world: args.world, json: args.json, strict: args.strict });
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

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
