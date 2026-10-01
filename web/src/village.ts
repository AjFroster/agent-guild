import type { GuildState, Hero, Location, Rank } from '@agent-guild/core';
import { rankOf, roster } from '@agent-guild/core';

/**
 * Canvas drawing for the village, using the Tiny Swords pack (Pixel Frog, CC0) and
 * Agent Quest's building art (MIT). See web/public/assets/tiny-swords/CREDITS.md.
 *
 * Drawing is a function of (state, sprites, clock, walkers). Demo mode passes a frozen
 * clock and no walkers, so a given URL renders the same frame every time.
 */

export const VILLAGE_WIDTH = 880;
export const VILLAGE_HEIGHT = 640;

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

export const BUILDINGS: Record<Location, Building> = {
  library: { label: 'Library', file: 'Library', aspect: 210 / 420, x: 130, y: 200, height: 165 },
  forge: { label: 'Forge', file: 'Forge', aspect: 307 / 460, x: 440, y: 200, height: 175 },
  arena: { label: 'Arena', file: 'Arena', aspect: 320 / 429, x: 750, y: 200, height: 165 },
  tower: { label: 'Tower', file: 'Tower', aspect: 195 / 390, x: 150, y: 435, height: 170 },
  guildhall: { label: 'Guildhall', file: 'Castle', aspect: 400 / 270, x: 560, y: 435, height: 145 },
};

/** Fixed, hand-placed trees: decoration that never moves between frames or runs. */
const TREES: readonly [number, number][] = [
  [30, 90],
  [280, 70],
  [600, 60],
  [860, 110],
  [300, 330],
  [860, 330],
  [30, 330],
  [330, 555],
  [790, 555],
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
export const RANK_SCALE: Record<Rank, number> = { king: 1.3, knight: 1, footsoldier: 0.76, worker: 0.66 };

export const RANK_LABEL: Record<Rank, string> = {
  king: 'King',
  knight: 'Knight',
  footsoldier: 'Footsoldier',
  worker: 'Worker',
};

export interface Sprites {
  grass: HTMLImageElement;
  tree: HTMLImageElement;
  buildings: Record<string, HTMLImageElement>;
  /** `Warrior_<Team>` and `Pawn_<Team>` for every team. */
  units: Record<string, CanvasImageSource>;
}

function loadImage(src: string): Promise<HTMLImageElement> {
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
  [40, -16],
  [-22, -38],
  [22, -38],
  [-62, -36],
  [62, -36],
  [0, -58],
  [-44, -60],
  [44, -60],
];

/**
 * Where each hero stands. Leaders (the King and Knights) form a row in front of the
 * building their latest tool sent them to; followers stand in formation behind their
 * leader wherever it goes, so a party moves as one.
 */
export function heroPositions(state: GuildState): Map<string, { x: number; y: number }> {
  const heroes = roster(state);
  const present = new Set(heroes.map((h) => h.id));
  const leads = (h: Hero) => h.parentId === null || !present.has(h.parentId);

  const byBuilding = new Map<Location, Hero[]>();
  for (const hero of heroes.filter(leads)) {
    byBuilding.set(hero.location, [...(byBuilding.get(hero.location) ?? []), hero]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [location, group] of byBuilding) {
    const b = BUILDINGS[location];
    // Three abreast, wide enough apart for a party to stand behind each.
    const perRow = 3;
    group.forEach((hero, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, group.length - row * perRow);
      const col = i % perRow;
      positions.set(hero.id, {
        x: b.x + (col - (inRow - 1) / 2) * 124,
        y: b.y + 88 + row * 64,
      });
    });
  }

  // Roster order is depth-first, so a follower's leader is always placed before it.
  const placedUnder = new Map<string, number>();
  for (const hero of heroes) {
    if (leads(hero)) continue;
    const parent = state.heroes[hero.parentId!]!;
    const at = positions.get(parent.id)!;
    const n = placedUnder.get(parent.id) ?? 0;
    placedUnder.set(parent.id, n + 1);
    const [dx, dy] = FORMATION[n % FORMATION.length]!;
    const wrap = Math.floor(n / FORMATION.length) * 22;
    const k = leads(parent) ? 1 : 0.65;
    positions.set(hero.id, { x: at.x + dx * k, y: at.y + (dy - wrap) * k });
  }
  return positions;
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
}

/** Where every hero is drawn right now: at its slot, or part way along a walk. */
export function placeHeroes(
  state: GuildState,
  walkers: ReadonlyMap<string, Walker>,
  nowMs: number,
): Placed[] {
  const targets = heroPositions(state);
  return roster(state).map((hero) => {
    const target = targets.get(hero.id)!;
    const walker = walkers.get(hero.id);
    const pos = walker ? walkerPosition(walker, nowMs) : { ...target, moving: false, left: false };
    return { hero, ...pos };
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
): Selection | null {
  const placed = placeHeroes(state, walkers, nowMs).sort((a, b) => b.y - a.y);
  for (const p of placed) {
    const k = RANK_SCALE[rankOf(p.hero)];
    if (Math.abs(px - p.x) <= 26 * k && py >= p.y - 62 * k && py <= p.y + 20 * k) {
      return { kind: 'hero', id: p.hero.id };
    }
  }
  for (const [id, b] of Object.entries(BUILDINGS) as [Location, Building][]) {
    const box = buildingBox(b);
    if (px >= box.left && px <= box.right && py >= box.top && py <= box.bottom)
      return { kind: 'building', id };
  }
  return null;
}

export interface VillageView {
  selected: Selection | null;
  hovered: Selection | null;
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
  const placed = placeHeroes(state, walkers, nowMs);

  for (const p of placed.sort((a, b) => a.y - b.y)) {
    const sel = { kind: 'hero', id: p.hero.id } as const;
    const k = RANK_SCALE[rankOf(p.hero)];
    const team = teams.get(p.hero.id)!;
    const picked = sameSelection(view.selected, sel);
    const hovered = sameSelection(view.hovered, sel);
    teamDisc(ctx, p.x, p.y, k, TEAM_CSS[team]);
    if (picked) ring(ctx, p.x, p.y, k, '#ffcc33');
    else if (hovered) ring(ctx, p.x, p.y, k, 'rgba(241, 239, 230, 0.85)');
    drawUnit(ctx, sprites, p.hero, team, p.x, p.y, nowMs, p.moving, p.left, picked || hovered);
  }
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
): void {
  const rank = rankOf(hero);
  const k = RANK_SCALE[rank];
  const size = UNIT_SIZE * k;
  const sheet = sprites.units[`${rank === 'worker' ? 'Pawn' : 'Warrior'}_${team}`]!;
  // Row 0 is idle, row 1 is the walk cycle; six frames each. Resting heroes hold a
  // single pose so the busy ones stand out.
  const row = moving ? 1 : 0;
  const frame = hero.status === 'idle' && !moving ? 0 : Math.floor(nowMs / FRAME_MS) % 6;
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
  // Beside the head rather than above it, where it would cover the building name.
  if (hero.status === 'needs_you') bubble(ctx, x + 30 * k, y - 30 * k);

  const fg = hero.status === 'needs_you' ? '#ffcc33' : '#f1efe6';
  if (rank === 'king')
    label(ctx, `${hero.name}  Lv ${hero.level}`, x, y + 8, 'rgba(60, 44, 0, 0.9)', '#ffd75e', 12);
  else if (rank === 'knight')
    label(ctx, `${hero.name}  Lv ${hero.level}`, x, y + 6, 'rgba(20, 26, 18, 0.85)', fg, 11);
  // A party of six name tags would bury the map, so a follower shows its tag only when
  // pointed at; the roster lists every one.
  else if (focused || hero.status === 'needs_you')
    label(ctx, hero.name, x, y + 2, 'rgba(20, 26, 18, 0.85)', fg, 10);
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

/** A "!" speech bubble over a hero that is waiting on the user. */
function bubble(ctx: CanvasRenderingContext2D, x: number, top: number): void {
  const w = 26;
  const h = 26;
  const bx = x - w / 2;
  const by = top - h - 8;
  ctx.fillStyle = '#ffcc33';
  ctx.strokeStyle = '#2b2000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 6);
  ctx.moveTo(x - 5, by + h);
  ctx.lineTo(x, by + h + 7);
  ctx.lineTo(x + 5, by + h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2b2000';
  ctx.font = '800 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', x, by + h / 2 + 1);
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
