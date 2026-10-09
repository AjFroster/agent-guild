import type { Banner, GuildState } from '@agent-guild/core';

import type { WarInfo } from './api.ts';

import { type Art, type Rect, grass, highlight, inside, plate, put, terrain } from './scene.ts';
import { type Sprites, TEAMS, type Team } from './village.ts';

/**
 * One war's battlefield (docs/WARS.md): every Knight working in the war stands in a duel
 * with an enemy, a unit from the Tiny Swords pack in a rival colour, with a bug's name.
 * The enemy is random but seeded by the Knight's session, so a Knight meets the same foe
 * every time the page opens. Knights at work swing; resting ones hold their ground, and the
 * enemy waits with them.
 *
 * `fieldModel`, `enemyFor` and `fieldPick` are pure, so tests check the duels and what a
 * click lands on without a canvas.
 */

export interface FieldKnight {
  id: string;
  name: string;
  /** Working (or waiting on the user) right now. */
  active: boolean;
  needsYou: boolean;
  /** The battle (branch) it fights, when the War Room knows it. */
  battle: string | null;
}

export interface Enemy {
  name: string;
  unit: 'Warrior' | 'Pawn';
  team: Team;
}

export interface Duel {
  knight: FieldKnight;
  enemy: Enemy;
  /** Where the pair stands: the Knight's feet; the enemy stands to its right. */
  x: number;
  y: number;
}

export interface FieldModel {
  banner: Banner;
  duels: Duel[];
  /** Knights past what fits on the field. */
  more: number;
  /** The units' sheets, recoloured; the page waits for them before drawing the field. */
  sprites: Sprites;
}

/** The Knights fighting in a war, from the guild's own state: the ones still here. */
export function fieldKnights(state: GuildState, war: WarInfo): FieldKnight[] {
  const out: FieldKnight[] = [];
  for (const id of war.knights) {
    const hero = state.heroes[id];
    if (!hero || hero.status === 'gone') continue;
    const battle = war.battles.find((b) => b.knights.some((k) => k.id === id));
    out.push({
      id,
      name: hero.name,
      active: hero.status === 'working' || hero.status === 'needs_you',
      needsYou: hero.status === 'needs_you',
      battle: battle?.branch ?? hero.branch ?? null,
    });
  }
  return out;
}

export type FieldPick = { kind: 'knight'; id: string };

const FOES = [
  'Merge Conflict',
  'Flaky Test',
  'Null Pointer',
  'Race Condition',
  'Memory Leak',
  'Off-by-One',
  'Type Error',
  'Stale Cache',
  'Deadlock',
  'Regression',
  'Scope Creep',
  'Heisenbug',
  'Segfault',
  'Timeout',
  'Dependency Hell',
  'Lint Goblin',
] as const;

const TITLES = [
  'the Unyielding',
  'the Sly',
  'of the Deep Stack',
  'the Recurring',
  'the Undocumented',
  'the Nameless',
  'of Friday Deploys',
  'the Intermittent',
  'the Ancient',
  'of the Legacy Code',
] as const;

/** A small, stable hash: the same session always draws the same enemy. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32: a seeded random number generator, [0, 1). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The enemy a Knight faces: never in its own war's colour, nor the King's gold. */
export function enemyFor(knightId: string, banner: Banner): Enemy {
  const next = rng(seedOf(knightId));
  const pickFrom = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  const teams = TEAMS.filter((t) => t !== banner && t !== 'Gold');
  return {
    name: `${pickFrom(FOES)} ${pickFrom(TITLES)}`,
    unit: next() < 0.8 ? 'Warrior' : 'Pawn',
    team: pickFrom(teams),
  };
}

const MAX_DUELS = 6;
const ENEMY_DX = 150;

/** Where n duels stand (n at most six): one column for a lone duel, else two, rows centred. */
export function duelSlots(n: number): [number, number][] {
  const count = Math.min(n, MAX_DUELS);
  const cols = count <= 1 ? 1 : 2;
  const rows = Math.ceil(count / cols);
  const xs = cols === 1 ? [560 - ENEMY_DX / 2] : [250, 700];
  const ys = rows === 1 ? [500] : rows === 2 ? [410, 600] : [320, 480, 640];
  return Array.from({ length: count }, (_, i) => [xs[i % cols]!, ys[Math.floor(i / cols)]!]);
}

export function fieldModel(banner: Banner, knights: readonly FieldKnight[], sprites: Sprites): FieldModel {
  // Working Knights first, so the fights in progress are the ones that fit.
  const order = [...knights].sort((a, b) => Number(b.active) - Number(a.active));
  const slots = duelSlots(order.length);
  const duels = slots.map(([x, y], i) => ({
    knight: order[i]!,
    enemy: enemyFor(order[i]!.id, banner),
    x,
    y,
  }));
  return { banner, duels, more: Math.max(0, knights.length - MAX_DUELS), sprites };
}

/** Where a Knight can be clicked: its body and its name plate. */
export const knightRect = (d: Duel): Rect => ({ x: d.x - 45, y: d.y - 100, w: 90, h: 130 });

export function fieldPick(model: FieldModel, px: number, py: number): FieldPick | null {
  for (const d of model.duels) if (inside(knightRect(d), px, py)) return { kind: 'knight', id: d.knight.id };
  return null;
}

export const sameFieldPick = (a: FieldPick | null, b: FieldPick | null) => a?.id === b?.id;

export function describeField(model: FieldModel): string {
  if (model.duels.length === 0) return 'The battlefield is quiet: no Knight is fighting in this war.';
  const duels = model.duels.map(
    (d) => `${d.knight.name} ${d.knight.active ? 'fights' : 'faces'} ${d.enemy.name}`,
  );
  return `The battlefield: ${duels.join('; ')}${model.more ? `; and ${model.more} more` : ''}.`;
}

// ------------------------------------------------------------------ drawing

const FRAME = 192;
const FEET = 0.7;
const SIZE = 170;

/** One unit: row 0 idle, row 2 the attack; frames offset so the two never swing in step. */
function unit(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  x: number,
  y: number,
  { attacking, flip, nowMs, offset }: { attacking: boolean; flip: boolean; nowMs: number; offset: number },
): void {
  const row = attacking ? 2 : 0;
  const frame = Math.floor((nowMs + offset) / 120) % 6;
  ctx.save();
  if (flip) {
    ctx.translate(x * 2, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(sheet, frame * FRAME, row * FRAME, FRAME, FRAME, x - SIZE / 2, y - SIZE * FEET, SIZE, SIZE);
  ctx.restore();
}

/** A red tag under the enemy, so it reads as the foe. */
function foePlate(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number): void {
  ctx.save();
  ctx.font = '700 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(48, 12, 10, 0.9)';
  ctx.strokeStyle = '#e0604f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, y, w, 22, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffe2dc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y + 11.5);
  ctx.restore();
}

/** Crossed swords between a working pair; "zz" over a resting Knight; "!" when it needs you. */
function mark(ctx: CanvasRenderingContext2D, d: Duel, nowMs: number): void {
  const mx = d.x + ENEMY_DX / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (d.knight.needsYou) {
    ctx.fillStyle = '#e04434';
    ctx.strokeStyle = '#3a0c08';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(d.x + 26, d.y - 96, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 16px system-ui, sans-serif';
    ctx.fillText('!', d.x + 26, d.y - 95);
  } else if (d.knight.active) {
    const bob = Math.sin(nowMs / 140) * 3;
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillStyle = '#fff4d0';
    ctx.fillText('⚔', mx, d.y - 92 + bob);
  } else {
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText('z z', d.x + 24, d.y - 92);
  }
  ctx.restore();
}

export function drawField(
  ctx: CanvasRenderingContext2D,
  art: Art,
  model: FieldModel,
  nowMs: number,
  hovered: FieldPick | null = null,
): void {
  ctx.imageSmoothingEnabled = false;
  grass(ctx, art);
  // The field of battle: a sand clearing ringed by trees, the war's camp at the back.
  terrain(ctx, art.grass, { col: 5, row: 0 }, 64, 192, 16, 8);
  const tree = { x: 0, y: 0, w: 192, h: 192 };
  for (const [x, y] of [
    [60, 170],
    [1060, 170],
    [40, 700],
    [1080, 700],
    [330, 150],
    [800, 150],
  ] as const)
    put(ctx, art.tree, x, y, { crop: tree });
  put(ctx, art.bushBig, 560, 170);
  put(ctx, art.rock, 1000, 420);
  put(ctx, art.rock, 110, 520);

  if (model.duels.length === 0) {
    plate(ctx, 'No Knight on the field. Send one into a battle below.', 560, 420);
    return;
  }
  for (const d of model.duels) {
    const { units } = model.sprites;
    const knight = units[`Warrior_${model.banner}`];
    const foe = units[`${d.enemy.unit}_${d.enemy.team}`];
    const fighting = d.knight.active && !d.knight.needsYou;
    // Shadows under both.
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    for (const sx of [d.x, d.x + ENEMY_DX]) {
      ctx.beginPath();
      ctx.ellipse(sx, d.y + 4, 34, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    const offset = seedOf(d.knight.id) % 720;
    if (knight) unit(ctx, knight, d.x, d.y, { attacking: fighting, flip: false, nowMs, offset });
    if (foe)
      unit(ctx, foe, d.x + ENEMY_DX, d.y, { attacking: fighting, flip: true, nowMs, offset: offset + 360 });
    mark(ctx, d, nowMs);
    if (hovered?.id === d.knight.id) highlight(ctx, knightRect(d));
    plate(ctx, d.knight.name.length > 22 ? `${d.knight.name.slice(0, 21)}…` : d.knight.name, d.x, d.y + 10);
    foePlate(ctx, d.enemy.name, d.x + ENEMY_DX, d.y + 34);
  }
  if (model.more > 0) plate(ctx, `+${model.more} more Knights in this war`, 560, 690);
}
