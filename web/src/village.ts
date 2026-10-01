import type { GuildState, Hero, Location } from '@agent-guild/core';
import { roster } from '@agent-guild/core';

/**
 * Canvas drawing for the village, using the Tiny Swords pack (Pixel Frog, CC0) and
 * Agent Quest's building art (MIT). See web/public/assets/tiny-swords/CREDITS.md.
 *
 * Drawing is a function of (state, sprites, clock, walkers). Demo mode passes a frozen
 * clock and no walkers, so a given URL renders the same frame every time.
 */

export const VILLAGE_WIDTH = 880;
export const VILLAGE_HEIGHT = 560;

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
  /** Bottom-centre of the building on the canvas. */
  x: number;
  y: number;
  height: number;
}

export const BUILDINGS: Record<Location, Building> = {
  library: { label: 'Library', file: 'Library', x: 130, y: 200, height: 165 },
  forge: { label: 'Forge', file: 'Forge', x: 440, y: 200, height: 175 },
  arena: { label: 'Arena', file: 'Arena', x: 750, y: 200, height: 165 },
  tower: { label: 'Tower', file: 'Tower', x: 150, y: 435, height: 170 },
  guildhall: { label: 'Guildhall', file: 'Castle', x: 560, y: 435, height: 145 },
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

const COLORS = ['Blue', 'Red', 'Yellow', 'Purple'] as const;

export interface Sprites {
  grass: HTMLImageElement;
  tree: HTMLImageElement;
  buildings: Record<string, HTMLImageElement>;
  units: Record<string, HTMLImageElement>;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

export async function loadSprites(): Promise<Sprites> {
  const unitNames = COLORS.flatMap((c) => [`Warrior_${c}`, `Pawn_${c}`]);
  const buildingFiles = [...new Set(Object.values(BUILDINGS).map((b) => b.file))];
  const [grass, tree, buildingImgs, unitImgs] = await Promise.all([
    loadImage(`${ASSET}/terrain/Tilemap_Flat.png`),
    loadImage(`${ASSET}/deco/Tree.png`),
    Promise.all(buildingFiles.map((f) => loadImage(`${ASSET}/buildings/${f}.png`))),
    Promise.all(unitNames.map((u) => loadImage(`${ASSET}/units/${u}.png`))),
  ]);
  return {
    grass,
    tree,
    buildings: Object.fromEntries(buildingFiles.map((f, i) => [f, buildingImgs[i]!])),
    units: Object.fromEntries(unitNames.map((u, i) => [u, unitImgs[i]!])),
  };
}

/** Where each hero stands: a row in front of its building's door, in roster order. */
export function heroPositions(state: GuildState): Map<string, { x: number; y: number }> {
  const byBuilding = new Map<Location, Hero[]>();
  for (const hero of roster(state)) {
    byBuilding.set(hero.location, [...(byBuilding.get(hero.location) ?? []), hero]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [location, heroes] of byBuilding) {
    const b = BUILDINGS[location];
    const perRow = 4;
    heroes.forEach((hero, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, heroes.length - row * perRow);
      const col = i % perRow;
      positions.set(hero.id, {
        x: b.x + (col - (inRow - 1) / 2) * 66,
        y: b.y + 88 + row * 50,
      });
    });
  }
  return positions;
}

/** Team colour: each leader gets the next colour, and its party wears the same one. */
export function heroColors(state: GuildState): Map<string, (typeof COLORS)[number]> {
  const colors = new Map<string, (typeof COLORS)[number]>();
  let next = 0;
  for (const hero of roster(state)) {
    const parentColor = hero.parentId ? colors.get(hero.parentId) : undefined;
    colors.set(hero.id, parentColor ?? COLORS[next++ % COLORS.length]!);
  }
  return colors;
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

export function drawVillage(
  ctx: CanvasRenderingContext2D,
  state: GuildState,
  sprites: Sprites,
  nowMs: number,
  walkers: ReadonlyMap<string, Walker>,
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
        const w = (img.width / img.height) * b.height;
        ctx.drawImage(img, b.x - w / 2, b.y - b.height, w, b.height);
        label(ctx, b.label, b.x, b.y + 4, 'rgba(20, 26, 18, 0.72)', '#f1efe6', 13);
      },
    })),
  ];
  scenery.sort((a, b) => a.y - b.y).forEach((s) => s.draw());

  const targets = heroPositions(state);
  const colors = heroColors(state);
  const heroes = roster(state);

  const placed = heroes.map((hero) => {
    const target = targets.get(hero.id)!;
    const walker = walkers.get(hero.id);
    const pos = walker ? walkerPosition(walker, nowMs) : { ...target, moving: false, left: false };
    return { hero, ...pos };
  });

  // Party lines under the units.
  ctx.strokeStyle = 'rgba(241, 239, 230, 0.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  for (const p of placed) {
    const leader = placed.find((q) => q.hero.id === p.hero.parentId);
    if (!leader) continue;
    ctx.beginPath();
    ctx.moveTo(leader.x, leader.y - 4);
    ctx.lineTo(p.x, p.y - 4);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const p of placed.sort((a, b) => a.y - b.y)) {
    drawUnit(ctx, sprites, p.hero, colors.get(p.hero.id)!, p.x, p.y, nowMs, p.moving, p.left);
  }
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  hero: Hero,
  color: string,
  x: number,
  y: number,
  nowMs: number,
  moving: boolean,
  facingLeft: boolean,
): void {
  const sheet = sprites.units[`${hero.parentId ? 'Pawn' : 'Warrior'}_${color}`]!;
  // Row 0 is idle, row 1 is the walk cycle; six frames each. Resting heroes hold a
  // single pose so the busy ones stand out.
  const row = moving ? 1 : 0;
  const frame = hero.status === 'idle' && !moving ? 0 : Math.floor(nowMs / FRAME_MS) % 6;
  const dx = x - UNIT_SIZE / 2;
  const dy = y - UNIT_SIZE * FEET;

  ctx.save();
  if (hero.status === 'idle') ctx.globalAlpha = 0.8;
  if (facingLeft) {
    ctx.translate(x * 2, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(sheet, frame * FRAME, row * FRAME, FRAME, FRAME, dx, dy, UNIT_SIZE, UNIT_SIZE);
  ctx.restore();

  // Beside the head rather than above it, where it would cover the building name.
  if (hero.status === 'needs_you') bubble(ctx, x + 30, y - 30);

  const name = `${hero.name}  Lv ${hero.level}`;
  label(
    ctx,
    name,
    x,
    y + 6,
    'rgba(20, 26, 18, 0.85)',
    hero.status === 'needs_you' ? '#ffcc33' : '#f1efe6',
    11,
  );
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
