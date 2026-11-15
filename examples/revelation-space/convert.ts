/**
 * Convert the Revelation Space dataset into a Timewright world.
 *
 *   node --experimental-strip-types examples/revelation-space/convert.ts [rsDataDir]
 *
 * Reads the Revelation Space data folder and writes this one: world.yaml,
 * the maps (as SVG), the locations, the people and the events.
 *
 * The Revelation Space project is untouched. This is a one-way copy.
 *
 * What becomes what:
 *
 *   star systems        -> locations on the region chart, each opening its
 *                          own system map
 *   planets, moons,     -> locations on their system map
 *   cities, habitats
 *   vessels             -> mobile locations (they move, and people can be
 *                          aboard them)
 *   characters,         -> people. Factions and organisations too: they have
 *   factions,             presence intervals, which is exactly what a person
 *   organisations         has in Timewright.
 *   presence intervals  -> stays
 *   transits            -> a stay in deep space, since Timewright does not
 *                          interpolate a position between two places
 *   events              -> events. `work` and `seq` become tags and order.
 *   place conditions    -> the location's card, as Markdown
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const RS_DATA = process.argv[2] ?? join(HERE, "..", "..", "..", "revelation-space-map", "data");

const REGION = { id: "region", name: "The Local Neighbourhood", width: 900, height: 900 };
const SYSTEM = { width: 800, height: 600 };
const DEEP_SPACE = "Deep space";

const PLACE_KINDS = new Set([
  "star_system",
  "planet",
  "moon",
  "city",
  "station",
  "habitat",
  "habitat_ring",
  "region",
  "artifact",
]);
const AGENT_KINDS = new Set(["character", "faction", "organization"]);

interface RsPresence {
  from: number;
  to: number | null;
  at: string;
}

interface RsTransit {
  from: number;
  to: number;
  from_at: string;
  to_at: string;
  ended?: number;
}

interface RsNode {
  id: string;
  name: string;
  kind: string;
  parent: string | null;
  placement?: string;
  position?:
    | { frame: "sky"; ra: number; dec: number; dist_ly: number }
    | { frame: "local"; x: number; y: number };
  orbit_order?: number;
  ring?: { radius: number; thickness?: number };
  vessel_class?: string;
  star_class?: string;
  color?: string;
  alias_of?: string;
  presence?: RsPresence[];
  transit?: RsTransit[];
  notes?: string;
  sources?: string[];
}

interface RsEvent {
  id: string;
  from: number;
  to: number;
  certainty: string;
  scope: string;
  at: string[];
  participants: string[];
  kind: string;
  title: string;
  summary: string;
  sources: string[];
  work?: string;
  seq?: number;
  chapter?: string;
}

interface RsState {
  node: string;
  from: number;
  to: number | null;
  state: string;
  label?: string;
  sources: string[];
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function listJson(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

function loadNodes(): RsNode[] {
  const dir = join(RS_DATA, "nodes");
  return listJson(dir).map((file) => {
    const raw = readJson(join(dir, file)) as Omit<RsNode, "id">;
    return { ...raw, id: file.replace(/\.json$/, "") };
  });
}

function loadEvents(): RsEvent[] {
  const dir = join(RS_DATA, "events");
  return listJson(dir).map((file) => {
    const raw = readJson(join(dir, file)) as Omit<RsEvent, "id">;
    return { ...raw, id: file.replace(/\.json$/, "") };
  });
}

function loadStates(): RsState[] {
  const dir = join(RS_DATA, "states");
  const states: RsState[] = [];
  for (const file of listJson(dir)) {
    const raw = readJson(join(dir, file)) as { states?: RsState[] } | RsState[];
    const list = Array.isArray(raw) ? raw : (raw.states ?? []);
    for (const state of list) {
      states.push(state);
    }
  }
  return states;
}

/** Names are how the dataset refers to things; ids come from filenames. */
function buildNameLookup(nodes: RsNode[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const node of nodes) {
    index.set(normalise(node.name), node.id);
  }
  return index;
}

function normalise(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ *
 * Sky positions: real, straight out of the Revelation Space dataset.
 * ------------------------------------------------------------------ */

const DEG = Math.PI / 180;
const ALPHA_G = 192.85948;
const DELTA_G = 27.12825;
const L_NCP = 122.93192;

function toGalactic(raDeg: number, decDeg: number, distLy: number) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const aG = ALPHA_G * DEG;
  const dG = DELTA_G * DEG;
  const sinB =
    Math.sin(dG) * Math.sin(dec) + Math.cos(dG) * Math.cos(dec) * Math.cos(ra - aG);
  const b = Math.asin(Math.max(-1, Math.min(1, sinB)));
  const y =
    Math.cos(dG) * Math.sin(dec) - Math.sin(dG) * Math.cos(dec) * Math.cos(ra - aG);
  const x = Math.cos(dec) * Math.sin(ra - aG);
  const l = (L_NCP - Math.atan2(y, x)) / DEG;
  const cosB = Math.cos(b);
  return {
    x: distLy * cosB * Math.cos(l * DEG),
    y: distLy * cosB * Math.sin(l * DEG),
    z: distLy * sinB,
  };
}

/* ------------------------------------------------------------------ *
 * Maps.
 * ------------------------------------------------------------------ */

interface StarPosition {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  dist: number;
  radius: number;
}

function buildRegion(nodes: RsNode[]): { stars: StarPosition[]; scale: number; maxR: number } {
  const cx = REGION.width / 2;
  const cy = REGION.height / 2;
  const systems = nodes.filter((node) => node.kind === "star_system");
  const points = systems
    .map((node) => {
      const position = node.position;
      if (position === undefined || position.frame !== "sky") {
        return undefined;
      }
      const gal = toGalactic(position.ra, position.dec, position.dist_ly);
      return { node, gal, dist: position.dist_ly };
    })
    .filter((point): point is NonNullable<typeof point> => point !== undefined);

  const maxR = Math.max(...points.map((point) => Math.hypot(point.gal.x, point.gal.y)), 1);
  const scale = (Math.min(REGION.width, REGION.height) / 2 - 90) / maxR;

  const stars = points.map(({ node, gal, dist }) => ({
    id: node.id,
    name: node.name,
    x: cx + gal.x * scale,
    y: cy - gal.y * scale,
    z: gal.z,
    dist,
    radius: node.id === "sol" ? 7 : 4.5,
  }));
  return { stars, scale, maxR };
}

function regionSvg(stars: StarPosition[], scale: number, maxR: number): string {
  const cx = REGION.width / 2;
  const cy = REGION.height / 2;
  const parts: string[] = [];
  parts.push(`<rect width="${REGION.width}" height="${REGION.height}" fill="#0a0e1c"/>`);
  for (let distance = 5; distance <= maxR; distance += 5) {
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${(distance * scale).toFixed(1)}" fill="none" stroke="#243050" stroke-width="1" stroke-dasharray="3 6"/>`,
    );
  }
  for (const star of stars) {
    if (Math.abs(star.z) > 0.4) {
      const length = Math.sign(star.z) * Math.min(52, Math.abs(star.z) * 3.4);
      parts.push(
        `<line x1="${star.x.toFixed(1)}" y1="${star.y.toFixed(1)}" x2="${star.x.toFixed(1)}" y2="${(star.y + length).toFixed(1)}" stroke="#3b4a74" stroke-width="1"/>`,
      );
    }
    parts.push(
      `<circle cx="${star.x.toFixed(1)}" cy="${star.y.toFixed(1)}" r="${star.radius}" fill="${star.id === "sol" ? "#fff0c0" : "#ffd88a"}"/>`,
    );
    if (star.id === "sol") {
      parts.push(
        `<circle cx="${star.x.toFixed(1)}" cy="${star.y.toFixed(1)}" r="14" fill="none" stroke="#fff0c0" stroke-width="1" opacity="0.5"/>`,
      );
    }
  }
  parts.push(
    `<text x="24" y="${REGION.height - 24}" fill="#55648c" font-family="DejaVu Sans, Helvetica, sans-serif" font-size="13">Overhead view of the galactic plane, true scale. Rings are distance from Sol.</text>`,
  );
  return wrapSvg(REGION.width, REGION.height, parts.join(""));
}

/**
 * The layout of a system map.
 *
 * The star sits in the middle. Planets go on orbit rings, in the order the
 * canon gives them where it can. Everything else - cities, moons, habitats -
 * gathers around the planet it belongs to.
 */
function layoutSystem(
  system: RsNode,
  nodes: RsNode[],
  parentOf: Map<string, string>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const ringRadii = new Map<string, number>();
  const cx = SYSTEM.width / 2;
  const cy = SYSTEM.height / 2;
  positions.set(system.id, { x: cx, y: cy });

  const childrenOf = new Map<string, RsNode[]>();
  for (const node of nodes) {
    const parentId = parentOf.get(node.id);
    if (parentId === undefined) {
      continue;
    }
    const list = childrenOf.get(parentId) ?? [];
    list.push(node);
    childrenOf.set(parentId, list);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => {
      const orderA = a.orbit_order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.orbit_order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.id.localeCompare(b.id);
    });
  }

  // The planets go on orbit rings.
  const direct = childrenOf.get(system.id) ?? [];
  direct.forEach((child, index) => {
    const radius = Math.min(90 + index * 52, 250);
    const angle = (-90 + index * 47) * DEG;
    positions.set(child.id, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius * 0.72,
    });
  });

  // Everything below a planet gathers around that planet. This walks down
  // the tree, so a child is never skipped because its parent had not been
  // placed yet - the order the files happen to be read in does not matter.
  const placeChildren = (parentId: string): void => {
    const children = childrenOf.get(parentId) ?? [];
    children.forEach((child, index) => {
      const parent = positions.get(parentId);
      if (parent === undefined) {
        return;
      }
      if (child.kind === "habitat_ring") {
        // The band is a ring around the planet it orbits.
        const radius = child.ring === undefined ? 26 : Math.min(44, 12 + child.ring.radius / 8);
        ringRadii.set(child.id, radius);
        positions.set(child.id, { x: parent.x, y: parent.y });
      } else {
        const angle = (index * 137.5 - 90) * DEG;
        positions.set(child.id, {
          x: parent.x + Math.cos(angle) * 16,
          y: parent.y + Math.sin(angle) * 16,
        });
      }
      placeChildren(child.id);
    });
  };
  placeChildren(system.id);

  // Habitats sit on the ring of the band they belong to.
  for (const band of nodes.filter((node) => node.kind === "habitat_ring")) {
    const bandPosition = positions.get(band.id);
    if (bandPosition === undefined) {
      continue;
    }
    const radius = ringRadii.get(band.id) ?? 26;
    const members = childrenOf.get(band.id) ?? [];
    members.forEach((member, index) => {
      const angle = (index / Math.max(members.length, 1)) * Math.PI * 2;
      positions.set(member.id, {
        x: bandPosition.x + Math.cos(angle) * radius,
        y: bandPosition.y + Math.sin(angle) * radius * 0.7,
      });
    });
  }

  return positions;
}

function systemSvg(
  system: RsNode,
  nodes: RsNode[],
  positions: Map<string, { x: number; y: number }>,
  parentOf: Map<string, string>,
): string {
  const parts: string[] = [];
  parts.push(`<rect width="${SYSTEM.width}" height="${SYSTEM.height}" fill="#0a0e1c"/>`);
  const cx = SYSTEM.width / 2;
  const cy = SYSTEM.height / 2;

  for (const node of nodes) {
    if (parentOf.get(node.id) !== system.id) {
      continue;
    }
    const position = positions.get(node.id);
    if (position === undefined) {
      continue;
    }
    const radius = Math.hypot(position.x - cx, position.y - cy);
    parts.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${radius.toFixed(1)}" ry="${(radius * 0.72).toFixed(1)}" fill="none" stroke="#243050" stroke-width="1" stroke-dasharray="3 6"/>`,
    );
  }

  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="26" fill="#ffd88a" opacity="0.14"/>`,
    `<circle cx="${cx}" cy="${cy}" r="13" fill="#fff0c0"/>`,
  );

  for (const node of nodes) {
    if (parentOf.get(node.id) !== system.id || node.kind === "habitat_ring") {
      continue;
    }
    const position = positions.get(node.id);
    if (position === undefined) {
      continue;
    }
    parts.push(
      `<circle cx="${position.x.toFixed(1)}" cy="${position.y.toFixed(1)}" r="5" fill="#9ec7e8"/>`,
    );
  }

  for (const band of nodes.filter((node) => node.kind === "habitat_ring")) {
    const position = positions.get(band.id);
    if (position === undefined) {
      continue;
    }
    const radius = band.ring === undefined ? 26 : Math.min(44, 12 + band.ring.radius / 8);
    parts.push(
      `<ellipse cx="${position.x.toFixed(1)}" cy="${position.y.toFixed(1)}" rx="${radius}" ry="${(radius * 0.7).toFixed(1)}" fill="none" stroke="#c9a227" stroke-width="1.5" opacity="0.8"/>`,
    );
  }

  parts.push(
    `<text x="24" y="${SYSTEM.height - 24}" fill="#55648c" font-family="DejaVu Sans, Helvetica, sans-serif" font-size="13">${escapeXml(system.name)} — orbital radii exaggerated, not to scale.</text>`,
  );
  return wrapSvg(SYSTEM.width, SYSTEM.height, parts.join(""));
}

function wrapSvg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ *
 * Stays.
 * ------------------------------------------------------------------ */

interface Stay {
  at: string;
  from?: number;
  until?: number;
}

function staysFromPresence(node: RsNode): Stay[] {
  const presence = [...(node.presence ?? [])].sort((a, b) => a.from - b.from);
  const stays: Stay[] = presence.map((interval) => {
    const stay: Stay = { at: interval.at, from: interval.from };
    if (interval.to !== null) {
      stay.until = interval.to;
    }
    return stay;
  });

  // A gap between two intervals is time spent in deep space.
  for (let index = 1; index < presence.length; index += 1) {
    const previous = presence[index - 1];
    const current = presence[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const previousEnd = previous.to ?? Number.POSITIVE_INFINITY;
    if (previousEnd < current.from) {
      stays.push({ at: DEEP_SPACE, from: previousEnd, until: current.from });
    }
  }
  return stays.sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
}

function staysWithTransits(node: RsNode): Stay[] {
  const stays = staysFromPresence(node);
  for (const leg of node.transit ?? []) {
    const end = leg.ended ?? leg.to;
    const covered = stays.some(
      (stay) => stay.from !== undefined && stay.from <= leg.from && (stay.until ?? Infinity) >= end,
    );
    if (!covered) {
      stays.push({ at: DEEP_SPACE, from: leg.from, until: end });
    }
  }
  return stays.sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
}

/* ------------------------------------------------------------------ *
 * Writing.
 * ------------------------------------------------------------------ */

function writeYaml(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stringify(value, { lineWidth: 100 }), "utf8");
}

function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}

function main(): void {
  const nodes = loadNodes();
  const events = loadEvents();
  const states = loadStates();
  const byName = buildNameLookup(nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // `parent` and `alias_of` are names in the dataset; the ids come from the
  // filenames. Both have to be resolved before anything else refers to them.
  const aliasTarget = new Map<string, string>();
  for (const node of nodes) {
    if (node.alias_of !== undefined) {
      aliasTarget.set(node.id, byName.get(normalise(node.alias_of)) ?? node.alias_of);
    }
  }
  const parentOf = new Map<string, string>();
  for (const node of nodes) {
    if (node.parent !== null && node.parent !== undefined) {
      parentOf.set(node.id, byName.get(normalise(node.parent)) ?? node.parent);
    }
  }
  // The name index: an alias answers to the person it names.
  const names = new Map<string, string>();
  for (const node of nodes) {
    names.set(normalise(node.name), aliasTarget.get(node.id) ?? node.id);
  }

  const systems = nodes.filter((node) => node.kind === "star_system");
  const region = buildRegion(nodes);

  /** The system a place belongs to, by walking up the parents. */
  function systemOf(node: RsNode): RsNode | undefined {
    let current: RsNode | undefined = node;
    const seen = new Set<string>();
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.kind === "star_system") {
        return current;
      }
      current = parentOf.has(current.id) ? byId.get(parentOf.get(current.id) ?? "") : undefined;
    }
    return undefined;
  }

  const systemLayouts = new Map<string, Map<string, { x: number; y: number }>>();
  for (const system of systems) {
    systemLayouts.set(system.id, layoutSystem(system, nodes, parentOf));
  }

  // ---- maps -------------------------------------------------------
  const mapFiles: Record<string, unknown>[] = [];
  mapFiles.push({
    id: REGION.id,
    name: REGION.name,
    size: [REGION.width, REGION.height],
    images: [{ file: "region.svg", caption: "The local neighbourhood, true scale." }],
  });
  for (const system of systems) {
    mapFiles.push({
      id: system.id,
      name: system.name,
      parent: REGION.id,
      size: [SYSTEM.width, SYSTEM.height],
      images: [{ file: `${system.id}.svg`, caption: `${system.name}, schematically.` }],
    });
  }
  for (const file of mapFiles) {
    const id = (file as { id: string }).id;
    const name = (file as { name: string }).name;
    writeYaml(join(HERE, "maps", `${id}.yaml`), file);
    void name;
  }
  writeText(join(HERE, "maps", "region.svg"), regionSvg(region.stars, region.scale, region.maxR));
  for (const system of systems) {
    const layout = systemLayouts.get(system.id);
    if (layout === undefined) {
      continue;
    }
    writeText(join(HERE, "maps", `${system.id}.svg`), systemSvg(system, nodes, layout, parentOf));
  }

  // ---- locations --------------------------------------------------
  const statesByNode = new Map<string, RsState[]>();
  for (const state of states) {
    const id = names.get(normalise(state.node)) ?? state.node;
    const list = statesByNode.get(id) ?? [];
    list.push(state);
    statesByNode.set(id, list);
  }

  const locations: Record<string, unknown>[] = [];
  for (const node of nodes) {
    if (!PLACE_KINDS.has(node.kind)) {
      continue;
    }
    const system = systemOf(node);
    const isSystem = node.kind === "star_system";
    const mapId = isSystem ? REGION.id : (system?.id ?? REGION.id);

    let at: [number, number] | undefined;
    if (isSystem) {
      const star = region.stars.find((entry) => entry.id === node.id);
      if (star !== undefined) {
        at = [Math.round(star.x), Math.round(star.y)];
      }
    } else if (system !== undefined) {
      const layout = systemLayouts.get(system.id);
      const position = layout?.get(node.id);
      if (position !== undefined) {
        at = [Math.round(position.x), Math.round(position.y)];
      }
    } else {
      // Deep space: between the stars, so out at the edge of the chart.
      at = [70, REGION.height - 70];
    }

    const card: string[] = [];
    if (node.notes !== undefined && node.notes !== "") {
      card.push(node.notes);
    }
    const conditions = statesByNode.get(node.id) ?? [];
    if (conditions.length > 0) {
      card.push("", "**Condition over time**", "");
      for (const condition of conditions) {
        const until = condition.to !== null ? condition.to : "present";
        const label = condition.label !== undefined ? ` — ${condition.label}` : "";
        card.push(`- ${condition.from}–${until}: ${condition.state}${label}`);
      }
    }

    const record: Record<string, unknown> = {
      id: node.id,
      name: node.name,
      map: mapId,
      tags: [node.kind],
    };
    if (at !== undefined) {
      record.at = at;
    }
    if (isSystem) {
      record.opens = node.id;
    }
    if (card.length > 0) {
      record.card = card.join("\n");
    }
    if (node.sources !== undefined && node.sources.length > 0) {
      record.sources = node.sources;
    }
    locations.push(record);
  }

  // ---- people -----------------------------------------------------
  // Collect the aliases first, so the order the nodes happen to be read in
  // cannot decide whether an alias finds its person.
  const aliasesById = new Map<string, string[]>();
  for (const node of nodes) {
    const target = aliasTarget.get(node.id);
    if (target === undefined) {
      continue;
    }
    const list = aliasesById.get(target) ?? [];
    list.push(node.name);
    aliasesById.set(target, list);
  }

  const people: Record<string, unknown>[] = [];
  for (const node of nodes) {
    if (!AGENT_KINDS.has(node.kind)) {
      continue;
    }
    if (aliasTarget.has(node.id)) {
      // An alias is another name for the same person, not a second record.
      continue;
    }

    const aliases = aliasesById.get(node.id) ?? [];

    const record: Record<string, unknown> = {
      id: node.id,
      name: node.name,
      tags: [node.kind],
    };
    if (aliases.length > 0) {
      record.aliases = aliases;
    }
    const stays = staysFromPresence(node);
    if (stays.length > 0) {
      record.stays = stays;
    }
    if (node.notes !== undefined && node.notes !== "") {
      record.bio = node.notes;
    }
    if (node.color !== undefined) {
      record.color = node.color;
    }
    if (node.sources !== undefined && node.sources.length > 0) {
      record.sources = node.sources;
    }
    people.push(record);
  }

  // ---- vessels ----------------------------------------------------
  for (const node of nodes) {
    if (node.kind !== "vessel") {
      continue;
    }
    const stays = staysWithTransits(node);
    const record: Record<string, unknown> = {
      id: node.id,
      name: node.name,
      kind: "mobile",
      tags: node.vessel_class !== undefined ? ["vessel", node.vessel_class] : ["vessel"],
    };
    if (stays.length > 0) {
      record.stays = stays;
    }
    if (node.notes !== undefined && node.notes !== "") {
      record.card = node.notes;
    }
    if (node.sources !== undefined && node.sources.length > 0) {
      record.sources = node.sources;
    }
    locations.push(record);
  }

  // ---- events -----------------------------------------------------
  const convertedEvents: Record<string, unknown>[] = [];
  for (const event of events) {
    let when: string;
    if (event.from === event.to) {
      when = event.certainty === "approximate" ? `~${event.from}` : String(event.from);
    } else {
      when = `${event.from}..${event.to}`;
    }

    const tags = [event.kind];
    if (event.work !== undefined) {
      tags.push(event.work);
    }
    if (event.scope === "galactic") {
      tags.push("galactic");
    }

    const record: Record<string, unknown> = {
      id: event.id,
      title: event.title,
      when,
      tags,
    };
    if (event.at.length > 0) {
      record.where = event.at[0];
    }
    if (event.at.length > 1) {
      record.locations = event.at;
    }
    if (event.participants.length > 0) {
      record.people = event.participants;
    }
    if (event.seq !== undefined) {
      record.order = event.seq;
    }
    const card: string[] = [];
    if (event.summary !== undefined && event.summary !== "") {
      card.push(event.summary);
    }
    if (event.chapter !== undefined) {
      card.push("", `_${event.work ?? "source"}${event.chapter}_`);
    }
    if (card.length > 0) {
      record.card = card.join("\n");
    }
    if (event.sources !== undefined && event.sources.length > 0) {
      record.sources = event.sources;
    }
    convertedEvents.push(record);
  }

  // ---- the world --------------------------------------------------
  writeYaml(join(HERE, "world.yaml"), {
    title: "Revelation Space",
    overworld: REGION.id,
    calendar: "gregorian",
    start: 2083,
    end: 2950,
  });
  writeYaml(join(HERE, "locations", "locations.yaml"), locations);
  writeYaml(join(HERE, "people", "people.yaml"), people);
  writeYaml(join(HERE, "events", "events.yaml"), convertedEvents);

  console.log(`Converted ${nodes.length} nodes, ${events.length} events, ${states.length} states.`);
  console.log(`  ${mapsCount(mapFiles)} maps, ${locations.length} locations, ${people.length} people, ${convertedEvents.length} events.`);
  console.log(`  Wrote to ${HERE}`);
}

function mapsCount(files: Record<string, unknown>[]): number {
  return files.length;
}

main();
