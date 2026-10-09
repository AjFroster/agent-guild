import type { Banner, GuildState } from '@agent-guild/core';

import type { WarInfo } from './api.ts';
import {
  type Duel,
  type DuelKnight,
  type GoblinArt,
  byActivity,
  drawDuel,
  duelKnight,
  foePlate,
  goblinsFor,
  knightRect,
  warKnights,
} from './duel.ts';
import { type Art, type Rect, frameAt, grass, highlight, inside, plate, put, terrain } from './scene.ts';
import { type Sprites, TEAM_CSS } from './village.ts';

/**
 * The War Camp (docs/WARS.md): the page the camp on the Barracks fence opens. Behind a
 * palisade stands a tent for each war, in its banner's colour, with its victories on a
 * banner; sleeping wars' tents are faded. On the sand in front, the Knights of every war
 * duel goblins from the Tiny Swords pack (duel.ts): a Knight at work swings, its goblin's
 * health is the Knight's quests still to do. The goblins' own camp stands across the field.
 *
 * `campModel` and `campPick` are pure, so tests check what is shown and what a click lands
 * on without a canvas.
 */

/** A war is active while one of its Knights is fighting, asleep otherwise, ended when archived. */
export type WarMood = 'active' | 'sleeping' | 'ended';
export const warMood = (w: WarInfo): WarMood =>
  w.archived ? 'ended' : w.battles.some((b) => b.state === 'fighting') ? 'active' : 'sleeping';

export interface CampTent {
  id: string;
  name: string;
  banner: Banner;
  victories: number;
  sleeping: boolean;
}

export interface CampModel {
  /** Null in demo mode, where there are no wars to read. */
  tents: CampTent[] | null;
  /** Wars past the tents that fit. */
  moreWars: number;
  duels: Duel[];
  /** Knights past the duels that fit. */
  moreKnights: number;
  sprites: Sprites;
  goblins: GoblinArt;
}

export type CampPick = { kind: 'war'; id: string } | { kind: 'more' } | { kind: 'knight'; id: string };

/** Where the tents stand: two inside the palisade, a third at its edge. */
export const TENT_SLOTS: readonly [number, number][] = [
  [330, 270],
  [800, 270],
  [1000, 305],
];
/** Where the duels stand on the field: the top row first. */
export const DUEL_SLOTS: readonly [number, number][] = [
  [300, 455],
  [640, 455],
  [300, 640],
  [640, 640],
];
/** The victory banners at the gate, for the first two tents. */
const GATE_BANNERS = [470, 650] as const;

/** The Knights of every war still being fought, each in its war's colours. */
export function campKnights(state: GuildState, wars: readonly WarInfo[] | null): DuelKnight[] {
  if (!wars) {
    // Demo mode reads no wars: the camp drills the demo's Knights instead.
    return Object.values(state.heroes)
      .filter((h) => h.status !== 'gone' && h.parentId === null)
      .map((h) => duelKnight(h, 'Blue', h.branch));
  }
  const seen = new Set<string>();
  const out: DuelKnight[] = [];
  for (const war of wars) {
    if (war.archived) continue;
    for (const k of warKnights(state, war)) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push(k);
    }
  }
  return out;
}

export function campModel(
  wars: readonly WarInfo[] | null,
  knights: readonly DuelKnight[],
  sprites: Sprites,
  goblins: GoblinArt,
): CampModel {
  let tents: CampTent[] | null = null;
  let moreWars = 0;
  if (wars) {
    // Wars with a Knight at work first; ended wars have no tent.
    const open = wars
      .filter((w) => !w.archived)
      .map((w) => ({
        id: w.id,
        name: w.name,
        banner: w.banner,
        victories: w.victories,
        sleeping: warMood(w) === 'sleeping',
      }))
      .sort((a, b) => Number(a.sleeping) - Number(b.sleeping));
    const fit = open.length > TENT_SLOTS.length ? TENT_SLOTS.length - 1 : TENT_SLOTS.length;
    tents = open.slice(0, fit);
    moreWars = open.length - tents.length;
  }
  const order = byActivity(knights);
  const shown = order.slice(0, DUEL_SLOTS.length);
  const foes = goblinsFor(shown.map((k) => k.id));
  const duels = shown.map((knight, i) => ({
    knight,
    goblin: foes[i]!,
    x: DUEL_SLOTS[i]![0],
    y: DUEL_SLOTS[i]![1],
  }));
  return { tents, moreWars, duels, moreKnights: order.length - duels.length, sprites, goblins };
}

/** A tent's canvas and its name plate. */
export const tentRect = (i: number): Rect => {
  const [x, y] = TENT_SLOTS[i]!;
  return { x: x - 90, y: y - 150, w: 180, h: 180 };
};

export function campPick(model: CampModel, px: number, py: number): CampPick | null {
  for (const d of model.duels) if (inside(knightRect(d), px, py)) return { kind: 'knight', id: d.knight.id };
  const tents = model.tents ?? [];
  for (const [i, t] of tents.entries()) if (inside(tentRect(i), px, py)) return { kind: 'war', id: t.id };
  if (model.moreWars > 0 && inside(tentRect(tents.length), px, py)) return { kind: 'more' };
  return null;
}

export const sameCampPick = (a: CampPick | null, b: CampPick | null) =>
  JSON.stringify(a) === JSON.stringify(b);

export function describeCamp(model: CampModel): string {
  const parts: string[] = [];
  if (model.tents === null) parts.push('The War Camp, drilling the demo’s Knights');
  else if (model.tents.length === 0) parts.push('The War Camp: no war declared yet');
  else
    parts.push(
      `The War Camp: ${model.tents
        .map(
          (t) =>
            `${t.name} (${t.victories} ${t.victories === 1 ? 'victory' : 'victories'}${t.sleeping ? ', sleeping' : ''})`,
        )
        .join('; ')}${model.moreWars ? `; and ${model.moreWars} more` : ''}`,
    );
  if (model.duels.length === 0) parts.push('The field is quiet');
  else
    parts.push(
      `On the field, ${model.duels
        .map((d) => `${d.knight.name} ${d.knight.active ? 'fights' : 'faces'} ${d.goblin.name}`)
        .join('; ')}${model.moreKnights ? `; and ${model.moreKnights} more` : ''}`,
    );
  return `${parts.join('. ')}.`;
}

// ------------------------------------------------------------------ drawing

const OUTLINE = '#161c2e';

/** A colour darkened by a share, for the shaded side of a tent. */
function shade(hex: string, by: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * (1 - by));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

/** A war tent: canvas in the war's colour, a dark doorway, a pole with a pennant. */
function tent(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
  const dark = shade(colour, 0.32);
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4, 92, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  const tri = (fill: string, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
  };
  tri(OUTLINE, x - 92, y + 3, x, y - 118, x + 92, y + 3);
  tri(colour, x - 85, y - 1, x, y - 110, x + 85, y - 1);
  tri(dark, x + 6, y - 102, x + 85, y - 1, x + 40, y - 1);
  ctx.fillStyle = '#f4ead0';
  for (const dx of [-70, -30, 30, 70]) ctx.fillRect(x + dx - 7, y - 24, 14, 5);
  tri('rgba(255, 255, 255, 0.22)', x - 6, y - 104, x - 70, y - 4, x - 56, y - 4);
  tri(OUTLINE, x - 24, y - 1, x, y - 52, x + 24, y - 1);
  tri('#2b1c14', x - 18, y - 1, x, y - 44, x + 18, y - 1);
  ctx.fillStyle = '#5c3a1c';
  ctx.fillRect(x - 3, y - 150, 6, 40);
  ctx.fillStyle = colour;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 3, y - 148);
  ctx.lineTo(x + 40, y - 140);
  ctx.lineTo(x + 3, y - 130);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** A banner on its pole with a count on it; it ripples while a battle is on. */
function banner(
  ctx: CanvasRenderingContext2D,
  x: number,
  base: number,
  colour: string,
  text: string,
  wave: number,
): void {
  const top = base - 110;
  ctx.save();
  ctx.fillStyle = '#5c3a1c';
  ctx.fillRect(x - 3, top, 6, 112);
  ctx.fillStyle = '#e0bb5c';
  ctx.beginPath();
  ctx.arc(x, top, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.strokeStyle = 'rgba(24, 16, 8, 0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 3, top + 6);
  ctx.lineTo(x + 52, top + 6 + wave);
  ctx.lineTo(x + 52, top + 58 + wave);
  ctx.lineTo(x + 40, top + 48 + wave);
  ctx.lineTo(x + 28, top + 58 + wave);
  ctx.lineTo(x + 3, top + 52);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 28, top + 30 + wave / 2);
  ctx.restore();
}

/** Sharpened stakes with a rail, and a gap for the gate. */
function palisade(
  ctx: CanvasRenderingContext2D,
  y: number,
  from: number,
  to: number,
  gate: [number, number],
) {
  ctx.save();
  for (let x = from; x < to; x += 22) {
    if (x > gate[0] && x < gate[1]) continue;
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.moveTo(x - 1, y);
    ctx.lineTo(x + 10, y - 14);
    ctx.lineTo(x + 21, y);
    ctx.lineTo(x + 21, y + 62);
    ctx.lineTo(x - 1, y + 62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9a6b45';
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 1);
    ctx.lineTo(x + 10, y - 9);
    ctx.lineTo(x + 18, y + 1);
    ctx.lineTo(x + 18, y + 59);
    ctx.lineTo(x + 2, y + 59);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b4835a';
    ctx.fillRect(x + 3, y, 5, 58);
  }
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(from, y + 20, gate[0] - from + 10, 7);
  ctx.fillRect(gate[1], y + 20, to - gate[1], 7);
  // The gate: two posts and a lintel.
  const [l, r] = [gate[0] + 1, gate[1] - 7];
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(l, y - 33, 18, 102);
  ctx.fillRect(r, y - 33, 18, 102);
  ctx.fillRect(l - 6, y - 35, r - l + 30, 18);
  ctx.fillStyle = '#7d5833';
  ctx.fillRect(l + 3, y - 30, 12, 96);
  ctx.fillRect(r + 3, y - 30, 12, 96);
  ctx.fillRect(l - 3, y - 32, r - l + 24, 12);
  ctx.restore();
}

const TREES: readonly [number, number][] = [
  [40, 200],
  [1085, 200],
  [30, 712],
  [1095, 712],
  [150, 120],
  [980, 120],
  [70, 470],
];

const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export function drawCamp(
  ctx: CanvasRenderingContext2D,
  art: Art,
  model: CampModel,
  nowMs: number,
  hovered: CampPick | null = null,
): void {
  ctx.imageSmoothingEnabled = false;
  grass(ctx, art);
  terrain(ctx, art.grass, { col: 5, row: 0 }, 192, 330, 12, 6);
  const tree = { x: 0, y: 0, w: 192, h: 192 };
  for (const [x, y] of TREES) put(ctx, art.tree, x, y, { crop: tree });

  // The camp: a palisade with its gate, a tent per war, the victory banners at the gate.
  palisade(ctx, 70, 230, 900, [506, 612]);
  const tents = model.tents ?? [];
  tents.forEach((t, i) => {
    const [x, y] = TENT_SLOTS[i]!;
    ctx.save();
    if (t.sleeping) ctx.globalAlpha = 0.72;
    tent(ctx, x, y, TEAM_CSS[t.banner]);
    ctx.restore();
    const wave = t.sleeping ? 0 : Math.sin(nowMs / 170 + i * 2) * 4;
    if (i < GATE_BANNERS.length)
      banner(ctx, GATE_BANNERS[i]!, 250, TEAM_CSS[t.banner], String(t.victories), wave);
    else {
      // The third tent carries its count on its pennant.
      ctx.save();
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(t.victories), x + 12, y - 139);
      ctx.restore();
    }
    ctx.save();
    if (t.sleeping) ctx.globalAlpha = 0.85;
    plate(ctx, short(t.name, 20) + (t.sleeping ? ' (sleeping)' : ''), x, y + 10);
    ctx.restore();
    if (hovered?.kind === 'war' && hovered.id === t.id) highlight(ctx, tentRect(i));
  });
  if (model.moreWars > 0) {
    const [x, y] = TENT_SLOTS[tents.length]!;
    ctx.save();
    ctx.globalAlpha = 0.6;
    tent(ctx, x, y, '#8a8a80');
    ctx.restore();
    plate(ctx, `+${model.moreWars} more wars`, x, y + 10);
    if (hovered?.kind === 'more') highlight(ctx, tentRect(tents.length));
  }
  if (model.tents && model.tents.length === 0) plate(ctx, 'No war declared yet: declare one below', 565, 200);

  put(ctx, art.fire, 565, 300, { frames: 7, frame: frameAt(7, nowMs), scale: 0.7 });
  put(ctx, art.mushroom, 160, 330);
  put(ctx, art.bushBig, 1060, 420);
  put(ctx, art.bush, 225, 640);
  put(ctx, art.weaponRack, 120, 420, { scale: 0.8 });
  put(ctx, art.shield, 1050, 520, { scale: 0.9 });

  // The goblins' own camp, across the field.
  put(ctx, model.goblins.tower, 930, 470, { frames: 4, frame: frameAt(4, nowMs, 200), scale: 0.75 });
  put(ctx, model.goblins.house, 975, 660, { scale: 0.85 });
  foePlate(ctx, 'Goblin camp', 990, 685);

  plate(
    ctx,
    model.moreKnights > 0 ? `⚔ The field · +${model.moreKnights} more Knights` : '⚔ The field',
    560,
    338,
  );
  if (model.duels.length === 0) plate(ctx, 'No Knight on the field yet', 470, 520);
  for (const d of model.duels)
    drawDuel(
      ctx,
      art,
      d,
      model.sprites,
      model.goblins,
      nowMs,
      hovered?.kind === 'knight' && hovered.id === d.knight.id,
    );
}
