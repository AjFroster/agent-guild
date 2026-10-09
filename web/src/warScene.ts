import type { WarInfo } from './api.ts';
import { type Art, type Rect, grass, highlight, inside, plate, put, ribbon, terrain } from './scene.ts';
import { TEAM_CSS } from './village.ts';

/**
 * The War Room page's scene (docs/WARS.md): the castle where the war council sits, and in
 * front of it the war table, a map with one banner for each war the user has declared.
 * Each banner shows its victories, ripples while one of its battles is being fought, and
 * carries a red mark when one has stalled. Clicking a banner goes to that war's card;
 * clicking the board on the left goes to the battle reports.
 *
 * `warModel` and `warPick` are pure, so tests can check what is shown and what a click
 * lands on without a canvas.
 */

export interface SceneWar {
  id: string;
  name: string;
  banner: WarInfo['banner'];
  victories: number;
  fighting: number;
  stalled: number;
}

export interface WarModel {
  /** Null in demo mode, where there are no wars to read. */
  wars: SceneWar[] | null;
}

export function warModel(wars: readonly WarInfo[] | null): WarModel {
  if (!wars) return { wars: null };
  return {
    wars: wars
      .filter((w) => !w.archived)
      .map((w) => ({
        id: w.id,
        name: w.name,
        banner: w.banner,
        victories: w.victories,
        fighting: w.battles.filter((b) => b.state === 'fighting').length,
        stalled: w.battles.filter((b) => b.state === 'stalled' || b.state === 'unclear').length,
      })),
  };
}

export type WarPick =
  { kind: 'war'; id: string } | { kind: 'more' } | { kind: 'reports' } | { kind: 'table' };

/** The war table: a map on trestles in front of the castle. */
export const TABLE: Rect = { x: 300, y: 400, w: 520, h: 190 };
export const REPORTS: Rect = { x: 52, y: 410, w: 170, h: 150 };
const MAX_SHOWN = 6;
const BANNER_BASE = TABLE.y + 150;

/** The banners on the table: up to six, or five and a "+N" for the rest. */
export function tableBanners(model: WarModel): (SceneWar | { more: number })[] {
  const all = model.wars ?? [];
  const shown: (SceneWar | { more: number })[] = all.slice(
    0,
    all.length > MAX_SHOWN ? MAX_SHOWN - 1 : MAX_SHOWN,
  );
  if (all.length > MAX_SHOWN) shown.push({ more: all.length - (MAX_SHOWN - 1) });
  return shown;
}

/** Where each banner stands on the table, spread evenly. */
export function bannerXs(n: number): number[] {
  const gap = TABLE.w / (n + 1);
  return Array.from({ length: n }, (_, i) => Math.round(TABLE.x + gap * (i + 1)));
}

export const bannerRect = (x: number): Rect => ({ x: x - 34, y: BANNER_BASE - 120, w: 76, h: 140 });

export function warPick(model: WarModel, px: number, py: number): WarPick | null {
  const shown = tableBanners(model);
  const xs = bannerXs(shown.length);
  for (const [i, w] of shown.entries())
    if (inside(bannerRect(xs[i]!), px, py)) return 'more' in w ? { kind: 'more' } : { kind: 'war', id: w.id };
  if (inside(REPORTS, px, py)) return { kind: 'reports' };
  if (inside(TABLE, px, py)) return { kind: 'table' };
  return null;
}

export const samePick = (a: WarPick | null, b: WarPick | null) => JSON.stringify(a) === JSON.stringify(b);

export function describeWars(model: WarModel): string {
  if (!model.wars) return 'The War Room: the war table, where the wars are planned.';
  if (model.wars.length === 0) return 'The War Room: the war table is empty. No war has been declared.';
  return `The War Room: ${model.wars
    .map(
      (w) =>
        `${w.name} (${w.victories} ${w.victories === 1 ? 'victory' : 'victories'}, ${w.fighting} fighting${
          w.stalled ? `, ${w.stalled} stalled` : ''
        })`,
    )
    .join('; ')}.`;
}

const TREES: readonly [number, number][] = [
  [40, 250],
  [1080, 250],
  [30, 715],
  [1095, 715],
  [250, 170],
  [880, 170],
];

/** A banner on its pole, with its count; it ripples while a battle is on. */
function banner(
  ctx: CanvasRenderingContext2D,
  x: number,
  base: number,
  colour: string,
  text: string,
  nowMs: number,
  { waving = false, alert = false } = {},
): void {
  const top = base - 110;
  ctx.save();
  ctx.fillStyle = '#5c3a1c';
  ctx.fillRect(x - 3, top, 6, 112);
  ctx.fillStyle = '#e0bb5c';
  ctx.beginPath();
  ctx.arc(x, top, 6, 0, Math.PI * 2);
  ctx.fill();
  const wave = waving ? Math.sin(nowMs / 170 + x) * 4 : 0;
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
  if (alert) {
    ctx.fillStyle = '#e04434';
    ctx.strokeStyle = '#3a0c08';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 52, top + 4, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 14px system-ui, sans-serif';
    ctx.fillText('!', x + 52, top + 5);
  }
  ctx.restore();
}

/** The war table: trestles, a wooden top, and the campaign map on it. */
function table(ctx: CanvasRenderingContext2D): void {
  const { x, y, w, h } = TABLE;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h + 6, w / 2 + 10, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5c3a1c';
  for (const lx of [x + 30, x + w - 40]) ctx.fillRect(lx, y + h - 20, 12, 30);
  ctx.fillStyle = '#7d5833';
  ctx.strokeStyle = '#3e2610';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h - 10, 14);
  ctx.fill();
  ctx.stroke();
  // The map: parchment with a river and a few hills.
  ctx.fillStyle = '#ead9ae';
  ctx.strokeStyle = '#9c7a44';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x + 18, y + 14, w - 36, h - 38, 8);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(80, 140, 190, 0.7)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x + 30, y + 120);
  ctx.bezierCurveTo(x + 160, y + 60, x + 300, y + 150, x + w - 30, y + 50);
  ctx.stroke();
  ctx.fillStyle = 'rgba(120, 100, 60, 0.35)';
  for (const [hx, hy] of [
    [90, 50],
    [230, 120],
    [420, 120],
    [460, 40],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x + hx - 18, y + hy + 10);
    ctx.lineTo(x + hx, y + hy - 10);
    ctx.lineTo(x + hx + 18, y + hy + 10);
    ctx.fill();
  }
  ctx.restore();
}

export function drawWarScene(
  ctx: CanvasRenderingContext2D,
  art: Art,
  model: WarModel,
  nowMs: number,
  hovered: WarPick | null = null,
): void {
  ctx.imageSmoothingEnabled = false;
  grass(ctx, art);
  terrain(ctx, art.grass, { col: 5, row: 0 }, 192, 360, 12, 5);
  terrain(ctx, art.stone, { col: 0, row: 0 }, 384, 40, 6, 3, true);
  const tree = { x: 0, y: 0, w: 192, h: 192 };
  for (const [x, y] of TREES) put(ctx, art.tree, x, y, { crop: tree });
  put(ctx, art.castle, 576, 270, { scale: 0.75 });
  put(ctx, art.bushBig, 380, 300);
  put(ctx, art.bush, 780, 305);
  put(ctx, art.rock, 960, 600);
  // The general at the head of the table.
  put(ctx, art.warriorBlue, 900, 520, { crop: { x: 0, y: 0, w: 192, h: 192 }, flip: true });

  table(ctx);
  if (hovered?.kind === 'table') highlight(ctx, TABLE);

  // The battle reports, pinned to a board.
  const r = REPORTS;
  ctx.save();
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(r.x + 20, r.y + 60, 8, r.h - 50);
  ctx.fillRect(r.x + r.w - 28, r.y + 60, 8, r.h - 50);
  ctx.fillStyle = '#8a6239';
  ctx.strokeStyle = '#3e2610';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, 100, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f2e6c8';
  for (const [dx, dy, rot] of [
    [18, 14, -0.05],
    [66, 18, 0.04],
    [114, 12, -0.02],
  ] as const) {
    ctx.save();
    ctx.translate(r.x + dx + 18, r.y + dy + 30);
    ctx.rotate(rot);
    ctx.fillRect(-18, -26, 36, 52);
    ctx.restore();
  }
  ctx.restore();
  if (hovered?.kind === 'reports') highlight(ctx, REPORTS);

  const shown = tableBanners(model);
  const xs = bannerXs(shown.length);
  shown.forEach((w, i) => {
    const x = xs[i]!;
    if ('more' in w) {
      banner(ctx, x, BANNER_BASE, '#6b6b60', `+${w.more}`, nowMs);
      plate(ctx, `${w.more} more wars`, x + 24, BANNER_BASE + 6);
    } else {
      banner(ctx, x, BANNER_BASE, TEAM_CSS[w.banner], String(w.victories), nowMs, {
        waving: w.fighting > 0,
        alert: w.stalled > 0,
      });
      plate(ctx, w.name.length > 16 ? `${w.name.slice(0, 15)}…` : w.name, x + 24, BANNER_BASE + 6);
    }
    if (
      hovered &&
      (('more' in w && hovered.kind === 'more') ||
        (!('more' in w) && hovered.kind === 'war' && hovered.id === w.id))
    )
      highlight(ctx, bannerRect(x));
  });
  if (model.wars && model.wars.length === 0)
    plate(ctx, 'No war declared yet', TABLE.x + TABLE.w / 2, TABLE.y + 70);

  ribbon(ctx, art.ribbonRed, 'War council', 576, 290, 240, '#ffffff');
  ribbon(
    ctx,
    art.ribbonYellow,
    'Battle reports',
    REPORTS.x + REPORTS.w / 2,
    REPORTS.y + REPORTS.h - 6,
    220,
    '#281800',
  );
}
