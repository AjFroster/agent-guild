import type { Banner, GuildState, Hero } from '@agent-guild/core';

import type { WarInfo } from './api.ts';
import { type Art, type Rect, highlight, plate, put } from './scene.ts';
import { type Sprites, loadImage } from './village.ts';

/**
 * A Knight's duel with a goblin (docs/WARS.md), drawn on the War Camp and on each war's
 * battlefield: every Knight working in a war swings at a goblin from the Tiny Swords pack,
 * the way Knights on the map drill at their training dummies. The goblin has a bug's name,
 * and its health is the Knight's quests still to do. The goblin is random, but seeded by the
 * Knight's session, so a Knight meets the same foe on every visit.
 *
 * Everything but the drawing is pure, so tests check the foes and the health bars.
 */

export interface DuelKnight {
  id: string;
  name: string;
  /** The colour it wears: its war's banner. */
  banner: Banner;
  /** Working (or waiting on the user) right now. */
  active: boolean;
  needsYou: boolean;
  /** The battle (branch) it fights, when the War Room knows it. */
  battle: string | null;
  /** Its quests: how many are done of how many. */
  quests: { done: number; total: number };
}

export const GOBLIN_KINDS = ['Torch', 'TNT', 'Barrel'] as const;
export type GoblinKind = (typeof GOBLIN_KINDS)[number];
export const GOBLIN_COLOURS = ['Red', 'Blue', 'Purple', 'Yellow'] as const;
export type GoblinColour = (typeof GOBLIN_COLOURS)[number];

export interface Goblin {
  name: string;
  kind: GoblinKind;
  colour: GoblinColour;
}

export interface Duel {
  knight: DuelKnight;
  goblin: Goblin;
  /** The Knight's feet; the goblin stands to its right. */
  x: number;
  y: number;
}

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
  'Lint Error',
  'Broken Build',
  'Missing Semicolon',
] as const;

/** A small, stable hash: the same session always draws the same goblin. */
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

/** The goblin a Knight faces: a bug's name, a kind of goblin and one of the pack's colours. */
export function goblinFor(knightId: string): Goblin {
  const next = rng(seedOf(knightId));
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  return { name: pick(FOES), kind: pick(GOBLIN_KINDS), colour: pick(GOBLIN_COLOURS) };
}

/** The goblins for Knights seen together, so no two on one field share a name. */
export function goblinsFor(knightIds: readonly string[]): Goblin[] {
  const taken = new Set<string>();
  return knightIds.map((id) => {
    const goblin = goblinFor(id);
    let i = FOES.indexOf(goblin.name as (typeof FOES)[number]);
    for (let n = 0; n < FOES.length && taken.has(FOES[i]!); n++) i = (i + 1) % FOES.length;
    taken.add(FOES[i]!);
    return { ...goblin, name: FOES[i]! };
  });
}

/** The Knights fighting in a war, from the guild's own state: the ones still here. */
export function warKnights(state: GuildState, war: WarInfo): DuelKnight[] {
  const out: DuelKnight[] = [];
  for (const id of war.knights) {
    const hero = state.heroes[id];
    if (!hero || hero.status === 'gone') continue;
    const battle = war.battles.find((b) => b.knights.some((k) => k.id === id));
    out.push(duelKnight(hero, war.banner, battle?.branch ?? hero.branch ?? null));
  }
  return out;
}

export function duelKnight(hero: Hero, banner: Banner, battle: string | null): DuelKnight {
  return {
    id: hero.id,
    name: hero.name,
    banner,
    active: hero.status === 'working' || hero.status === 'needs_you',
    needsYou: hero.status === 'needs_you',
    battle,
    quests: {
      done: hero.quests.filter((q) => q.status === 'completed').length,
      total: hero.quests.length,
    },
  };
}

/** Working Knights first, so the fights in progress are the ones that fit. */
export const byActivity = (knights: readonly DuelKnight[]) =>
  [...knights].sort((a, b) => Number(b.active) - Number(a.active));

/**
 * The goblin's health bar: the share of the Knight's quests still to do, and what it says.
 * A Knight with no quests shows no bar.
 */
export function health(k: DuelKnight): { left: number; label: string } | null {
  if (!k.active) return { left: 1, label: 'resting' };
  if (k.quests.total === 0) return null;
  return {
    left: (k.quests.total - k.quests.done) / k.quests.total,
    label: `quests ${k.quests.done}/${k.quests.total}`,
  };
}

// ------------------------------------------------------------------ the goblins' art

/** The pack's goblin sheets: each kind's idle and attack rows, frame size and frames. */
const GOBLIN_ART: Record<
  GoblinKind,
  { size: number; idle: [number, number]; attack: [number, number]; feet: number }
> = {
  Torch: { size: 192, idle: [0, 7], attack: [2, 6], feet: 0.66 },
  TNT: { size: 192, idle: [0, 6], attack: [2, 7], feet: 0.66 },
  Barrel: { size: 128, idle: [0, 1], attack: [1, 6], feet: 0.74 },
};

export interface GoblinArt {
  sheets: Record<string, HTMLImageElement>;
  house: HTMLImageElement;
  tower: HTMLImageElement;
}

let goblinPromise: Promise<GoblinArt> | null = null;

/** The goblins' sheets and camp, loaded once per page. */
export function loadGoblins(): Promise<GoblinArt> {
  const base = '/assets/tiny-swords/goblins';
  goblinPromise ??= (async () => {
    const names = GOBLIN_KINDS.flatMap((k) => GOBLIN_COLOURS.map((c) => `${k}_${c}`));
    const [sheets, house, tower] = await Promise.all([
      Promise.all(names.map((n) => loadImage(`${base}/${n}.png`))),
      loadImage(`${base}/Goblin_House.png`),
      loadImage(`${base}/Wood_Tower_Red.png`),
    ]);
    return { sheets: Object.fromEntries(names.map((n, i) => [n, sheets[i]!])), house, tower };
  })();
  return goblinPromise;
}

// ------------------------------------------------------------------ drawing

const FRAME = 192;
/** A Knight's frame on the field, and the goblins at the same scale. */
const SIZE = 160;
const SCALE = SIZE / FRAME;
const FEET = 0.7;
/** How far right of its Knight a goblin stands. */
export const GOBLIN_DX = 125;
const FRAME_MS = 110;

/** Where a Knight can be clicked: its body and its name plate. */
export const knightRect = (d: Duel): Rect => ({ x: d.x - 45, y: d.y - 90, w: 90, h: 125 });

function sheetCell(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  size: number,
  row: number,
  col: number,
  x: number,
  y: number,
  feet: number,
  flip: boolean,
): void {
  const w = size * SCALE;
  ctx.save();
  if (flip) {
    ctx.translate(x * 2, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(sheet, col * size, row * size, size, size, x - w / 2, y - w * feet, w, w);
  ctx.restore();
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.beginPath();
  ctx.ellipse(x, y + 3, 32, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function healthBar(ctx: CanvasRenderingContext2D, x: number, y: number, h: { left: number; label: string }) {
  const w = 74;
  ctx.save();
  ctx.fillStyle = '#161c2e';
  ctx.fillRect(x - w / 2 - 2, y - 2, w + 4, 12);
  ctx.fillStyle = '#4a1612';
  ctx.fillRect(x - w / 2, y, w, 8);
  ctx.fillStyle = '#d8402f';
  ctx.fillRect(x - w / 2, y, w * h.left, 8);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fillRect(x - w / 2, y, w * h.left, 2);
  ctx.font = '800 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(30, 14, 8, 0.85)';
  ctx.strokeText(h.label, x, y - 6);
  ctx.fillStyle = '#fff2d8';
  ctx.fillText(h.label, x, y - 6);
  ctx.restore();
}

/** A red tag under the goblin, so it reads as the foe. */
export function foePlate(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number): void {
  ctx.save();
  ctx.font = '700 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(48, 12, 10, 0.92)';
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

/**
 * One duel. A Knight at work swings (row 2 of its sheet) and its goblin fights back, with
 * sparks as the blade lands; a resting one stands with "z z" while its goblin idles; one
 * waiting on the user wears a red "!".
 */
export function drawDuel(
  ctx: CanvasRenderingContext2D,
  art: Art,
  d: Duel,
  sprites: Sprites,
  goblins: GoblinArt,
  nowMs: number,
  hovered: boolean,
): void {
  const fighting = d.knight.active && !d.knight.needsYou;
  const offset = seedOf(d.knight.id) % 1000;
  const tick = Math.floor((nowMs + offset) / FRAME_MS);
  const gx = d.x + GOBLIN_DX;
  shadow(ctx, d.x, d.y);
  shadow(ctx, gx, d.y);

  const knight = sprites.units[`Warrior_${d.knight.banner}`];
  const swing = tick % 6;
  if (knight)
    sheetCell(
      ctx,
      knight,
      FRAME,
      fighting ? 2 : 0,
      fighting || d.knight.needsYou ? swing : 0,
      d.x,
      d.y,
      FEET,
      false,
    );

  const g = GOBLIN_ART[d.goblin.kind];
  const sheet = goblins.sheets[`${d.goblin.kind}_${d.goblin.colour}`];
  const [row, frames] = fighting ? g.attack : g.idle;
  // The blade lands on frames 2 and 3: the goblin is knocked back a step, and sparks fly.
  const hit = fighting && (swing === 2 || swing === 3);
  if (sheet) sheetCell(ctx, sheet, g.size, row, tick % frames, gx + (hit ? 5 : 0), d.y, g.feet, true);
  if (hit) put(ctx, art.sparks, d.x + 66, d.y - 26, { frames: 4, frame: swing - 1, scale: 1.3 });

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (d.knight.needsYou) {
    ctx.fillStyle = '#e04434';
    ctx.strokeStyle = '#3a0c08';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(d.x + 26, d.y - 84, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 16px system-ui, sans-serif';
    ctx.fillText('!', d.x + 26, d.y - 83);
  } else if (!d.knight.active) {
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText('z z', d.x + 26, d.y - 80);
  }
  ctx.restore();

  const h = health(d.knight);
  if (h) healthBar(ctx, gx, d.y - 92, h);
  if (hovered) highlight(ctx, knightRect(d));
  plate(ctx, d.knight.name.length > 22 ? `${d.knight.name.slice(0, 21)}…` : d.knight.name, d.x, d.y + 10);
  foePlate(ctx, d.goblin.name, gx, d.y + 36);
}
