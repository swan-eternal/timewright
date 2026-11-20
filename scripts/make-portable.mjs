#!/usr/bin/env node
/**
 * Build the portable Windows ZIP: the compiled CLI, its runtime
 * dependencies, the starter template, and a private Node.exe, so a
 * tester extracts one folder and double-clicks. Nothing is installed,
 * nothing is downloaded on their machine, and deleting the folder
 * removes the whole thing.
 *
 * Usage:
 *   node scripts/make-portable.mjs [--node-version v22.23.5] [--out release]
 *
 * Run it from a full checkout (npm install first): it builds, so it
 * needs the dev dependencies. Needs zip and unzip on PATH, and network
 * to nodejs.org on the first run (cached under release/.cache after).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { cp, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const nodeVersion = option("--node-version", "v22.23.5");
const outDir = path.resolve(root, option("--out", "release"));
const cacheDir = path.join(outDir, ".cache");
const stage = path.join(outDir, "Timewright");

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

console.log(`== portable build: node ${nodeVersion} -> ${outDir}`);

// 1. Compile the CLI and copy its pages into dist/.
run("npm", ["run", "build"], { cwd: root });

// 2. The engine: an official Node win-x64 build, cached after first use.
mkdirSync(cacheDir, { recursive: true });
const nodeZip = path.join(cacheDir, `node-${nodeVersion}-win-x64.zip`);
if (!existsSync(nodeZip)) {
  const url = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-win-x64.zip`;
  console.log(`> downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not download Node: ${response.status} ${url}`);
  }
  await writeFile(nodeZip, Buffer.from(await response.arrayBuffer()));
  const downloaded = statSync(nodeZip).size;
  if (downloaded < 25_000_000) {
    rmSync(nodeZip);
    throw new Error(`Node download looks truncated (${downloaded} bytes) - run again`);
  }
}

// 3. Assemble the folder a tester will extract.
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const item of ["dist", "dist-viewer", "fonts", "templates", "LICENSE", "package.json", "package-lock.json"]) {
  if (!existsSync(path.join(root, item))) {
    throw new Error(`missing ${item} - run this from a built checkout`);
  }
  await cp(path.join(root, item), path.join(stage, item), { recursive: true });
}
mkdirSync(path.join(stage, "runtime"));
mkdirSync(path.join(stage, "worlds"));

// 4. The double-click entry point and the readme, Windows-style endings.
const startBat = [
  "@echo off",
  "setlocal",
  "title Timewright",
  'cd /d "%~dp0"',
  "",
  "echo.",
  "echo  ============= Timewright =============",
  "echo   Starting Timewright. Your browser will",
  "echo   open the home page - edit a world there,",
  "echo   or create a new one.",
  "echo  ======================================",
  "echo.",
  "echo  Keep this window open while you work.",
  "echo  Close it when you are done.",
  "echo.",
  "",
  'if not exist "runtime\\node.exe" (',
  "    echo  [!] runtime\\node.exe is missing - this folder",
  "    echo      looks incomplete. Extract the whole ZIP",
  "    echo      again, then double-click this file again.",
  "    echo.",
  "    pause",
  "    exit /b 1",
  ")",
  "",
  '"runtime\\node.exe" "dist\\cli\\index.js" home -w worlds',
  "",
  "echo.",
  "echo  Timewright stopped. You can close this window.",
  "echo.",
  "pause",
].join("\r\n");
await writeFile(path.join(stage, "Start Timewright.bat"), startBat, "utf8");

const readmeTxt = [
  "Timewright - start here",
  "=======================",
  "",
  "1. Double-click \"Start Timewright.bat\".",
  "2. Your browser opens the Timewright home page.",
  "3. Type a name, click \"Create world\", then \"Edit\".",
  "",
  "Keep the black window open while you work - closing it",
  "stops Timewright. Your worlds live in the \"worlds\" folder",
  "next to this file; copying that folder backs them up.",
  "",
  "Nothing was installed on your computer. To remove",
  "Timewright, delete this folder.",
].join("\r\n");
await writeFile(path.join(stage, "Readme.txt"), readmeTxt, "utf8");

// 5. Runtime dependencies only, with no lifecycle scripts of any kind.
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const stagePkg = JSON.parse(await readFile(path.join(stage, "package.json"), "utf8"));
stagePkg.scripts = {};
await writeFile(path.join(stage, "package.json"), `${JSON.stringify(stagePkg, null, 2)}\n`);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage });

// 6. Pull node.exe out of the official archive via the filesystem: piping
//    ~80 MB through a child's stdout hits execFileSync's 1 MB default
//    maxBuffer, so it is extracted to disk and moved into place instead.
const extractDir = path.join(outDir, ".node-extract");
rmSync(extractDir, { recursive: true, force: true });
const innerPath = `node-${nodeVersion}-win-x64/node.exe`;
run("unzip", ["-o", "-q", nodeZip, innerPath, "-d", extractDir]);
const extracted = path.join(extractDir, innerPath);
if (!existsSync(extracted)) {
  throw new Error(`could not extract ${innerPath} from ${nodeZip}`);
}
await rename(extracted, path.join(stage, "runtime", "node.exe"));
rmSync(extractDir, { recursive: true, force: true });

// 7. Sanity: the pieces a tester cannot fix themselves.
for (const must of [
  "dist/cli/index.js",
  "dist/cli/home.html",
  "dist/cli/editor.html",
  "dist/cli/picker.html",
  "templates/starter-world/world.yaml",
  "fonts/orbitron.woff2",
  "node_modules/yaml/package.json",
  "node_modules/leaflet/package.json",
]) {
  if (!existsSync(path.join(stage, must))) {
    throw new Error(`staging is missing ${must}`);
  }
}
const exeSize = statSync(path.join(stage, "runtime", "node.exe")).size;
if (exeSize < 50_000_000) {
  throw new Error(`runtime/node.exe looks wrong (${exeSize} bytes)`);
}

// 8. Zip it up.
const zipName = `timewright-portable-win64-${pkg.version}.zip`;
rmSync(path.join(outDir, zipName), { force: true });
run("zip", ["-r", "-q", zipName, "Timewright"], { cwd: outDir });
const zipSize = statSync(path.join(outDir, zipName)).size;
console.log(
  `== done: ${path.join(outDir, zipName)} (${(zipSize / 1e6).toFixed(1)} MB; node.exe ${(exeSize / 1e6).toFixed(0)} MB)`,
);
