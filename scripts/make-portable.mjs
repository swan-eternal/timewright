#!/usr/bin/env node
/**
 * Build the portable ZIPs: the compiled CLI, its runtime dependencies,
 * the starter template, and a private Node runtime, so a tester
 * extracts one folder and double-clicks. Nothing is installed, nothing
 * is downloaded on their machine, and deleting the folder removes the
 * whole thing.
 *
 * Targets:
 *   win64      Start Timewright.bat     + the win-x64 node.exe
 *   mac-arm64  Start Timewright.command + the darwin-arm64 node (Apple Silicon)
 *   mac-x64    Start Timewright.command + the darwin-x64 node (Intel)
 *
 * Usage:
 *   node scripts/make-portable.mjs [--platform win64|mac-arm64|mac-x64|all]
 *                                  [--node-version v22.23.5] [--out release]
 *
 * Run it from a full checkout (npm install first): it builds, so it
 * needs the dev dependencies. Needs zip on PATH, plus unzip for win64
 * and tar for the mac targets, and network to nodejs.org on the first
 * run (cached under release/.cache after).
 *
 * The mac ZIPs are unsigned: macOS Gatekeeper asks for a one-time
 * right-click -> Open on first launch. That dance is documented in
 * the ReadMe the ZIP carries.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { cp, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const TARGETS = {
  win64: { nodeArch: "win-x64", archiveExt: ".zip", binary: "node.exe" },
  "mac-arm64": { nodeArch: "darwin-arm64", archiveExt: ".tar.gz", binary: "node" },
  "mac-x64": { nodeArch: "darwin-x64", archiveExt: ".tar.gz", binary: "node" },
};

const platformArg = option("--platform", "win64");
if (!(platformArg in TARGETS) && platformArg !== "all") {
  throw new Error(`unknown --platform "${platformArg}" (want win64, mac-arm64, mac-x64, or all)`);
}
const platforms = platformArg === "all" ? Object.keys(TARGETS) : [platformArg];

const nodeVersion = option("--node-version", "v22.23.5");
const outDir = path.resolve(root, option("--out", "release"));
const cacheDir = path.join(outDir, ".cache");
const stage = path.join(outDir, "Timewright");

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

console.log(`== portable build: node ${nodeVersion}, ${platforms.join(", ")} -> ${outDir}`);

// 1. Compile the CLI and copy its pages into dist/, once for every target.
run("npm", ["run", "build"], { cwd: root });

mkdirSync(cacheDir, { recursive: true });

for (const platform of platforms) {
  const target = TARGETS[platform];
  const isMac = platform.startsWith("mac-");
  const archiveRoot = `node-${nodeVersion}-${target.nodeArch}`;
  const nodeArchive = path.join(cacheDir, `${archiveRoot}${target.archiveExt}`);

  // 2. The engine: an official Node build, cached after first use.
  if (!existsSync(nodeArchive)) {
    const url = `https://nodejs.org/dist/${nodeVersion}/${archiveRoot}${target.archiveExt}`;
    console.log(`> downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`could not download Node: ${response.status} ${url}`);
    }
    await writeFile(nodeArchive, Buffer.from(await response.arrayBuffer()));
    const downloaded = statSync(nodeArchive).size;
    if (downloaded < 25_000_000) {
      rmSync(nodeArchive);
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

  // 4. The double-click entry point and the readme.
  if (isMac) {
    const startCommand = [
      "#!/bin/bash",
      "# Timewright launcher. The very first time, macOS asks for a",
      '# confirmation: right-click this file, choose "Open", then click',
      '# "Open" again in the panel it shows. After that, a plain',
      '# double-click works. The whole story is in ReadMe.txt.',
      'cd "$(dirname "$0")" || exit 1',
      "",
      "echo",
      'echo "  ============= Timewright ============="',
      'echo "   Starting Timewright. Your browser will"',
      'echo "   open the home page - edit a world there,"',
      'echo "   or create a new one."',
      'echo "  ====================================="',
      "echo",
      'echo "  Keep this Terminal window open while you work."',
      'echo "  Close it when you are done."',
      "echo",
      'if [ ! -f "runtime/node" ]; then',
      '    echo "  [!] runtime/node is missing - this folder"',
      '    echo "      looks incomplete. Extract the whole ZIP"',
      '    echo "      again, then double-click this file again."',
      "    echo",
      '    read -n 1 -s -r -p "  Press any key to close..."',
      "    echo",
      "    exit 1",
      "fi",
      "",
      "./runtime/node dist/cli/index.js home -w worlds",
      "",
      "echo",
      'echo "  Timewright stopped. You can close this window."',
      'read -n 1 -s -r -p "  Press any key to close..."',
      "echo",
    ].join("\n");
    const commandPath = path.join(stage, "Start Timewright.command");
    await writeFile(commandPath, startCommand, "utf8");
    // The executable bit must ride inside the ZIP, or the extracted
    // launcher is a text file Finder will not run.
    chmodSync(commandPath, 0o755);

    const chip =
      platform === "mac-arm64"
        ? [
            "This copy is for Macs with Apple Silicon (M1/M2/M3) - most",
            'Macs since 2020. Apple menu > About This Mac: "Chip: Apple"',
            'means this is yours. For an "Intel" chip, use the mac-x64 ZIP',
            "on the releases page instead.",
          ]
        : [
            "This copy is for Macs with an Intel processor. Apple menu >",
            'About This Mac: "Chip: Intel" means this is yours. For an',
            '"Apple" chip (M1/M2/M3), use the mac-arm64 ZIP on the',
            "releases page instead.",
          ];
    const readmeTxt = [
      "Timewright - start here",
      "=======================",
      "",
      ...chip,
      "",
      "One-time setup, then double-click forever after:",
      "",
      "1. Double-click the ZIP you downloaded - Finder extracts it.",
      '2. Open the "Timewright" folder. The FIRST time, right-click',
      '   "Start Timewright.command", choose "Open", then click "Open"',
      "   in the panel macOS shows. macOS checks software it does not",
      "   recognize; that is all this is. You will not be asked again.",
      "3. Your browser opens the Timewright home page. Type a name,",
      '   click "Create world", then "Edit".',
      '4. From then on, double-click "Start Timewright.command" to',
      "   reopen the home page.",
      "",
      "Keep the Terminal window open while you work - closing it",
      'stops Timewright. Your worlds live in the "worlds" folder',
      "next to this file; copying that folder backs them up.",
      "",
      "Nothing was installed on your computer. To remove",
      "Timewright, drag this folder to the Trash.",
      "",
      "This folder bundles Node.js and open-source libraries; their",
      "licenses are in runtime/ and node_modules/.",
    ].join("\n");
    await writeFile(path.join(stage, "Readme.txt"), readmeTxt, "utf8");
  } else {
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
      '1. Double-click "Start Timewright.bat".',
      "2. Your browser opens the Timewright home page.",
      '3. Type a name, click "Create world", then "Edit".',
      "",
      "Keep the black window open while you work - closing it",
      'stops Timewright. Your worlds live in the "worlds" folder',
      "next to this file; copying that folder backs them up.",
      "",
      "Nothing was installed on your computer. To remove",
      "Timewright, delete this folder.",
      "",
      "This folder bundles Node.js and open-source libraries; their",
      "licenses are in runtime/ and node_modules/.",
    ].join("\r\n");
    await writeFile(path.join(stage, "Readme.txt"), readmeTxt, "utf8");
  }

  // 5. Runtime dependencies only, with no lifecycle scripts of any kind.
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const stagePkg = JSON.parse(await readFile(path.join(stage, "package.json"), "utf8"));
  stagePkg.scripts = {};
  await writeFile(path.join(stage, "package.json"), `${JSON.stringify(stagePkg, null, 2)}\n`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage });

  // 6. Pull the Node binary (and its license) out of the official
  //    archive. The archive is extracted to disk and moved into place
  //    because piping ~80 MB through a child's stdout hits
  //    execFileSync's 1 MB default maxBuffer.
  const extractDir = path.join(outDir, ".node-extract");
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  if (isMac) {
    run("tar", ["-xzf", nodeArchive, "-C", extractDir, `${archiveRoot}/bin/node`]);
    const extracted = path.join(extractDir, archiveRoot, "bin", target.binary);
    if (!existsSync(extracted)) {
      throw new Error(`could not extract ${archiveRoot}/bin/node from ${nodeArchive}`);
    }
    await rename(extracted, path.join(stage, "runtime", target.binary));
    chmodSync(path.join(stage, "runtime", target.binary), 0o755);
    // The license member's name has wobbled across Node releases, so
    // try the two spellings and keep whichever the archive carries.
    for (const licenseName of ["LICENSE", "LICENSE.md"]) {
      try {
        run("tar", ["-xzf", nodeArchive, "-C", extractDir, `${archiveRoot}/${licenseName}`], {
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch {
        continue;
      }
      const license = path.join(extractDir, archiveRoot, licenseName);
      if (existsSync(license)) {
        await rename(license, path.join(stage, "runtime", "node-LICENSE.txt"));
        break;
      }
    }
  } else {
    const innerPath = `${archiveRoot}/${target.binary}`;
    const licensePath = `${archiveRoot}/LICENSE`;
    run("unzip", ["-o", "-q", nodeArchive, innerPath, licensePath, "-d", extractDir]);
    const extracted = path.join(extractDir, innerPath);
    if (!existsSync(extracted)) {
      throw new Error(`could not extract ${innerPath} from ${nodeArchive}`);
    }
    await rename(extracted, path.join(stage, "runtime", target.binary));
    const extractedLicense = path.join(extractDir, licensePath);
    if (existsSync(extractedLicense)) {
      await rename(extractedLicense, path.join(stage, "runtime", "node-LICENSE.txt"));
    }
  }
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
  const binaryPath = path.join(stage, "runtime", target.binary);
  const exeSize = statSync(binaryPath).size;
  if (exeSize < 50_000_000) {
    throw new Error(`runtime/${target.binary} looks wrong (${exeSize} bytes)`);
  }
  if (isMac && (statSync(path.join(stage, "Start Timewright.command")).mode & 0o111) === 0) {
    throw new Error("Start Timewright.command lost its executable bit");
  }

  // 8. Zip it up.
  const zipName = `timewright-portable-${platform}-${pkg.version}.zip`;
  rmSync(path.join(outDir, zipName), { force: true });
  run("zip", ["-r", "-q", zipName, "Timewright"], { cwd: outDir });
  const zipSize = statSync(path.join(outDir, zipName)).size;
  console.log(
    `== done: ${path.join(outDir, zipName)} (${(zipSize / 1e6).toFixed(1)} MB; ${target.binary} ${(exeSize / 1e6).toFixed(0)} MB)`,
  );
}
