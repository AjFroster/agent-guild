import {
  type GuildState,
  type Hero,
  type LibrarianState,
  librarianState,
  roleName,
  smithsIn,
} from '@agent-guild/core';

import { type Art, type Rect, FRAMES, frameAt, grass, inside, put, ribbon, terrain } from './scene.ts';
import { bubble } from './village.ts';

/**
 * The Forge page's scene (docs/FORGE.md): the Forge on its stone terrace; on the left the
 * Smithy, where the Blacksmith hammers at the anvil beside the hearth, bellows and quench
 * trough; in the middle the rack, holding each piece reviewed and waiting for the user (a
 * sword for a skill, an axe for a command); on the right the Repair Bench, where the
 * Armorer will mend broken weapons.
 *
 * `forgeModel` and `forgePick` are pure, so tests can check what is shown and what a click
 * lands on without a canvas.
 */

export type ForgeRole = 'Blacksmith' | 'Armorer';

export interface ForgeSeat {
  role: ForgeRole;
  hero: Hero | undefined;
  /** "unhired": the Armorer has no work yet (the Repair Bench comes next). */
  state: LibrarianState | 'away' | 'unhired';
}

export interface RackPiece {
  id: string;
  name: string;
  kind: 'skill' | 'command';
  verdict: 'ready' | 'needs-work' | 'risky' | null;
}

/** The Forge's orders as the scene needs them (live mode only). */
export interface ForgeView {
  /** Reviewed pieces, waiting for the user. */
  rack: RackPiece[];
  /** Forged pieces with the Library's Reviewer. */
  atLibrary: number;
  /** An order is on the anvil. */
  forging: boolean;
  /** Orders waiting their turn. */
  queued: number;
}

export interface ForgeModel {
  seats: ForgeSeat[];
  forge: ForgeView | null;
}

export function forgeModel(state: GuildState, forge: ForgeView | null): ForgeModel {
  const blacksmith = smithsIn(state).find((h) => roleName(h.name) === 'Blacksmith');
  return {
    seats: [
      { role: 'Blacksmith', hero: blacksmith, state: blacksmith ? librarianState(blacksmith) : 'away' },
      { role: 'Armorer', hero: undefined, state: 'unhired' },
    ],
    forge,
  };
}

export const STATIONS: Record<ForgeRole, { x: number; base: number; flip: boolean }> = {
  Blacksmith: { x: 210, base: 515, flip: false },
  Armorer: { x: 1000, base: 500, flip: true },
};

export const ANVIL: Rect = { x: 250, y: 420, w: 110, h: 85 };
export const RACK: Rect = { x: 470, y: 470, w: 180, h: 195 };
/** Where each piece hangs on the rack; past four, the last slot says "+N". */
export const RACK_SLOTS = [508, 548, 588, 628].map((x) => ({ x: x - 18, y: 535, w: 36, h: 110 }));
/** Each kind of piece is a weapon: a skill is a sword, a slash command an axe. */
const WEAPON: Record<RackPiece['kind'], 'sword' | 'axe'> = { skill: 'sword', command: 'axe' };

export const seatRect = (role: ForgeRole): Rect => ({
  x: STATIONS[role].x - 45,
  y: STATIONS[role].base - 140,
  w: 90,
  h: 165,
});

/** The pieces on the rack, or three and a "+N more" when there are more than four. */
export function rackShown(view: ForgeView | null): (RackPiece | { more: number })[] {
  if (!view) return [];
  if (view.rack.length <= RACK_SLOTS.length) return view.rack;
  return [...view.rack.slice(0, RACK_SLOTS.length - 1), { more: view.rack.length - (RACK_SLOTS.length - 1) }];
}

export type ForgePick =
  | { kind: 'smith'; role: ForgeRole; id: string }
  | { kind: 'piece'; id: string }
  | { kind: 'rack' }
  | { kind: 'anvil' };

export function forgePick(model: ForgeModel, px: number, py: number): ForgePick | null {
  for (const seat of model.seats)
    if (seat.hero && inside(seatRect(seat.role), px, py))
      return { kind: 'smith', role: seat.role, id: seat.hero.id };
  const shown = rackShown(model.forge);
  for (const [i, piece] of shown.entries())
    if (inside(RACK_SLOTS[i]!, px, py))
      return 'more' in piece ? { kind: 'rack' } : { kind: 'piece', id: piece.id };
  if (inside(RACK, px, py)) return { kind: 'rack' };
  if (inside(ANVIL, px, py)) return { kind: 'anvil' };
  return null;
}

export const samePick = (a: ForgePick | null, b: ForgePick | null) => JSON.stringify(a) === JSON.stringify(b);

export function describeForge(model: ForgeModel): string {
  const smith = model.seats[0]!;
  const who =
    smith.state === 'away'
      ? 'the Blacksmith is away'
      : `the Blacksmith is ${smith.state === 'working' ? 'at the anvil' : smith.state === 'needs_you' ? 'waiting for you' : 'resting'}`;
  const n = model.forge?.rack.length ?? 0;
  const rack = model.forge ? `; ${n} ${n === 1 ? 'piece waits' : 'pieces wait'} for you on the rack` : '';
  return `The Forge: ${who}${rack}.`;
}

const TREES: readonly [number, number][] = [
  [50, 250],
  [1070, 240],
  [30, 700],
  [1100, 700],
  [380, 150],
  [780, 150],
];

const RISK_INK: Record<NonNullable<RackPiece['verdict']>, string> = {
  ready: '#2e7d32',
  'needs-work': '#b07a12',
  risky: '#b22828',
};

export function drawForgeScene(
  ctx: CanvasRenderingContext2D,
  art: Art,
  model: ForgeModel,
  nowMs: number,
  hovered: ForgePick | null = null,
): void {
  ctx.imageSmoothingEnabled = false;
  const smith = model.seats.find((s) => s.role === 'Blacksmith')!;
  const hammering = smith.state === 'working';
  const hot = hammering || model.forge?.forging === true;
  const strike = frameAt(6, nowMs, 100);

  grass(ctx, art);
  terrain(ctx, art.stone, { col: 0, row: 0 }, 416, 60, 5, 3, true);
  terrain(ctx, art.grass, { col: 5, row: 0 }, 64, 330, 16, 5);

  const tree = { x: 0, y: 0, w: 192, h: 192 };
  const things: [number, () => void][] = [
    ...TREES.map(([x, y]): [number, () => void] => [y, () => put(ctx, art.tree, x, y, { crop: tree })]),
    [262, () => put(ctx, art.forge, 576, 262, { scale: 0.62 })],
    [300, () => put(ctx, art.rock, 130, 300)],
    [280, () => put(ctx, art.bushBig, 890, 280)],
    [270, () => put(ctx, art.bush, 330, 270)],
    [480, () => put(ctx, art.mushroomSmall, 1050, 480)],
    // The Smithy. The coals glow brighter and the bellows pump while something is forged.
    [
      350,
      () =>
        put(ctx, art.hearth, 200, 350, { frames: FRAMES.hearth, frame: hot ? frameAt(4, nowMs, 140) : 0 }),
    ],
    [
      350,
      () =>
        put(ctx, art.bellows, 318, 350, { frames: FRAMES.bellows, frame: hot ? frameAt(4, nowMs, 220) : 0 }),
    ],
    [380, () => put(ctx, art.orePile, 110, 380)],
    [395, () => put(ctx, art.ingots, 360, 395)],
    [
      500,
      () => {
        put(ctx, art.anvil, 300, 500, { frames: FRAMES.anvil, frame: hot ? 1 + frameAt(4, nowMs, 180) : 0 });
        // Sparks fly as the hammer lands.
        if (hammering && strike >= 3)
          put(ctx, art.sparks, 300, 450, { frames: FRAMES.sparks, frame: strike - 3 });
      },
    ],
    [
      520,
      () =>
        put(ctx, art.trough, 150, 520, {
          frames: FRAMES.trough,
          frame: hot ? 1 + frameAt(3, nowMs, 300) : 0,
        }),
    ],
    // The Repair Bench (the Armorer comes next).
    [400, () => put(ctx, art.grindstone, 1060, 400, { frames: FRAMES.grindstone, frame: 0 })],
    [390, () => put(ctx, art.toolStump, 900, 390)],
    [520, () => put(ctx, art.repairBench, 850, 520)],
    [660, () => drawRack(ctx, art, model, hovered)],
  ];
  if (smith.hero)
    things.push([
      STATIONS.Blacksmith.base,
      () =>
        put(ctx, art.pawnRed, STATIONS.Blacksmith.x, STATIONS.Blacksmith.base, {
          // Row 2 of the Pawn sheet is a hammer blow.
          crop: { x: 0, y: hammering ? 384 : 0, w: 192, h: 192 },
          frame: hammering ? strike : 0,
        }),
    ]);
  things.sort((a, b) => a[0] - b[0]).forEach(([, draw]) => draw());

  for (const s of model.seats) {
    const { x, base } = STATIONS[s.role];
    const absent = s.state === 'away' || s.state === 'unhired';
    ribbon(
      ctx,
      absent ? art.ribbonBlue : s.state === 'needs_you' ? art.ribbonRed : art.ribbonYellow,
      s.state === 'unhired' ? `${s.role} · coming soon` : s.state === 'away' ? `${s.role} · away` : s.role,
      x,
      base - 15,
      absent ? 240 : 190,
      absent || s.state === 'needs_you' ? '#ffffff' : '#281800',
    );
    if (!absent)
      bubble(
        ctx,
        x,
        base - 110,
        s.state === 'working' ? 'hammer' : s.state === 'needs_you' ? 'alert' : 'sleep',
        1.1,
        nowMs,
      );
    if (hovered?.kind === 'smith' && hovered.role === s.role) highlight(ctx, seatRect(s.role));
  }
  const view = model.forge;
  const label = !view
    ? 'The Rack'
    : [
        view.rack.length > 0 ? `${view.rack.length} ready for you` : 'The Rack',
        view.atLibrary > 0 ? `${view.atLibrary} at the Library` : '',
      ]
        .filter(Boolean)
        .join(' · ');
  ribbon(ctx, art.ribbonRed, label, RACK.x + RACK.w / 2, RACK.y, 300, '#ffffff');
  if (hovered?.kind === 'anvil') highlight(ctx, ANVIL);
}

function drawRack(
  ctx: CanvasRenderingContext2D,
  art: Art,
  model: ForgeModel,
  hovered: ForgePick | null,
): void {
  put(ctx, art.weaponRack, 560, 660);
  rackShown(model.forge).forEach((piece, i) => {
    const slot = RACK_SLOTS[i]!;
    const cx = slot.x + slot.w / 2;
    if ('more' in piece) {
      ctx.save();
      ctx.font = '800 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff3d0';
      ctx.strokeStyle = '#3c2410';
      ctx.lineWidth = 4;
      ctx.strokeText(`+${piece.more}`, cx, slot.y + 60);
      ctx.fillText(`+${piece.more}`, cx, slot.y + 60);
      ctx.restore();
      return;
    }
    put(ctx, art[WEAPON[piece.kind]], cx, 640);
    // A tag in the Reviewer's colour: green ready, amber needs work, red risky.
    if (piece.verdict) {
      ctx.save();
      ctx.fillStyle = RISK_INK[piece.verdict];
      ctx.strokeStyle = '#281800';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + 12, slot.y + 4, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (hovered?.kind === 'piece' && hovered.id === piece.id) highlight(ctx, slot);
  });
}

function highlight(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.save();
  ctx.strokeStyle = '#ffcc33';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, 10);
  ctx.stroke();
  ctx.restore();
}
