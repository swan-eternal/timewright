/**
 * Copy the files that are not TypeScript into dist, so the built CLI has
 * everything it needs.
 */

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const files = [
  ["src/cli/home.html", "dist/cli/home.html"],
  ["src/cli/picker.html", "dist/cli/picker.html"],
  ["src/cli/editor.html", "dist/cli/editor.html"],
];

for (const [from, to] of files) {
  const source = path.join(root, from);
  const target = path.join(root, to);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`copied ${from} -> ${to}`);
}
