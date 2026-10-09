import type { Banner } from '@agent-guild/core';

import {
  type Duel,
  type DuelKnight,
  GOBLIN_DX,
  type GoblinArt,
  byActivity,
  drawDuel,
  goblinsFor,
  knightRect,
} from './duel.ts';
import { type Art, frameAt, grass, inside, plate, put, terrain } from './scene.ts';
import type { Sprites } from './village.ts';

/**
 * One war's battlefield (docs/WARS.md): every Knight working in the war duels a goblin from
 * the Tiny Swords pack (duel.ts), the same goblin on every visit. Knights at work swing;
 * resting ones hold their ground, and the goblin waits with them.
 *
 * `fieldModel` and `fieldPick` are pure, so tests check the duels and what a click lands on
 * without a canvas.
 */

export interface FieldModel {
  banner: Banner;
  duels: Duel[];
  /** Knights past what fits on the field. */
  more: number;
  /** The units' sheets, recoloured, and the goblins'; the page waits for them. */
  sprites: Sprites;
  goblins: GoblinArt;
}

export type FieldPick = { kind: 'knight'; id: string };

const MAX_DUELS = 6;

/** Where n duels stand (n at most six): one column for a lone duel, else two, rows centred. */
export function duelSlots(n: number): [number, number][] {
  const count = Math.min(n, MAX_DUELS);
  const cols = count <= 1 ? 1 : 2;
  const rows = Math.ceil(count / cols);
  const xs = cols === 1 ? [560 - GOBLIN_DX / 2] : [250, 700];
  const ys = rows === 1 ? [500] : rows === 2 ? [410, 600] : [320, 480, 640];
  return Array.from({ length: count }, (_, i) => [xs[i % cols]!, ys[Math.floor(i / cols)]!]);
}

export function fieldModel(
  banner: Banner,
  knights: readonly DuelKnight[],
  sprites: Sprites,
  goblins: GoblinArt,
): FieldModel {
  // Working Knights first, so the fights in progress are the ones that fit.
  const order = byActivity(knights);
  const slots = duelSlots(order.length);
  const foes = goblinsFor(order.slice(0, slots.length).map((k) => k.id));
  const duels = slots.map(([x, y], i) => ({ knight: order[i]!, goblin: foes[i]!, x, y }));
  return { banner, duels, more: Math.max(0, knights.length - MAX_DUELS), sprites, goblins };
}

export function fieldPick(model: FieldModel, px: number, py: number): FieldPick | null {
  for (const d of model.duels) if (inside(knightRect(d), px, py)) return { kind: 'knight', id: d.knight.id };
  return null;
}

export const sameFieldPick = (a: FieldPick | null, b: FieldPick | null) => a?.id === b?.id;

export function describeField(model: FieldModel): string {
  if (model.duels.length === 0) return 'The battlefield is quiet: no Knight is fighting in this war.';
  const duels = model.duels.map(
    (d) => `${d.knight.name} ${d.knight.active ? 'fights' : 'faces'} ${d.goblin.name}`,
  );
  return `The battlefield: ${duels.join('; ')}${model.more ? `; and ${model.more} more` : ''}.`;
}

// ------------------------------------------------------------------ drawing

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
  // The goblins' camp at the edge of the field.
  put(ctx, model.goblins.tower, 985, 360, { frames: 4, frame: frameAt(4, nowMs, 200), scale: 0.7 });
  put(ctx, model.goblins.house, 150, 380, { scale: 0.75 });

  if (model.duels.length === 0) {
    plate(ctx, 'No Knight on the field. Send one into a battle below.', 560, 420);
    return;
  }
  for (const d of model.duels)
    drawDuel(ctx, art, d, model.sprites, model.goblins, nowMs, hovered?.id === d.knight.id);
  if (model.more > 0) plate(ctx, `+${model.more} more Knights in this war`, 560, 690);
}
