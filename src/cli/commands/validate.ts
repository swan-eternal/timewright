/**
 * `timewright validate` - check a world folder and explain what to fix.
 */

import path from "node:path";

import { validateWorld, type Issue } from "../../core/validate.js";
import { loadWorld } from "../load.js";

export interface ValidateOptions {
  world?: string | undefined;
  json?: boolean | undefined;
  strict?: boolean | undefined;
}

export async function runValidate(options: ValidateOptions = {}): Promise<number> {
  const root = path.resolve(options.world ?? process.cwd());
  const loaded = await loadWorld(root);
  const issues = [...loaded.issues, ...validateWorld(loaded.data, { strict: options.strict === true })];

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  if (options.json === true) {
    const payload = {
      ok: errors.length === 0,
      root: loaded.root,
      strict: options.strict === true,
      counts: {
        errors: errors.length,
        warnings: warnings.length,
        maps: loaded.data.maps.length,
        people: loaded.data.people.length,
        locations: loaded.data.locations.length,
        events: loaded.data.events.length,
      },
      errors,
      warnings,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printHuman(loaded.root, errors, warnings);
  }

  return errors.length > 0 ? 1 : 0;
}

function printHuman(root: string, errors: Issue[], warnings: Issue[]): void {
  const total = errors.length + warnings.length;
  console.log(`timewright validate: ${root}`);
  if (total === 0) {
    console.log("");
    console.log("OK - no errors, no warnings.");
    return;
  }
  console.log("");
  const summary = [
    errors.length > 0 ? `${errors.length} error${errors.length === 1 ? "" : "s"}` : "",
    warnings.length > 0 ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "",
  ]
    .filter((part) => part !== "")
    .join(", ");
  console.log(`${errors.length > 0 ? "FAIL" : "WARN"} - ${summary}`);
  console.log("");
  for (const issue of [...errors, ...warnings]) {
    const where = [issue.file, issue.record, issue.field].filter((part) => part !== undefined && part !== "");
    console.log(`  ${issue.severity.toUpperCase().padEnd(7)} ${where.join("  ")}`);
    console.log(`          ${issue.message}`);
    if (issue.suggestion !== undefined) {
      console.log(`          ${issue.suggestion}`);
    }
  }
}
