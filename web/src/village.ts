import type { GuildState, Hero, Location, Rank } from '@agent-guild/core';
import {
  currentQuest,
  inAudience,
  librarianState,
  librariansIn,
  rankOf,
  roster,
  smithsIn,
} from '@agent-guild/core';

/**
 * Canvas drawing for the village, using the Tiny Swords pack (Pixel Frog, CC0) and
 * Agent Quest's building art (MIT). See web/public/assets/tiny-swords/CREDITS.md.
 *
 * Drawing is a function of (state, sprites, clock, walkers). Demo mode passes a frozen
 * clock and no walkers, so a given URL renders the same frame every time.
 */

export const VILLAGE_WIDTH = 1120;
export const VILLAGE_HEIGHT = 720;

const ASSET = '/assets/tiny-swords';
const FRAME = 192;
const TILE = 64;
const UNIT_SCALE = 0.66;
const UNIT_SIZE = FRAME * UNIT_SCALE;
/** Where the feet sit inside a 192px unit frame, as a fraction of its height. */
const FEET = 0.7;
const FRAME_MS = 110;
const WALK_PX_PER_S = 240;

interface Building {
  label: string;
  file: string;
  /** Width over height of the art, so layout and hit-testing need no loaded image. */
  aspect: number;
  /** Bottom-centre of the building on the canvas. */
  x: number;
  y: number;
  height: number;
}

/**
 * The work buildings stand in a row along the top. The castle below them is the Guildhall,
 * home of the King's throne; the open ground to its left is left for the Barracks.
 */
export const BUILDINGS: Record<Location, Building> = {
  library: { label: 'Library', file: 'Library', aspect: 210 / 420, x: 140, y: 210, height: 165 },
  forge: { label: 'Forge', file: 'Forge', aspect: 307 / 460, x: 420, y: 210, height: 175 },
  arena: { label: 'Arena', file: 'Arena', aspect: 320 / 429, x: 700, y: 210, height: 165 },
  tower: { label: 'Tower', file: 'Tower', aspect: 195 / 390, x: 970, y: 210, height: 170 },
  guildhall: { label: 'Guildhall', file: 'Castle', aspect: 400 / 270, x: 640, y: 500, height: 160 },
};

/** Fixed, hand-placed trees: decoration that never moves between frames or runs. */
const TREES: readonly [number, number][] = [
  [30, 100],
  [285, 85],
  [565, 75],
  [845, 85],
  [1095, 120],
  [1095, 440],
  [470, 440],
  [430, 705],
  [1095, 705],
];

/**
 * Team colours. The pack ships four (Blue, Red, Yellow, Purple); the others are the Red
 * sheet with its red cloth turned to another hue, which leaves skin and steel alone.
 * Gold (the Yellow sheet) is the King's alone.
 */
export const TEAMS = ['Blue', 'Red', 'Purple', 'Green', 'Orange', 'Pink', 'Black', 'Gold'] as const;
export type Team = (typeof TEAMS)[number];
const KNIGHT_TEAMS = TEAMS.filter((t) => t !== 'Gold');

export interface HueShift {
  /** Degrees to turn the hue by. */
  delta: number;
  saturation: number;
  lightness: number;
}

const TEAM_ART: Record<Team, { sheet: 'Blue' | 'Red' | 'Yellow' | 'Purple'; shift?: HueShift }> = {
  Blue: { sheet: 'Blue' },
  Red: { sheet: 'Red' },
  Purple: { sheet: 'Purple' },
  Gold: { sheet: 'Yellow' },
  Green: { sheet: 'Red', shift: { delta: 125, saturation: 0.85, lightness: 1 } },
  Orange: { sheet: 'Red', shift: { delta: 30, saturation: 1.15, lightness: 1.3 } },
  Pink: { sheet: 'Red', shift: { delta: -25, saturation: 0.8, lightness: 1.3 } },
  Black: { sheet: 'Red', shift: { delta: 0, saturation: 0.1, lightness: 0.5 } },
};

/** The same colours for the page around the map: roster dots and panel headers. */
export const TEAM_CSS: Record<Team, string> = {
  Blue: '#3aa6c9',
  Red: '#d9453b',
  Purple: '#9b5fc0',
  Green: '#4caf50',
  Orange: '#e8892b',
  Pink: '#ec7fb0',
  Black: '#6b6b6b',
  Gold: '#f2c230',
};

/** Red cloth in the Red sheets: hues from magenta round to red. Skin starts near 25°. */
const isRedCloth = (h: number, s: number) => s >= 0.25 && (h >= 300 || h < 18);

/**
 * Turn the red cloth in RGBA pixels to another colour, in place. Pure, so it is tested
 * without a canvas; the browser runs it once per sheet at load.
 */
export function recolor(data: Uint8ClampedArray, shift: HueShift): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const [h, s, l] = rgbToHsl(data[i]!, data[i + 1]!, data[i + 2]!);
    if (!isRedCloth(h, s)) continue;
    const [r, g, b] = hslToRgb(
      (h + shift.delta + 360) % 360,
      Math.min(1, s * shift.saturation),
      Math.min(1, l * shift.lightness),
    );
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** How big each rank is drawn, against the Knight's size. */
export const RANK_SCALE: Record<Rank, number> = {
  king: 1.3,
  knight: 1,
  footsoldier: 0.76,
  worker: 0.66,
  librarian: 0.9,
  smith: 0.9,
};

export const RANK_LABEL: Record<Rank, string> = {
  king: 'King',
  knight: 'Knight',
  footsoldier: 'Footsoldier',
  worker: 'Worker',
  librarian: 'Librarian',
  smith: 'Smith',
};

export interface Sprites {
  grass: HTMLImageElement;
  tree: HTMLImageElement;
  buildings: Record<string, HTMLImageElement>;
  /** `Warrior_<Team>` and `Pawn_<Team>` for every team. */
  units: Record<string, CanvasImageSource>;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** A sheet with its cloth recoloured, drawn once onto its own canvas. */
function shifted(img: HTMLImageElement, shift: HueShift): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, img.width, img.height);
  recolor(pixels.data, shift);
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

export async function loadSprites(): Promise<Sprites> {
  const sheets = ['Blue', 'Red', 'Yellow', 'Purple'] as const;
  const unitNames = sheets.flatMap((c) => [`Warrior_${c}`, `Pawn_${c}`]);
  const buildingFiles = [...new Set(Object.values(BUILDINGS).map((b) => b.file))];
  const [grass, tree, buildingImgs, unitImgs] = await Promise.all([
    loadImage(`${ASSET}/terrain/Tilemap_Flat.png`),
    loadImage(`${ASSET}/deco/Tree.png`),
    Promise.all(buildingFiles.map((f) => loadImage(`${ASSET}/buildings/${f}.png`))),
    Promise.all(unitNames.map((u) => loadImage(`${ASSET}/units/${u}.png`))),
  ]);
  const raw = Object.fromEntries(unitNames.map((u, i) => [u, unitImgs[i]!]));
  const units: Record<string, CanvasImageSource> = {};
  for (const team of TEAMS) {
    const { sheet, shift } = TEAM_ART[team];
    for (const kind of ['Warrior', 'Pawn']) {
      const img = raw[`${kind}_${sheet}`]!;
      units[`${kind}_${team}`] = shift ? shifted(img, shift) : img;
    }
  }
  return {
    grass,
    tree,
    buildings: Object.fromEntries(buildingFiles.map((f, i) => [f, buildingImgs[i]!])),
    units,
  };
}

/**
 * Where a follower stands behind the agent it serves, nearest slots first: flanks, then
 * a second rank further back. Offsets are for a Knight's party; a follower's own
 * followers stand closer in.
 */
const FORMATION: readonly [number, number][] = [
  [-40, -16],
  [-22, -40],
  [24, -42],
  [-62, -36],
  [0, -60],
  [58, -50],
  [-80, -14],
  [-44, -62],
  [44, -68],
];

/** Where a working leader's training dummy stands: to its right, a step behind. */
export const DUMMY_OFFSET = { x: 46, y: -4 };

/** Milliseconds per frame of a swing, and the frame on which a blow lands. */
const SWING_MS = 105;
const IMPACT_FRAME = 3;

/**
 * Which frame of its swing a hero is on. Each hero starts its swing at a different point
 * (from its id), so a busy yard does not strike in unison, and a frozen demo frame
 * catches some mid-blow.
 */
export function swingFrame(id: string, nowMs: number): number {
  return (Math.floor(nowMs / SWING_MS) + (hash(id) % 6)) % 6;
}

/** Whether a hero is at its post hitting something: working, standing still, not the King. */
export function isFighting(hero: Hero, moving: boolean): boolean {
  return hero.status === 'working' && !moving && !hero.crowned && !hero.librarian && !hero.smith;
}

/** The King's place: his throne at the castle gate. */
export const THRONE = { x: 640, y: 625 };

/**
 * How leaders line up at each building: three abreast, wide enough apart for a party to
 * stand behind each. The guildhall, where resting Knights gather, takes four a row to
 * the right of the throne.
 */
export const ROWS: Record<Location, { x: number; perRow: number; spacing: number }> = {
  library: { x: BUILDINGS.library.x, perRow: 3, spacing: 124 },
  forge: { x: BUILDINGS.forge.x, perRow: 3, spacing: 124 },
  arena: { x: BUILDINGS.arena.x, perRow: 3, spacing: 124 },
  tower: { x: BUILDINGS.tower.x, perRow: 2, spacing: 124 },
  guildhall: { x: 900, perRow: 3, spacing: 110 },
};
/**
 * Where each hero stands. Leaders (the King and Knights) form a row in front of the
 * building their latest tool sent them to; followers stand in formation behind their
 * leader wherever it goes, so a party moves as one.
 */
export function heroPositions(state: GuildState, clock?: number): Map<string, Place> {
  const heroes = roster(state);
  const present = new Set(heroes.map((h) => h.id));
  const leads = (h: Hero) => h.parentId === null || !present.has(h.parentId);

  const positions = new Map<string, Place>();
  const byBuilding = new Map<Location, Hero[]>();
  const sleepers: Hero[] = [];
  let heard = 0;
  for (const hero of heroes.filter(leads)) {
    // The King keeps his throne at the castle gate: he commands, he does not walk to work.
    if (hero.crowned) positions.set(hero.id, { ...THRONE, pose: 'stand' });
    // Just given an order: before the throne to hear it, facing the King.
    else if (clock !== undefined && inAudience(hero, clock)) {
      const [dx, dy] = AUDIENCE[heard++ % AUDIENCE.length]!;
      positions.set(hero.id, {
        x: THRONE.x + dx,
        y: THRONE.y + dy,
        pose: 'stand',
        face: dx > 0 ? 'left' : 'right',
      });
    }
    // A Knight resting between turns goes to bed in the Barracks.
    // The librarians and the smiths work inside the Library and the Forge: signs over
    // those buildings show them (drawSigns).
    else if (hero.librarian || hero.smith) continue;
    // A resting Knight goes to bed in the Barracks.
    else if (hero.status === 'idle') sleepers.push(hero);
    else byBuilding.set(hero.location, [...(byBuilding.get(hero.location) ?? []), hero]);
  }
  for (const [location, group] of byBuilding) {
    const b = BUILDINGS[location];
    const row = ROWS[location];
    const rows = Math.ceil(group.length / row.perRow);
    const firstY = b.y + 88;
    // Rows squeeze together rather than run off the bottom of the map.
    const gap = rows > 1 ? Math.min(64, (VILLAGE_HEIGHT - 16 - firstY) / (rows - 1)) : 0;
    group.forEach((hero, i) => {
      const r = Math.floor(i / row.perRow);
      const inRow = Math.min(row.perRow, group.length - r * row.perRow);
      const col = i % row.perRow;
      positions.set(hero.id, {
        x: row.x + (col - (inRow - 1) / 2) * row.spacing,
        y: firstY + r * gap,
        pose: 'stand',
      });
    });
  }
  bedPlaces(sleepers.length).forEach((bed, i) => positions.set(sleepers[i]!.id, { ...bed, pose: 'sleep' }));

  // Roster order is depth-first, so a follower's leader is always placed before it.
  const placedUnder = new Map<string, number>();
  for (const hero of heroes) {
    if (leads(hero)) continue;
    const parent = state.heroes[hero.parentId!]!;
    const at = positions.get(parent.id);
    // A librarian's party stays inside with it.
    if (!at) continue;
    const n = placedUnder.get(parent.id) ?? 0;
    placedUnder.set(parent.id, n + 1);
    const k = leads(parent) ? 1 : 0.65;
    if (at.pose === 'sleep') {
      // A sleeping party lies either side of its leader's bed.
      const [dx, dy] = SLEEP_SLOTS[n % SLEEP_SLOTS.length]!;
      positions.set(hero.id, { x: at.x + dx * k, y: at.y + dy * k, pose: 'sleep' });
      continue;
    }
    const [dx, dy] = FORMATION[n % FORMATION.length]!;
    const wrap = Math.floor(n / FORMATION.length) * 22;
    positions.set(hero.id, { x: at.x + dx * k, y: at.y + (dy - wrap) * k, pose: 'stand' });
  }
  return positions;
}

/** Where a hero is, whether it stands or lies asleep, and which way it faces if it matters. */
export interface Place {
  x: number;
  y: number;
  pose: 'stand' | 'sleep';
  face?: 'left' | 'right';
}

/**
 * Where Knights stand before the throne while they hear an order, either side of the
 * King, offsets from the throne.
 */
const AUDIENCE: readonly [number, number][] = [
  [-90, 6],
  [90, 6],
  [-160, 18],
  [160, 18],
  [-90, 62],
  [90, 62],
  [-160, 74],
  [160, 74],
];

/** The Barracks: a fenced camp in the bottom-left corner where resting Knights sleep. */
export const BARRACKS = { left: 40, top: 440, right: 400, bottom: 708, fireX: 220, fireY: 482 };
const BED_COLUMNS = [105, 220, 335];
const BED_FIRST_ROW = 552;

/** Followers' spots around a sleeping leader: either side of the bed, clear of its name. */
const SLEEP_SLOTS: readonly [number, number][] = [
  [-50, 2],
  [50, 2],
  [-50, -18],
  [50, -18],
];

/**
 * Beds for `n` sleepers: three to a row below the campfire, rows closing up to fit the
 * camp however many Knights are resting.
 */
export function bedPlaces(n: number): { x: number; y: number }[] {
  const rows = Math.ceil(n / BED_COLUMNS.length);
  const room = BARRACKS.bottom - 40 - BED_FIRST_ROW;
  const gap = rows > 1 ? Math.min(70, room / (rows - 1)) : 0;
  return Array.from({ length: n }, (_, i) => ({
    x: BED_COLUMNS[i % BED_COLUMNS.length]!,
    y: BED_FIRST_ROW + Math.floor(i / BED_COLUMNS.length) * gap,
  }));
}

/**
 * Team colours. The King wears gold. Each Knight gets a colour picked from its id, so it
 * keeps it across reloads, moving to the next free one if another Knight has it. A
 * Knight's followers wear its colour.
 */
export function heroTeams(state: GuildState): Map<string, Team> {
  const teams = new Map<string, Team>();
  const taken = new Set<Team>();
  for (const hero of roster(state)) {
    const parentTeam = hero.parentId ? teams.get(hero.parentId) : undefined;
    if (parentTeam) {
      teams.set(hero.id, parentTeam);
      continue;
    }
    if (hero.librarian) {
      // The librarians wear purple robes, whatever the Knights wear.
      teams.set(hero.id, 'Purple');
      continue;
    }
    if (hero.smith) {
      // The smiths wear forge red.
      teams.set(hero.id, 'Red');
      continue;
    }
    if (hero.crowned) {
      teams.set(hero.id, 'Gold');
      continue;
    }
    const start = hash(hero.id) % KNIGHT_TEAMS.length;
    let team = KNIGHT_TEAMS[start]!;
    for (let i = 0; i < KNIGHT_TEAMS.length; i++) {
      const candidate = KNIGHT_TEAMS[(start + i) % KNIGHT_TEAMS.length]!;
      if (!taken.has(candidate)) {
        team = candidate;
        break;
      }
    }
    taken.add(team);
    teams.set(hero.id, team);
  }
  return teams;
}

/** A small, stable string hash (FNV-1a). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A hero's on-screen position while walking from one building to another. */
export interface Walker {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startMs: number;
}

export function walkerPosition(
  w: Walker,
  nowMs: number,
): { x: number; y: number; moving: boolean; left: boolean } {
  const dist = Math.hypot(w.toX - w.fromX, w.toY - w.fromY);
  const duration = (dist / WALK_PX_PER_S) * 1000;
  const p = duration === 0 ? 1 : Math.min(1, (nowMs - w.startMs) / duration);
  return {
    x: w.fromX + (w.toX - w.fromX) * p,
    y: w.fromY + (w.toY - w.fromY) * p,
    moving: p < 1,
    left: w.toX < w.fromX,
  };
}

/** Something on the map the user can click: a hero or a building. */
export type Selection = { kind: 'hero'; id: string } | { kind: 'building'; id: Location };

export const sameSelection = (a: Selection | null, b: Selection | null) =>
  a?.kind === b?.kind && a?.id === b?.id;

export interface Placed {
  hero: Hero;
  x: number;
  y: number;
  moving: boolean;
  left: boolean;
  /** Lying asleep: only once a hero has arrived at its bed. */
  asleep: boolean;
  /** Standing before the throne hearing an order: still, facing the King. */
  hearing: boolean;
}

/** Where every hero is drawn right now: at its slot, or part way along a walk. */
export function placeHeroes(
  state: GuildState,
  walkers: ReadonlyMap<string, Walker>,
  nowMs: number,
  clock?: number,
): Placed[] {
  const targets = heroPositions(state, clock);
  return roster(state).flatMap((hero) => {
    const target = targets.get(hero.id);
    if (!target) return [];
    const walker = walkers.get(hero.id);
    const pos = walker
      ? walkerPosition(walker, nowMs)
      : { x: target.x, y: target.y, moving: false, left: target.face === 'left' };
    return {
      hero,
      ...pos,
      asleep: target.pose === 'sleep' && !pos.moving,
      hearing: target.face !== undefined && !pos.moving,
    };
  });
}

function buildingBox(b: Building) {
  const w = b.aspect * b.height;
  // Down to the bottom of the name tag, so clicking the label counts too.
  return { left: b.x - w / 2, right: b.x + w / 2, top: b.y - b.height, bottom: b.y + 24 };
}

/**
 * What is under a point on the canvas. Heroes win over buildings, and of two heroes the
 * one drawn in front (lower on screen) wins, matching what the user sees on top.
 */
export function hitTest(
  state: GuildState,
  walkers: ReadonlyMap<string, Walker>,
  nowMs: number,
  px: number,
  py: number,
  clock?: number,
): Selection | null {
  const placed = placeHeroes(state, walkers, nowMs, clock).sort((a, b) => b.y - a.y);
  for (const p of placed) {
    const k = RANK_SCALE[rankOf(p.hero)];
    // A sleeper lies across its bed: wide and low.
    const hit = p.asleep
      ? Math.abs(px - p.x) <= 34 * k && py >= p.y - 18 * k && py <= p.y + 26 * k
      : Math.abs(px - p.x) <= 26 * k && py >= p.y - 62 * k && py <= p.y + 20 * k;
    if (hit) return { kind: 'hero', id: p.hero.id };
  }
  for (const [id, b] of Object.entries(BUILDINGS) as [Location, Building][]) {
    const box = buildingBox(b);
    if (px >= box.left && px <= box.right && py >= box.top && py <= box.bottom)
      return { kind: 'building', id };
  }
  // The signs over the Library's and the Forge's roofs belong to those buildings.
  for (const id of SIGN_BUILDINGS) {
    const signs = SIGNS[id];
    if (px >= signs.left && px <= signs.right && py >= signs.top && py <= signs.bottom)
      return { kind: 'building', id };
  }
  return null;
}

export interface VillageView {
  selected: Selection | null;
  hovered: Selection | null;
  /** The guild's clock in epoch seconds (demo: the frozen moment), for timed places. */
  clock?: number | undefined;
  /** Reviewed skills waiting on the user: a badge on the Library's door. */
  libraryWaiting?: number | undefined;
  /** Forged pieces waiting on the user: a badge on the Forge's door. */
  forgeWaiting?: number | undefined;
  /** Services open on local ports: a blue count on the Tower's door. */
  towerPortals?: number | undefined;
}

export function drawVillage(
  ctx: CanvasRenderingContext2D,
  state: GuildState,
  sprites: Sprites,
  nowMs: number,
  walkers: ReadonlyMap<string, Walker>,
  view: VillageView = { selected: null, hovered: null },
): void {
  ctx.imageSmoothingEnabled = false;

  // Grass: the plain interior tile of the flat tilemap, repeated.
  for (let y = 0; y < VILLAGE_HEIGHT; y += TILE) {
    for (let x = 0; x < VILLAGE_WIDTH; x += TILE) {
      ctx.drawImage(sprites.grass, TILE, TILE, TILE, TILE, x, y, TILE, TILE);
    }
  }

  drawBarracks(ctx, nowMs);
  drawThroneRoom(ctx);

  // Trees and buildings drawn back to front by their base, so nearer things overlap.
  const scenery: { y: number; draw: () => void }[] = [
    ...TREES.map(([x, y]) => ({
      y,
      draw: () => ctx.drawImage(sprites.tree, 0, 0, FRAME, FRAME, x - 48, y - 88, 96, 96),
    })),
    ...Object.values(BUILDINGS).map((b) => ({
      y: b.y,
      draw: () => {
        const img = sprites.buildings[b.file]!;
        const w = b.aspect * b.height;
        ctx.drawImage(img, b.x - w / 2, b.y - b.height, w, b.height);
        label(ctx, b.label, b.x, b.y + 4, 'rgba(20, 26, 18, 0.72)', '#f1efe6', 13);
      },
    })),
  ];
  scenery.sort((a, b) => a.y - b.y).forEach((s) => s.draw());

  for (const [id, b] of Object.entries(BUILDINGS) as [Location, Building][]) {
    const sel = { kind: 'building', id } as const;
    if (sameSelection(view.selected, sel)) outline(ctx, buildingBox(b), '#ffcc33', 3);
    else if (sameSelection(view.hovered, sel)) outline(ctx, buildingBox(b), 'rgba(241, 239, 230, 0.8)', 2);
  }

  const teams = heroTeams(state);
  const placed = placeHeroes(state, walkers, nowMs, view.clock);

  // The chain of command: gold lines from the King to each Knight he has given orders,
  // flowing towards the Knight while the guild is live.
  const king = placed.find((p) => p.hero.crowned);
  if (king) {
    ctx.save();
    ctx.strokeStyle = '#ffcc33';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(40, 28, 0, 0.8)';
    ctx.shadowBlur = 3;
    ctx.setLineDash([12, 8]);
    ctx.lineDashOffset = -nowMs / 40;
    for (const p of placed) {
      if (!p.hero.commanded || p.hero.parentId !== null || p.hero.crowned) continue;
      ctx.beginPath();
      ctx.moveTo(king.x, king.y - 20);
      ctx.lineTo(p.x, p.y - 20);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const p of placed.sort((a, b) => a.y - b.y)) {
    const sel = { kind: 'hero', id: p.hero.id } as const;
    const k = RANK_SCALE[rankOf(p.hero)];
    const team = teams.get(p.hero.id)!;
    const picked = sameSelection(view.selected, sel);
    const hovered = sameSelection(view.hovered, sel);
    if (p.asleep) {
      // Leaders get a bedroll with a blanket in their colour; their party sleeps beside it.
      if (rankOf(p.hero) === 'knight') bedroll(ctx, p.x, p.y, TEAM_CSS[team]);
      else teamDisc(ctx, p.x, p.y + 6 * k, k, TEAM_CSS[team]);
      if (picked || hovered)
        ring(ctx, p.x, p.y + 4, k * 1.3, picked ? '#ffcc33' : 'rgba(241, 239, 230, 0.85)');
      drawSleeper(ctx, sprites, p.hero, team, p.x, p.y, nowMs, picked || hovered);
      continue;
    }
    const rank = rankOf(p.hero);
    const fighting = isFighting(p.hero, p.moving) && !p.hearing;
    // A working Knight has its own training dummy, and it rocks back when a blow lands.
    if (fighting && rank === 'knight') {
      const frame = swingFrame(p.hero.id, nowMs);
      const tilt = frame === IMPACT_FRAME ? 0.28 : frame === IMPACT_FRAME + 1 ? 0.12 : 0;
      dummy(ctx, p.x + DUMMY_OFFSET.x, p.y + DUMMY_OFFSET.y, tilt);
    }
    teamDisc(ctx, p.x, p.y, k, TEAM_CSS[team]);
    if (picked) ring(ctx, p.x, p.y, k, '#ffcc33');
    else if (hovered) ring(ctx, p.x, p.y, k, 'rgba(241, 239, 230, 0.85)');
    // Fighters face their dummy, to the right.
    drawUnit(
      ctx,
      sprites,
      p.hero,
      team,
      p.x,
      p.y,
      nowMs,
      p.moving,
      p.left && !fighting,
      picked || hovered,
      fighting,
      p.hearing,
    );
  }

  drawSigns(ctx, 'library', librariansIn(state), nowMs, view.libraryWaiting ?? 0);
  drawSigns(ctx, 'forge', smithsIn(state), nowMs, view.forgeWaiting ?? 0);
  if (view.towerPortals) doorBadge(ctx, 'tower', view.towerPortals, true);
}

/** The buildings whose workers live inside, shown as signs over the roof. */
export const SIGN_BUILDINGS = ['library', 'forge'] as const;
export type SignBuilding = (typeof SIGN_BUILDINGS)[number];

const signArea = (id: SignBuilding) => {
  const b = BUILDINGS[id];
  return { left: b.x - 80, top: 0, right: b.x + 80, bottom: b.y - b.height };
};

/** Where each building's signs hang, above its roof. */
export const SIGNS: Record<SignBuilding, { left: number; top: number; right: number; bottom: number }> = {
  library: signArea('library'),
  forge: signArea('forge'),
};
export const LIBRARY_SIGNS = SIGNS.library;
const SIGN_SPACING = 62;

/** Where each worker's sign is drawn: centred over its building, side by side. */
export function signXs(id: SignBuilding, n: number): number[] {
  const shown = Math.min(n, 3);
  return Array.from({ length: shown }, (_, i) => BUILDINGS[id].x + (i - (shown - 1) / 2) * SIGN_SPACING);
}
export const librarySignXs = (n: number) => signXs('library', n);

const SIGN_STYLE: Record<SignBuilding, { work: 'work' | 'hammer'; bg: string }> = {
  library: { work: 'work', bg: 'rgba(58, 26, 80, 0.85)' },
  forge: { work: 'hammer', bg: 'rgba(90, 24, 20, 0.85)' },
};

/**
 * The librarians and the smiths work inside their buildings, so the building shows them:
 * over its roof, one sign per worker (an open book or a hammer while it works, "zzz" while
 * it rests, a red "!" when it needs you) with its name, and on the door a gold count of
 * what waits for the user (reviewed skills, forged pieces).
 */
function drawSigns(
  ctx: CanvasRenderingContext2D,
  id: SignBuilding,
  workers: Hero[],
  nowMs: number,
  waiting: number,
): void {
  const xs = signXs(id, workers.length);
  const roof = SIGNS[id].bottom;
  const style = SIGN_STYLE[id];
  xs.forEach((x, i) => {
    const hero = workers[i]!;
    const state = librarianState(hero);
    bubble(
      ctx,
      x,
      roof + 8,
      state === 'working' ? style.work : state === 'needs_you' ? 'alert' : 'sleep',
      1.1,
      nowMs,
    );
    label(ctx, hero.name, x, roof + 9, style.bg, state === 'needs_you' ? '#ffcc33' : '#f1efe6', 11);
  });
  if (waiting > 0) doorBadge(ctx, id, waiting);
}

/**
 * A count on a building's door: gold for what waits on the user (skills, pieces), blue for
 * the Tower's open portals.
 */
function doorBadge(ctx: CanvasRenderingContext2D, id: Location, count: number, blue = false): void {
  const b = BUILDINGS[id];
  const x = b.x + 30;
  const y = b.y - 40;
  ctx.save();
  ctx.fillStyle = blue ? '#78b4fa' : '#ffcc33';
  ctx.strokeStyle = blue ? '#14284a' : '#4a3200';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = blue ? '#0c1a30' : '#2a1c00';
  ctx.font = '800 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.min(count, 99)), x, y + 1);
  ctx.restore();
}

/** A hero asleep: its sprite laid on its side, head to the left, with "zzz" over it. */
function drawSleeper(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  hero: Hero,
  team: Team,
  x: number,
  y: number,
  nowMs: number,
  focused: boolean,
): void {
  const rank = rankOf(hero);
  const k = RANK_SCALE[rank];
  // Drawn smaller lying down than standing, so a Knight fits on its bedroll.
  const size = UNIT_SIZE * k * 0.78;
  const sheet =
    sprites.units[
      `${rank === 'worker' || rank === 'librarian' || rank === 'smith' ? 'Pawn' : 'Warrior'}_${team}`
    ]!;
  ctx.save();
  ctx.translate(x - 6 * k, y + 2 * k);
  ctx.rotate(-Math.PI / 2);
  // Idle frame 0, its body centred on the bed: the frame's middle sits a little above
  // the feet line, so it is offset to lie flat rather than float.
  ctx.drawImage(sheet, 0, 0, FRAME, FRAME, -size * 0.55, -size / 2, size, size);
  ctx.restore();
  if (rank === 'knight' || hero.status === 'needs_you') {
    const mark = bubbleFor(hero);
    if (mark) bubble(ctx, x - 22 * k, y - 16 * k, mark, k, nowMs);
  }
  if (rank === 'knight') {
    label(ctx, `${hero.name}  Lv ${hero.level}`, x, y + 16, 'rgba(20, 26, 18, 0.85)', '#f1efe6', 11);
  } else if (focused) {
    label(ctx, hero.name, x, y + 10, 'rgba(20, 26, 18, 0.85)', '#f1efe6', 10);
  }
}

/**
 * A training dummy: a post with a crossbar, a straw body with a red target and a sack
 * head. `tilt` rocks it back (radians) about its foot when a blow lands.
 */
function dummy(ctx: CanvasRenderingContext2D, x: number, y: number, tilt: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(tilt);
  ctx.strokeStyle = '#4a3016';
  ctx.lineWidth = 2;
  // Post and crossbar.
  ctx.fillStyle = '#7d5833';
  ctx.fillRect(-3, -44, 6, 44);
  ctx.strokeRect(-3, -44, 6, 44);
  ctx.fillRect(-17, -36, 34, 5);
  ctx.strokeRect(-17, -36, 34, 5);
  // Straw body with a target.
  ctx.fillStyle = '#d9b968';
  ctx.beginPath();
  ctx.ellipse(0, -26, 11, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.arc(0, -25, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f1efe6';
  ctx.beginPath();
  ctx.arc(0, -25, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.arc(0, -25, 1.3, 0, Math.PI * 2);
  ctx.fill();
  // Sack head.
  ctx.fillStyle = '#cdb07a';
  ctx.beginPath();
  ctx.arc(0, -48, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The Throne Room: a stone dais before the castle gate, where Knights hear their orders. */
export const THRONE_ROOM = { left: 450, top: 548, right: 830, bottom: 712 };

/**
 * The Throne Room floor: a stone dais with a red carpet running down from the castle gate
 * to a golden throne, banners at its front corners, and its name. The King stands before
 * the throne; ordered Knights stand on the dais either side of him.
 */
function drawThroneRoom(ctx: CanvasRenderingContext2D): void {
  const { left, top, right, bottom } = THRONE_ROOM;
  const cx = THRONE.x;
  ctx.save();
  // Stone floor with a darker edge and a grid of flagstones.
  ctx.fillStyle = '#a7a59a';
  ctx.strokeStyle = '#5f5d55';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(left, top, right - left, bottom - top, 10);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(80, 78, 70, 0.35)';
  ctx.lineWidth = 1;
  for (let x = left + 38; x < right; x += 38) {
    ctx.beginPath();
    ctx.moveTo(x, top + 3);
    ctx.lineTo(x, bottom - 3);
    ctx.stroke();
  }
  for (let y = top + 32; y < bottom; y += 32) {
    ctx.beginPath();
    ctx.moveTo(left + 3, y);
    ctx.lineTo(right - 3, y);
    ctx.stroke();
  }
  // Red carpet from the castle gate down the middle of the dais.
  ctx.fillStyle = '#a3262a';
  ctx.fillRect(cx - 22, BUILDINGS.guildhall.y - 8, 44, bottom - BUILDINGS.guildhall.y + 4);
  ctx.fillStyle = '#e0b030';
  ctx.fillRect(cx - 22, BUILDINGS.guildhall.y - 8, 3, bottom - BUILDINGS.guildhall.y + 4);
  ctx.fillRect(cx + 19, BUILDINGS.guildhall.y - 8, 3, bottom - BUILDINGS.guildhall.y + 4);
  // The throne, behind where the King stands.
  const ty = THRONE.y - 30;
  ctx.fillStyle = '#d9a520';
  ctx.strokeStyle = '#5a3d00';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cx - 26, ty - 58, 52, 62, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#b3242a';
  ctx.beginPath();
  ctx.roundRect(cx - 18, ty - 50, 36, 46, 4);
  ctx.fill();
  ctx.fillStyle = '#ffd75e';
  for (const dx of [-26, 0, 26]) {
    ctx.beginPath();
    ctx.arc(cx + dx, ty - 60, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Banners on poles at the front corners.
  for (const x of [left + 22, right - 22]) {
    ctx.fillStyle = '#5c4223';
    ctx.fillRect(x - 2, top - 62, 4, 74);
    ctx.fillStyle = '#b3242a';
    ctx.beginPath();
    ctx.moveTo(x + 2, top - 58);
    ctx.lineTo(x + 26, top - 58);
    ctx.lineTo(x + 26, top - 20);
    ctx.lineTo(x + 14, top - 28);
    ctx.lineTo(x + 2, top - 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(x + 14, top - 44, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  label(ctx, 'Throne Room', left + 70, bottom - 26, 'rgba(60, 44, 0, 0.85)', '#ffd75e', 13);
}

/** A bedroll: a straw mat, a pillow at the head and a blanket in the sleeper's colour. */
function bedroll(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const w = 76;
  const h = 26;
  ctx.save();
  ctx.fillStyle = '#b8935a';
  ctx.strokeStyle = '#5c4223';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#efe6cf';
  ctx.beginPath();
  ctx.roundRect(x - w / 2 + 4, y - h / 2 + 4, 16, h - 8, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.roundRect(x - w / 2 + 26, y - h / 2 + 2, w - 30, h - 4, 4);
  ctx.fill();
  ctx.restore();
}

/**
 * The Barracks camp: trodden ground, a fence with a gate towards the castle, and a
 * campfire whose flames flicker in live mode (and hold still in demo mode).
 */
function drawBarracks(ctx: CanvasRenderingContext2D, nowMs: number): void {
  const { left, top, right, bottom, fireX, fireY } = BARRACKS;
  ctx.save();
  ctx.fillStyle = 'rgba(146, 108, 64, 0.5)';
  ctx.beginPath();
  ctx.roundRect(left, top, right - left, bottom - top, 18);
  ctx.fill();

  // Fence: posts and two rails, open at the gate on the top edge.
  const gate = [300, 360];
  ctx.strokeStyle = '#6b4a2b';
  ctx.fillStyle = '#7d5833';
  ctx.lineWidth = 3;
  const rail = (x1: number, y1: number, x2: number, y2: number) => {
    for (const dy of [-10, -4]) {
      ctx.beginPath();
      ctx.moveTo(x1, y1 + dy);
      ctx.lineTo(x2, y2 + dy);
      ctx.stroke();
    }
  };
  rail(left, top, gate[0]!, top);
  rail(gate[1]!, top, right, top);
  rail(left, bottom, right, bottom);
  ctx.lineWidth = 3;
  for (const x of [left, right]) {
    ctx.beginPath();
    ctx.moveTo(x, top - 10);
    ctx.lineTo(x, bottom - 4);
    ctx.stroke();
  }
  const post = (x: number, y: number) => ctx.fillRect(x - 3, y - 16, 6, 18);
  for (let x = left; x <= right; x += 40) {
    if (x < gate[0]! || x > gate[1]!) post(x, top);
    post(x, bottom);
  }
  for (let y = top + 40; y < bottom; y += 40) {
    post(left, y);
    post(right, y);
  }

  // The campfire: crossed logs, a ring of stones and flickering flames.
  ctx.fillStyle = '#8a8a80';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(fireX + Math.cos(a) * 16, fireY + Math.sin(a) * 7, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#5c3a1c';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(fireX - 12, fireY + 4);
  ctx.lineTo(fireX + 12, fireY - 4);
  ctx.moveTo(fireX - 12, fireY - 4);
  ctx.lineTo(fireX + 12, fireY + 4);
  ctx.stroke();
  const flicker = (phase: number) => 1 + Math.sin(nowMs / 90 + phase) * 0.15;
  const flame = (color: string, w: number, h: number, phase: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(fireX, fireY - (h * flicker(phase)) / 2, w, (h * flicker(phase)) / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  flame('rgba(226, 88, 34, 0.9)', 10, 26, 0);
  flame('rgba(255, 170, 51, 0.95)', 7, 18, 1.7);
  flame('rgba(255, 236, 140, 0.95)', 4, 10, 3.1);
  ctx.restore();
  label(ctx, 'Barracks', left + 62, top + 8, 'rgba(20, 26, 18, 0.72)', '#f1efe6', 13);
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  hero: Hero,
  team: Team,
  x: number,
  y: number,
  nowMs: number,
  moving: boolean,
  facingLeft: boolean,
  /** Show a follower's name tag; leaders always show theirs. */
  focused: boolean,
  /** Swinging at a dummy (or drilling) rather than standing. */
  fighting: boolean,
  /** Before the throne hearing an order: awake, whatever its status says. */
  hearing = false,
): void {
  const rank = rankOf(hero);
  const k = RANK_SCALE[rank];
  const size = UNIT_SIZE * k;
  const sheet =
    sprites.units[
      `${rank === 'worker' || rank === 'librarian' || rank === 'smith' ? 'Pawn' : 'Warrior'}_${team}`
    ]!;
  // Row 0 is idle, row 1 is the walk cycle; six frames each. Resting heroes hold a
  // single pose so the busy ones stand out.
  // Rows: 0 idle, 1 walk, 2 the attack (a sword swing for warriors, a hammer for pawns).
  const row = moving ? 1 : fighting ? 2 : 0;
  const frame = fighting
    ? swingFrame(hero.id, nowMs)
    : hero.status === 'idle' && !moving
      ? 0
      : Math.floor(nowMs / FRAME_MS) % 6;
  const dx = x - size / 2;
  const dy = y - size * FEET;

  ctx.save();
  if (hero.status === 'idle') ctx.globalAlpha = 0.8;
  if (facingLeft) {
    ctx.translate(x * 2, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(sheet, frame * FRAME, row * FRAME, FRAME, FRAME, dx, dy, size, size);
  ctx.restore();

  if (rank === 'king') crown(ctx, x, y - 56 * k);
  if (rank === 'librarian') book(ctx, x, y - 50 * k);
  // Beside the head rather than above it, where it would cover the building name.
  const mark = bubbleFor(hero);
  if (mark && !(hearing && mark === 'sleep')) bubble(ctx, x + 30 * k, y - 30 * k, mark, k, nowMs);

  const fg = hero.status === 'needs_you' ? '#ffcc33' : '#f1efe6';
  if (rank === 'king' || rank === 'knight' || rank === 'librarian') {
    const king = rank === 'king';
    label(
      ctx,
      `${hero.name}  Lv ${hero.level}`,
      x,
      y + (king ? 8 : 6),
      king ? 'rgba(60, 44, 0, 0.9)' : 'rgba(20, 26, 18, 0.85)',
      king ? '#ffd75e' : fg,
      king ? 12 : 11,
    );
    // What a leader is working on, under its name, so the Knight for a job is easy to find.
    const quest = currentQuest(hero);
    if (quest)
      label(ctx, shorten(quest, 28), x, y + (king ? 28 : 25), 'rgba(20, 26, 18, 0.62)', '#e4dfcc', 10);
  } else if (focused || hero.status === 'needs_you') {
    // A party of six name tags would bury the map, so a follower shows its tag only when
    // pointed at or waiting on the user; the roster lists every one.
    label(ctx, hero.name, x, y + 2, 'rgba(20, 26, 18, 0.85)', fg, 10);
  }
}

/** Cut text to `max` characters at a word where possible, with an ellipsis. */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A disc of team colour on the ground, so a party reads as one at a glance. */
function teamDisc(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, color: string): void {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y - 2, 20 * k, 7 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** An open book: over a librarian's head, or on its sign while it works (`lift` flips a page). */
function book(ctx: CanvasRenderingContext2D, x: number, y: number, lift = 0): void {
  ctx.save();
  ctx.strokeStyle = '#3a2410';
  ctx.lineWidth = 1.5;
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#f4ecd2';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + side * 13, y - 3);
    ctx.lineTo(x + side * 13, y - 15);
    ctx.lineTo(x, y - 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(58, 36, 16, 0.5)';
    for (const dy of [-6, -9]) {
      ctx.beginPath();
      ctx.moveTo(x + side * 3, y + dy);
      ctx.lineTo(x + side * 10, y + dy - 2);
      ctx.stroke();
    }
    ctx.strokeStyle = '#3a2410';
  }
  ctx.fillStyle = '#7b3fa0';
  ctx.fillRect(x - 1.5, y - 13, 3, 14);
  if (lift) {
    ctx.fillStyle = '#fffaf0';
    ctx.strokeStyle = '#3a2410';
    ctx.beginPath();
    ctx.moveTo(x, y - 1);
    ctx.lineTo(x + 8, y - 6 - Math.abs(lift) * 2);
    ctx.lineTo(x + 8, y - 16 - Math.abs(lift) * 2);
    ctx.lineTo(x, y - 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A gold crown floating over the King's head. */
function crown(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const w = 26;
  const h = 15;
  ctx.fillStyle = '#ffcc33';
  ctx.strokeStyle = '#5a3d00';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x - w / 2, y - h);
  ctx.lineTo(x - w / 4, y - h / 2);
  ctx.lineTo(x, y - h - 3);
  ctx.lineTo(x + w / 4, y - h / 2);
  ctx.lineTo(x + w / 2, y - h);
  ctx.lineTo(x + w / 2, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d9453b';
  ctx.beginPath();
  ctx.arc(x, y - 5, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

/** A ground ring under a hero's feet: selected or hovered. */
function ring(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y - 2, 26 * k, 10 * k, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function outline(
  ctx: CanvasRenderingContext2D,
  box: { left: number; right: number; top: number; bottom: number },
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.roundRect(box.left - 6, box.top - 6, box.right - box.left + 12, box.bottom - box.top + 10, 10);
  ctx.stroke();
}

/**
 * The bubble over a hero: a red "!" when it is waiting on the user (a question or a
 * decision), "zzz" when it has finished its turn and is resting. Working heroes get none.
 */
export function bubbleFor(hero: Hero): 'alert' | 'sleep' | null {
  if (hero.status === 'needs_you') return 'alert';
  if (hero.status === 'idle') return 'sleep';
  return null;
}

export function bubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  kind: 'alert' | 'sleep' | 'work' | 'hammer',
  k: number,
  nowMs: number,
): void {
  const s = Math.max(0.75, k);
  const w = (kind === 'alert' ? 26 : kind === 'work' || kind === 'hammer' ? 38 : 34) * s;
  const h = 26 * s;
  // A sleeper's bubble bobs gently; demo mode's clock is frozen, so it holds still there.
  const bob = kind === 'sleep' ? Math.sin(nowMs / 600) * 2 : 0;
  const bx = x - w / 2;
  const by = top - h - 8 * s + bob;
  ctx.save();
  ctx.fillStyle =
    kind === 'alert'
      ? '#d93a3a'
      : kind === 'work'
        ? '#e6d6f4'
        : kind === 'hammer'
          ? '#ffe2aa'
          : 'rgba(236, 240, 250, 0.92)';
  ctx.strokeStyle =
    kind === 'alert' ? '#4a0b0b' : kind === 'work' ? '#4b2466' : kind === 'hammer' ? '#783c14' : '#3a4256';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 7 * s);
  ctx.moveTo(x - 5 * s, by + h);
  ctx.lineTo(x - 2 * s, by + h + 7 * s);
  ctx.lineTo(x + 3 * s, by + h);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (kind === 'hammer') {
    // A hammer, rising and falling as the smith strikes.
    const lift = Math.abs(Math.sin(nowMs / 160)) * 3 * s;
    ctx.fillStyle = '#866353';
    ctx.fillRect(x - 2 * s, by + 9 * s - lift, 4 * s, 13 * s);
    ctx.fillStyle = '#4e546c';
    ctx.fillRect(x - 9 * s, by + 5 * s - lift, 18 * s, 7 * s);
    ctx.fillStyle = '#7a84a0';
    ctx.fillRect(x - 9 * s, by + 5 * s - lift, 18 * s, 2 * s);
  } else if (kind === 'work') {
    // An open book, its pages lifting as the librarian reads.
    book(ctx, x, by + h / 2 + 7 * s, Math.sin(nowMs / 180) * 2);
  } else if (kind === 'alert') {
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.round(18 * s)}px system-ui, sans-serif`;
    ctx.fillText('!', x, by + h / 2 + 1);
  } else {
    // Three z's, each a little bigger and higher, the way sleep is drawn in comics.
    ctx.fillStyle = '#3a4256';
    [
      [-9, 4, 9],
      [0, 1, 11],
      [9, -3, 13],
    ].forEach(([dx, dy, size]) => {
      ctx.font = `800 ${Math.round(size! * s)}px system-ui, sans-serif`;
      ctx.fillText('z', x + dx! * s, by + h / 2 + dy! * s);
    });
  }
  ctx.restore();
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  top: number,
  bg: string,
  fg: string,
  size: number,
): void {
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 12;
  const h = size + 8;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, top, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, top + h / 2 + 0.5);
  ctx.textAlign = 'start';
}
