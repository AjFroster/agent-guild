import type { PortalInfo } from './api.ts';
import { type Art, type Rect, FRAMES, frameAt, grass, inside, put, ribbon, terrain } from './scene.ts';

/**
 * The Tower page's scene (docs/TOWER.md): the Tower on its terrace; the Seer's scrying pool,
 * telescope and scroll rack on the left; the Archmage's star-chart desk, crystal and
 * floating books on the right; the Enchanter's lens and the Lookout's bell; and in front,
 * the Portal Keeper's plaza: one portal on the rune circle for each service listening on a
 * local port. Purple: it runs in a Knight's folder. Green: it answers as a website. Blue:
 * not checked. A plain stone arch: it listens but is not a website.
 *
 * `towerModel` and `towerPick` are pure, so tests can check what is shown and what a click
 * lands on without a canvas.
 */

export type PortalLook = 'purple' | 'green' | 'blue' | 'closed';

export interface ShownPortal {
  port: number;
  label: string;
  look: PortalLook;
  /** Where clicking it goes: the service itself, unless it is not a website. */
  url: string | null;
}

export interface TowerModel {
  /** Null in demo mode, where the guild cannot look at ports. */
  portals: PortalInfo[] | null;
}

export const towerModel = (portals: PortalInfo[] | null): TowerModel => ({ portals });

/** The look of a portal: a Knight's service, a website, unchecked, or not a website. */
export function portalLook(p: Pick<PortalInfo, 'knight' | 'http'>): PortalLook {
  if (p.http === false) return 'closed';
  if (p.knight) return 'purple';
  return p.http ? 'green' : 'blue';
}

export const portalUrl = (port: number) => `http://localhost:${port}/`;

/** What a portal is called on its plate: the user's name, else the page title, else the program. */
export function portalLabel(p: PortalInfo, max = 15): string {
  // A Knight's portal is purple; whose it is shows in the list below the scene.
  const text = `:${p.port} ${p.name ?? p.title ?? p.command}`;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const PORTAL_BASE = 660;
const MAX_SHOWN = 5;
const SPACING = 132;
const CENTRE = 610;

/** The portals on the plaza: up to five, or four and a "+N" arch for the rest. */
export function plaza(model: TowerModel): (ShownPortal | { more: number })[] {
  const all = model.portals ?? [];
  const shown: (ShownPortal | { more: number })[] = all
    .slice(0, all.length > MAX_SHOWN ? MAX_SHOWN - 1 : MAX_SHOWN)
    .map((p) => {
      const look = portalLook(p);
      return { port: p.port, label: portalLabel(p), look, url: look === 'closed' ? null : portalUrl(p.port) };
    });
  if (all.length > MAX_SHOWN) shown.push({ more: all.length - (MAX_SHOWN - 1) });
  return shown;
}

/** Where each arch stands, centred on the plaza. */
export function plazaXs(n: number): number[] {
  return Array.from({ length: n }, (_, i) => CENTRE + (i - (n - 1) / 2) * SPACING);
}

export const portalRect = (x: number): Rect => ({ x: x - 50, y: PORTAL_BASE - 145, w: 100, h: 170 });
export const KEEPER = { x: 185, base: 640 };

export type TowerPick =
  { kind: 'portal'; port: number; url: string | null } | { kind: 'more' } | { kind: 'keeper' };

export function towerPick(model: TowerModel, px: number, py: number): TowerPick | null {
  const shown = plaza(model);
  const xs = plazaXs(shown.length);
  for (const [i, p] of shown.entries())
    if (inside(portalRect(xs[i]!), px, py))
      return 'more' in p ? { kind: 'more' } : { kind: 'portal', port: p.port, url: p.url };
  if (inside({ x: KEEPER.x - 45, y: KEEPER.base - 140, w: 90, h: 165 }, px, py)) return { kind: 'keeper' };
  return null;
}

export const samePick = (a: TowerPick | null, b: TowerPick | null) => JSON.stringify(a) === JSON.stringify(b);

export function describeTower(model: TowerModel): string {
  if (!model.portals) return 'The Tower: the Portal Keeper watches for services on local ports.';
  const n = model.portals.length;
  const sites = model.portals.filter((p) => p.http).length;
  return `The Tower: ${n} ${n === 1 ? 'portal' : 'portals'} open, ${sites} to a website.`;
}

const TREES: readonly [number, number][] = [
  [50, 240],
  [1070, 230],
  [30, 710],
  [1100, 710],
  [400, 140],
  [760, 140],
];

/** A blue Pawn in a wizard's hat (and a staff), standing at (x, base). */
function wizard(
  ctx: CanvasRenderingContext2D,
  art: Art,
  hat: HTMLImageElement,
  x: number,
  base: number,
  nowMs: number,
  { flip = false, staff = false, idle = true } = {},
): void {
  const frame = idle ? frameAt(6, nowMs, 140) : 0;
  put(ctx, art.pawnBlue, x, base, { crop: { x: 0, y: 0, w: 192, h: 192 }, frame, flip });
  // The Pawn's head sits about 96px above its frame's foot; the hat's brim goes there.
  put(ctx, hat, x + (flip ? 1 : -1), base - 96 + 10);
  if (staff) put(ctx, art.staff, x + (flip ? -42 : 42), base - 18);
}

export function drawTowerScene(
  ctx: CanvasRenderingContext2D,
  art: Art,
  model: TowerModel,
  nowMs: number,
  hovered: TowerPick | null = null,
): void {
  ctx.imageSmoothingEnabled = false;
  grass(ctx, art);
  terrain(ctx, art.stone, { col: 0, row: 0 }, 448, 40, 4, 3, true);
  terrain(ctx, art.grass, { col: 5, row: 0 }, 64, 320, 16, 6);

  const tree = { x: 0, y: 0, w: 192, h: 192 };
  const things: [number, () => void][] = [
    ...TREES.map(([x, y]): [number, () => void] => [y, () => put(ctx, art.tree, x, y, { crop: tree })]),
    [250, () => put(ctx, art.tower, 576, 250, { scale: 0.62 })],
    [290, () => put(ctx, art.rock, 130, 290)],
    [280, () => put(ctx, art.bushBig, 900, 280)],
    [265, () => put(ctx, art.bush, 330, 265)],
    // The Seer's corner (left) and the Archmage's (right): their wizards come in later phases.
    [330, () => put(ctx, art.scrollRack, 130, 330)],
    [330, () => put(ctx, art.telescope, 300, 330)],
    [
      470,
      () =>
        put(ctx, art.scryingPool, 220, 470, { frames: FRAMES.scryingPool, frame: frameAt(4, nowMs, 260) }),
    ],
    [330, () => put(ctx, art.starDesk, 900, 330)],
    [345, () => put(ctx, art.crystal, 1040, 345, { frames: FRAMES.crystal, frame: frameAt(4, nowMs, 300) })],
    [
      450,
      () =>
        put(ctx, art.floatingBooks, 900, 450, {
          frames: FRAMES.floatingBooks,
          frame: frameAt(4, nowMs, 300),
        }),
    ],
    [440, () => put(ctx, art.lens, 400, 440)],
    [300, () => put(ctx, art.alarmBell, 700, 300, { frames: FRAMES.alarmBell, frame: 0 })],
    [KEEPER.base, () => wizard(ctx, art, art.hatPortal, KEEPER.x, KEEPER.base, nowMs, { staff: true })],
  ];
  things.sort((a, b) => a[0] - b[0]).forEach(([, draw]) => draw());

  // The plaza: a rune circle, and the portals on it.
  const shown = plaza(model);
  const xs = plazaXs(shown.length);
  if (shown.length > 0)
    put(ctx, art.runeCircle, CENTRE, PORTAL_BASE + 40, {
      frames: FRAMES.runeCircle,
      frame: frameAt(4, nowMs, 250),
      scale: Math.max(1.4, (shown.length * SPACING) / 160),
    });
  shown.forEach((p, i) => {
    const x = xs[i]!;
    if ('more' in p) {
      put(ctx, art.portalClosed, x, PORTAL_BASE);
      plate(ctx, `+${p.more} more`, x, PORTAL_BASE + 4);
    } else {
      const img =
        p.look === 'closed'
          ? art.portalClosed
          : p.look === 'purple'
            ? art.portalPurple
            : p.look === 'green'
              ? art.portalGreen
              : art.portalBlue;
      put(
        ctx,
        img,
        x,
        PORTAL_BASE,
        p.look === 'closed' ? {} : { frames: FRAMES.portal, frame: frameAt(6, nowMs + i * 90, 120) },
      );
      plate(ctx, p.label, x, PORTAL_BASE + 4);
    }
    if (
      hovered &&
      hovered.kind !== 'keeper' &&
      ('more' in p ? hovered.kind === 'more' : hovered.kind === 'portal' && hovered.port === p.port)
    )
      highlight(ctx, portalRect(x));
  });
  if (model.portals && shown.length === 0) plate(ctx, 'No services on local ports', CENTRE, PORTAL_BASE - 60);

  // Who is who. The Portal Keeper is the guild itself: no session, no usage.
  ribbon(ctx, art.ribbonYellow, 'Portal Keeper', KEEPER.x, KEEPER.base - 18, 220, '#281800');
  for (const [name, x, y] of [
    ['Seer', 150, 404],
    ['Archmage', 980, 434],
    ['Enchanter', 480, 404],
    ['Lookout', 760, 294],
  ] as const)
    ribbon(ctx, art.ribbonBlue, `${name} · coming soon`, x, y, 230, '#ffffff');
}

/** A dark name plate with a blue rim, under a portal. */
function plate(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number): void {
  ctx.save();
  ctx.font = '700 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(20, 26, 40, 0.9)';
  ctx.strokeStyle = '#78b4fa';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, y, w, 22, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e6f0ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y + 11.5);
  ctx.restore();
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
