/**
 * World themes: a shelf of bundled open-license fonts and a handful of
 * presets, resolved from world.yaml's optional `theme:` block and baked
 * into the built site as CSS. The viewer stays generic — a theme is
 * nothing but variables.
 *
 * Fonts ship as latin-subset WOFF2 under fonts/ (about 15-75 KB each),
 * so the built site stays self-contained and offline. Every stack
 * carries fallbacks, so a missing file degrades to a readable face
 * instead of breaking the page.
 */

export interface FontChoice {
  /** The @font-face family name ("system-ui" for the default stack). */
  family: string;
  /** The woff2 under fonts/, when the shelf ships one for this font. */
  file?: string | undefined;
  /** The weight range the file covers, for the @font-face rule. */
  weights?: string | undefined;
  /** What follows the family in the stack, so a missing file degrades. */
  fallback: string;
  /** Whether the font also suits body text, or is a display face only. */
  bodyOk: boolean;
}

export interface ThemeColors {
  /** Page background. */
  bg: string;
  /** Bars and sheets that sit on the page. */
  panel: string;
  /** Inputs, buttons, event dots: the raised surfaces. */
  card: string;
  /** Quiet washes and hovers. */
  soft: string;
  soft2: string;
  /** Primary text. */
  ink: string;
  /** Secondary text. */
  muted: string;
  /** Hairlines and the timeline rule. */
  line: string;
  /** Links, chips, the go color. */
  accent: string;
  /** Text on accent-colored fills. */
  accentInk: string;
  /** The accent's quiet wash. */
  accentSoft: string;
  /** Event markers and the follow trace. */
  event: string;
  /** Portal jump markers. */
  portal: string;
  /** What shows behind the map image. */
  mapBg: string;
}

export interface ResolvedTheme {
  fonts: { heading: FontChoice; body: FontChoice };
  colors: ThemeColors;
}

const SYSTEM_FALLBACK = '-apple-system, "Segoe UI", sans-serif';

/** The bundled fonts. Ids are what world.yaml's theme.fonts uses. */
export const FONT_SHELF: Record<string, FontChoice> = {
  default: { family: "system-ui", fallback: SYSTEM_FALLBACK, bodyOk: true },
  "eb-garamond": {
    family: "EB Garamond",
    file: "eb-garamond.woff2",
    weights: "400 800",
    fallback: "Georgia, serif",
    bodyOk: true,
  },
  cinzel: {
    family: "Cinzel",
    file: "cinzel.woff2",
    weights: "400 900",
    fallback: '"Palatino Linotype", serif',
    bodyOk: false,
  },
  "im-fell-english": {
    family: "IM Fell English",
    file: "im-fell-english.woff2",
    weights: "400",
    fallback: "Georgia, serif",
    bodyOk: true,
  },
  "great-vibes": {
    family: "Great Vibes",
    file: "great-vibes.woff2",
    weights: "400",
    fallback: "cursive",
    bodyOk: false,
  },
  orbitron: {
    family: "Orbitron",
    file: "orbitron.woff2",
    weights: "400 900",
    fallback: "Verdana, sans-serif",
    bodyOk: false,
  },
  "space-grotesk": {
    family: "Space Grotesk",
    file: "space-grotesk.woff2",
    weights: "300 700",
    fallback: SYSTEM_FALLBACK,
    bodyOk: true,
  },
  "special-elite": {
    family: "Special Elite",
    file: "special-elite.woff2",
    weights: "400",
    fallback: '"Courier New", monospace',
    bodyOk: true,
  },
  caveat: {
    family: "Caveat",
    file: "caveat.woff2",
    weights: "400 700",
    fallback: "cursive",
    bodyOk: false,
  },
};

export const THEME_FONT_IDS = Object.keys(FONT_SHELF);

/** The palette the viewer ships with — no theme block, no change. */
const DEFAULT_COLORS: ThemeColors = {
  bg: "#f7f4ee",
  panel: "#fffdf8",
  card: "#ffffff",
  soft: "#f2ece0",
  soft2: "#f3ede0",
  ink: "#2b2620",
  muted: "#6b6155",
  line: "#ddd4c4",
  accent: "#1f4fa0",
  accentInk: "#ffffff",
  accentSoft: "#e8eef9",
  event: "#b3541e",
  portal: "#6a3fb5",
  mapBg: "#ded7c9",
};

type Partial2<T> = { [K in keyof T]?: T[K] | undefined };

interface Preset {
  fonts: { heading: string; body: string };
  colors: Partial2<ThemeColors>;
}

/** One-word vibes. A theme block can start from one and override. */
export const THEME_PRESETS: Record<string, Preset> = {
  chronicle: {
    fonts: { heading: "eb-garamond", body: "eb-garamond" },
    colors: {
      bg: "#f5f1e8",
      panel: "#fdfbf4",
      card: "#fffdf6",
      soft: "#ece4d2",
      soft2: "#efe8d8",
      ink: "#2a251c",
      muted: "#6e6350",
      line: "#d9cfb8",
      accent: "#7a4a12",
      accentInk: "#fdfbf4",
      accentSoft: "#efe4d0",
      event: "#9a3b1e",
      portal: "#5d4a7e",
      mapBg: "#e4dcc9",
    },
  },
  fantasy: {
    fonts: { heading: "cinzel", body: "im-fell-english" },
    colors: {
      bg: "#efe6d0",
      panel: "#f8f1de",
      card: "#fbf6e7",
      soft: "#e8dcbf",
      soft2: "#ede3ca",
      ink: "#3a2f1e",
      muted: "#7c6a4c",
      line: "#d4c3a0",
      accent: "#7c5a1e",
      accentInk: "#f8f1de",
      accentSoft: "#eadfc4",
      event: "#a34d17",
      portal: "#6b4fa0",
      mapBg: "#e0d3b4",
    },
  },
  scifi: {
    fonts: { heading: "orbitron", body: "space-grotesk" },
    colors: {
      bg: "#10141c",
      panel: "#1a2029",
      card: "#212a36",
      soft: "#1e2733",
      soft2: "#232d3b",
      ink: "#dbe5f1",
      muted: "#8b98ab",
      line: "#2b3543",
      accent: "#4cc2ff",
      accentInk: "#0a121c",
      accentSoft: "#12283a",
      event: "#ff9e3d",
      portal: "#a98aff",
      mapBg: "#0b0e14",
    },
  },
  manuscript: {
    fonts: { heading: "im-fell-english", body: "eb-garamond" },
    colors: {
      bg: "#f3ead6",
      panel: "#faf4e4",
      card: "#fdf8ea",
      soft: "#ece0c4",
      soft2: "#f0e6cf",
      ink: "#33291a",
      muted: "#77684c",
      line: "#d6c7a4",
      accent: "#6e5320",
      accentInk: "#faf4e4",
      accentSoft: "#eee1c4",
      event: "#9c4415",
      portal: "#6f5a94",
      mapBg: "#e6dabf",
    },
  },
  "case-file": {
    fonts: { heading: "special-elite", body: "special-elite" },
    colors: {
      bg: "#ece5d3",
      panel: "#f6f1e3",
      card: "#faf6ea",
      soft: "#e3dbc6",
      soft2: "#e8e1ce",
      ink: "#26221a",
      muted: "#6a6355",
      line: "#cfc5ac",
      accent: "#8a2f2b",
      accentInk: "#f6f1e3",
      accentSoft: "#ecdcd6",
      event: "#7a3517",
      portal: "#4f5a6b",
      mapBg: "#ded5bc",
    },
  },
};

export const THEME_PRESET_IDS = Object.keys(THEME_PRESETS);

const COLOR_KEYS = Object.keys(DEFAULT_COLORS) as Array<keyof ThemeColors>;

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function pickFont(id: unknown, role: "heading" | "body", warnings: string[]): FontChoice {
  if (typeof id !== "string") {
    return FONT_SHELF["default"]!;
  }
  const font = FONT_SHELF[id];
  if (font === undefined) {
    warnings.push(`theme: unknown font "${id}" (known: ${THEME_FONT_IDS.join(", ")})`);
    return FONT_SHELF["default"]!;
  }
  if (role === "body" && !font.bodyOk) {
    warnings.push(`theme: font "${id}" is a display face; the body stays with the default`);
    return FONT_SHELF["default"]!;
  }
  return font;
}

/**
 * Resolve the theme block from world.yaml. Never throws: unknown names
 * and malformed colors warn and fall back, because a typo should not
 * stop a world from building.
 */
export function resolveTheme(raw: unknown): { theme: ResolvedTheme; warnings: string[] } {
  const warnings: string[] = [];
  const colors: ThemeColors = { ...DEFAULT_COLORS };
  let heading = FONT_SHELF["default"]!;
  let body = FONT_SHELF["default"]!;

  const block =
    raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  if (block.preset !== undefined) {
    const preset = THEME_PRESETS[String(block.preset)];
    if (preset === undefined) {
      warnings.push(
        `theme: unknown preset "${String(block.preset)}" (known: ${THEME_PRESET_IDS.join(", ")})`,
      );
    } else {
      heading = FONT_SHELF[preset.fonts.heading] ?? heading;
      body = FONT_SHELF[preset.fonts.body] ?? body;
      for (const [key, value] of Object.entries(preset.colors)) {
        const colorKey = key as keyof ThemeColors;
        if (typeof value === "string") {
          colors[colorKey] = value;
        }
      }
    }
  }

  const fonts = block.fonts;
  if (fonts !== null && typeof fonts === "object") {
    const record = fonts as Record<string, unknown>;
    if (record.heading !== undefined) {
      heading = pickFont(record.heading, "heading", warnings);
    }
    if (record.body !== undefined) {
      body = pickFont(record.body, "body", warnings);
    }
  }

  const overrides = block.colors;
  if (overrides !== null && typeof overrides === "object") {
    const record = overrides as Record<string, unknown>;
    for (const key of COLOR_KEYS) {
      if (record[key] === undefined) {
        continue;
      }
      if (isHexColor(record[key])) {
        colors[key] = record[key];
      } else {
        warnings.push(`theme: color "${key}" is not a hex color, ignored`);
      }
    }
    for (const key of Object.keys(record)) {
      if (!COLOR_KEYS.includes(key as keyof ThemeColors)) {
        warnings.push(`theme: unknown color "${key}", ignored`);
      }
    }
  }

  return { theme: { fonts: { heading, body }, colors }, warnings };
}

/** The woff2 files a built site needs, for `build` to copy. */
export function themeFontFiles(theme: ResolvedTheme): string[] {
  const files = new Set<string>();
  for (const choice of [theme.fonts.heading, theme.fonts.body]) {
    if (choice.file !== undefined) {
      files.add(choice.file);
    }
  }
  return [...files];
}

function stack(choice: FontChoice): string {
  return `${choice.family.includes(" ") ? `"${choice.family}"` : choice.family}, ${choice.fallback}`;
}

/** The CSS a built site gets: @font-face for the shelf files it uses,
 *  and the :root variables the viewer reads. */
export function themeCss(theme: ResolvedTheme): string {
  const parts: string[] = [];
  for (const choice of [theme.fonts.heading, theme.fonts.body]) {
    if (choice.file === undefined) {
      continue;
    }
    const family = `"${choice.family}"`;
    if (parts.some((part) => part.includes(`font-family:${family};`))) {
      continue;
    }
    const weights = choice.weights === undefined ? "normal" : choice.weights;
    parts.push(
      `@font-face{font-family:${family};src:url("fonts/${choice.file}") format("woff2");font-weight:${weights};font-display:swap;}`,
    );
  }
  const vars: string[] = [
    `--font-heading:${stack(theme.fonts.heading)}`,
    `--font-body:${stack(theme.fonts.body)}`,
    ...COLOR_KEYS.map((key) => `--${key === "mapBg" ? "map-bg" : key === "soft2" ? "soft-2" : key === "accentInk" ? "accent-ink" : key === "accentSoft" ? "accent-soft" : key}:${theme.colors[key]}`),
  ];
  parts.push(`:root{${vars.join(";")}}`);
  return parts.join("");
}
