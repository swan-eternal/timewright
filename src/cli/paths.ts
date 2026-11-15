/**
 * Finding things inside the installed package.
 *
 * The package ships its viewer source, its templates and its docs, and the
 * CLI needs all three wherever it was installed. So it looks for them
 * relative to itself, however the package was laid out.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The root of the installed package. */
export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

/** A directory inside the package, wherever it was installed. */
export function packageDir(relative: string): string {
  const root = packageRoot();
  const direct = path.join(root, relative);
  if (existsSync(direct)) {
    return direct;
  }
  // The compiled CLI lives one or two levels down from the package root.
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 7; depth += 1) {
    const candidate = path.join(dir, relative);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return direct;
}
