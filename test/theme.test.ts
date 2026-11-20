import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runInit } from "../src/cli/commands/init.js";
import { buildWorldSite } from "../src/cli/commands/build.js";
import {
  resolveTheme,
  themeCss,
  themeFontFiles,
  THEME_PRESET_IDS,
} from "../src/core/theme.js";

describe("theme resolution", () => {
  it("defaults to the system stack and the shipped palette", () => {
    const { theme, warnings } = resolveTheme(undefined);
    assert.deepEqual(warnings, []);
    assert.equal(theme.fonts.heading.family, "system-ui");
    assert.equal(theme.fonts.body.family, "system-ui");
    assert.equal(theme.colors.bg, "#f7f4ee");
    assert.equal(theme.colors.accent, "#1f4fa0");
    assert.deepEqual(themeFontFiles(theme), []);
  });

  it("resolves the scifi preset to Orbitron and the dark palette", () => {
    const { theme, warnings } = resolveTheme({ preset: "scifi" });
    assert.deepEqual(warnings, []);
    assert.equal(theme.fonts.heading.family, "Orbitron");
    assert.equal(theme.fonts.body.family, "Space Grotesk");
    assert.equal(theme.colors.accent, "#4cc2ff");
    assert.equal(theme.colors.mapBg, "#0b0e14");
    assert.deepEqual(themeFontFiles(theme), ["orbitron.woff2", "space-grotesk.woff2"]);
  });

  it("covers every named preset without warnings", () => {
    for (const id of THEME_PRESET_IDS) {
      const { warnings } = resolveTheme({ preset: id });
      assert.deepEqual(warnings, [], `preset ${id} resolved cleanly`);
    }
  });

  it("warns and falls back on unknown names", () => {
    const { theme, warnings } = resolveTheme({ preset: "noir", fonts: { heading: "garamond" } });
    assert.equal(warnings.length, 2);
    assert.equal(theme.fonts.heading.family, "system-ui");
    assert.equal(theme.colors.bg, "#f7f4ee");
  });

  it("keeps display faces out of the body", () => {
    const { theme, warnings } = resolveTheme({ fonts: { body: "great-vibes" } });
    assert.equal(warnings.length, 1);
    assert.equal(theme.fonts.body.family, "system-ui");
  });

  it("lets colors override a preset, and rejects bad hex", () => {
    const { theme, warnings } = resolveTheme({
      preset: "fantasy",
      colors: { accent: "#123456", bg: "parchment" },
    });
    assert.equal(theme.colors.accent, "#123456");
    assert.equal(theme.colors.bg, "#efe6d0");
    assert.equal(warnings.length, 1);
  });

  it("emits @font-face rules and variables for a themed build", () => {
    const { theme } = resolveTheme({ preset: "scifi" });
    const css = themeCss(theme);
    assert.ok(css.includes('@font-face{font-family:"Orbitron"'));
    assert.ok(css.includes('url("fonts/orbitron.woff2")'));
    assert.ok(css.includes("--font-heading:Orbitron, Verdana, sans-serif"));
    assert.ok(css.includes("--accent:#4cc2ff"));
    assert.ok(css.includes("--map-bg:#0b0e14"));
  });
});

describe("themed builds", () => {
  it("bakes the theme into the site and copies its fonts", async () => {
    const world = await mkdtemp(path.join(tmpdir(), "timewright-theme-"));
    try {
      await runInit({ folder: world });
      const yaml = path.join(world, "world.yaml");
      const text = await readFile(yaml, "utf8");
      await writeFile(yaml, `${text}\ntheme:\n  preset: scifi\n`, "utf8");

      const out = await mkdtemp(path.join(tmpdir(), "timewright-theme-site-"));
      try {
        const result = await buildWorldSite({ world, out, quiet: true });
        assert.equal(result.ok, true);

        const html = await readFile(path.join(out, "index.html"), "utf8");
        assert.ok(html.includes('<style id="tw-theme">'), "theme style tag is in the page");
        assert.ok(html.includes('"Orbitron"'));
        assert.ok(html.includes("--accent:#4cc2ff"));

        const orbitron = await readFile(path.join(out, "fonts", "orbitron.woff2"));
        assert.equal(orbitron.subarray(0, 4).toString("latin1"), "wOF2");
        const grotesk = await readFile(path.join(out, "fonts", "space-grotesk.woff2"));
        assert.equal(grotesk.subarray(0, 4).toString("latin1"), "wOF2");
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    } finally {
      await rm(world, { recursive: true, force: true });
    }
  });

  it("leaves an unthemed world byte-identical in spirit: no theme tag", async () => {
    const world = await mkdtemp(path.join(tmpdir(), "timewright-plain-"));
    try {
      await runInit({ folder: world });
      const out = await mkdtemp(path.join(tmpdir(), "timewright-plain-site-"));
      try {
        const result = await buildWorldSite({ world, out, quiet: true });
        assert.equal(result.ok, true);
        const html = await readFile(path.join(out, "index.html"), "utf8");
        assert.equal(html.includes('id="tw-theme"'), false);
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    } finally {
      await rm(world, { recursive: true, force: true });
    }
  });
});
