import { loadImage } from './village.ts';

/**
 * A small kit for drawing a building's own page as a Tiny Swords scene: terrain, sprites
 * anchored at their feet, animated props, and the pack's carved frames and ribbons. The
 * Library page is the first scene (libraryScene.ts); other buildings can reuse all of it.
 *
 * Art lives in public/assets: `tiny-swords/` (Pixel Frog, CC0) and `props/` (the guild's
 * own, drawn in the same style by scripts/art/props.py).
 */

export const SCENE_WIDTH = 1120;
export const SCENE_HEIGHT = 720;
const TILE = 64;

/** Every image a scene may use, by short name. */
export const ART = {
  grass: 'tiny-swords/terrain/Tilemap_Flat.png',
  stone: 'tiny-swords/terrain/Tilemap_Elevation.png',
  tree: 'tiny-swords/deco/Tree.png',
  library: 'tiny-swords/buildings/Library.png',
  towerPurple: 'tiny-swords/buildings/Tower_Purple.png',
  housePurple: 'tiny-swords/buildings/House_Purple.png',
  pawnPurple: 'tiny-swords/units/Pawn_Purple.png',
  mushroomSmall: 'tiny-swords/deco/Deco_02.png',
  mushroom: 'tiny-swords/deco/Deco_03.png',
  rock: 'tiny-swords/deco/Deco_05.png',
  bush: 'tiny-swords/deco/Deco_08.png',
  bushBig: 'tiny-swords/deco/Deco_09.png',
  sprout: 'tiny-swords/deco/Deco_10.png',
  fern: 'tiny-swords/deco/Deco_11.png',
  signpost: 'tiny-swords/deco/Deco_17.png',
  fire: 'tiny-swords/effects/Fire.png',
  gold: 'tiny-swords/resources/G_Idle.png',
  logs: 'tiny-swords/resources/W_Idle.png',
  board: 'tiny-swords/ui/Carved_9Slides.png',
  parchment: 'tiny-swords/ui/Banner_Vertical.png',
  ribbonYellow: 'tiny-swords/ui/Ribbon_Yellow_3Slides.png',
  ribbonRed: 'tiny-swords/ui/Ribbon_Red_3Slides.png',
  ribbonBlue: 'tiny-swords/ui/Ribbon_Blue_3Slides.png',
  bookshelf: 'props/bookshelf.png',
  bookshelfSmall: 'props/bookshelf_small.png',
  bookStack: 'props/book_stack.png',
  scrolls: 'props/scrolls.png',
  lectern: 'props/lectern.png',
  orb: 'props/orb.png',
  forge: 'tiny-swords/buildings/Forge.png',
  pawnRed: 'tiny-swords/units/Pawn_Red.png',
  hearth: 'props/hearth.png',
  anvil: 'props/anvil.png',
  bellows: 'props/bellows.png',
  trough: 'props/trough.png',
  grindstone: 'props/grindstone.png',
  sparks: 'props/sparks.png',
  weaponRack: 'props/weapon_rack.png',
  sword: 'props/sword.png',
  axe: 'props/axe.png',
  spear: 'props/spear.png',
  shield: 'props/shield.png',
  brokenSword: 'props/broken_sword.png',
  repairBench: 'props/repair_bench.png',
  orePile: 'props/ore_pile.png',
  ingots: 'props/ingots.png',
  toolStump: 'props/tool_stump.png',
  tower: 'tiny-swords/buildings/Tower.png',
  pawnBlue: 'tiny-swords/units/Pawn_Blue.png',
  portalBlue: 'props/portal_blue.png',
  portalPurple: 'props/portal_purple.png',
  portalGreen: 'props/portal_green.png',
  portalClosed: 'props/portal_closed.png',
  runeCircle: 'props/rune_circle.png',
  telescope: 'props/telescope.png',
  scryingPool: 'props/scrying_pool.png',
  scrollRack: 'props/scroll_rack.png',
  floatingBooks: 'props/floating_books.png',
  crystal: 'props/crystal.png',
  starDesk: 'props/star_desk.png',
  lens: 'props/lens.png',
  alarmBell: 'props/alarm_bell.png',
  hatSeer: 'props/hat_seer.png',
  hatArchmage: 'props/hat_archmage.png',
  hatEnchanter: 'props/hat_enchanter.png',
  hatLookout: 'props/hat_lookout.png',
  hatPortal: 'props/hat_portal.png',
  staff: 'props/staff.png',
} as const;

export type ArtName = keyof typeof ART;
export type Art = Record<ArtName, HTMLImageElement>;

/** Animated art: horizontal strips of equal frames. */
export const FRAMES = {
  fire: 7,
  lectern: 4,
  orb: 6,
  anvil: 5,
  hearth: 4,
  bellows: 4,
  trough: 4,
  grindstone: 4,
  sparks: 4,
  portal: 6,
  runeCircle: 4,
  scryingPool: 4,
  floatingBooks: 4,
  crystal: 4,
  alarmBell: 4,
} as const;

let artPromise: Promise<Art> | null = null;

/** Loads every scene image once per page. */
export function loadArt(): Promise<Art> {
  artPromise ??= Promise.all(
    (Object.entries(ART) as [ArtName, string][]).map(
      async ([name, path]) => [name, await loadImage(`/assets/${path}`)] as const,
    ),
  ).then((pairs) => Object.fromEntries(pairs) as Art);
  return artPromise;
}

/** The frame of an animation at `nowMs`, `ms` per frame; frame 0 when not animating. */
export function frameAt(frames: number, nowMs: number, ms = 120): number {
  return Math.floor(nowMs / ms) % frames;
}

/**
 * Draw an image (or one frame of a strip) with its bottom centre at (cx, base), the way
 * things stand on the ground. `scale` resizes it; `flip` mirrors it.
 */
export function put(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  base: number,
  { frame = 0, frames = 1, scale = 1, flip = false, crop }: PutOptions = {},
): void {
  const sw = crop?.w ?? img.width / frames;
  const sh = crop?.h ?? img.height;
  const sx = (crop?.x ?? 0) + frame * sw;
  const sy = crop?.y ?? 0;
  const w = sw * scale;
  const h = sh * scale;
  ctx.save();
  ctx.translate(Math.round(cx), Math.round(base - h));
  if (flip) {
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, sw, sh, -w / 2, 0, w, h);
  } else ctx.drawImage(img, sx, sy, sw, sh, -w / 2, 0, w, h);
  ctx.restore();
}

export interface PutOptions {
  frame?: number;
  frames?: number;
  scale?: number;
  flip?: boolean;
  /** Part of a sheet, before frames: for one cell of a unit sheet. */
  crop?: { x: number; y: number; w: number; h: number };
}

/** Fill the scene with the plain grass tile. */
export function grass(ctx: CanvasRenderingContext2D, art: Art): void {
  for (let y = 0; y < SCENE_HEIGHT; y += TILE)
    for (let x = 0; x < SCENE_WIDTH; x += TILE)
      ctx.drawImage(art.grass, TILE, TILE, TILE, TILE, x, y, TILE, TILE);
}

/**
 * An area of terrain from a 3x3 block of tiles (corners, edges and middle) starting at
 * tile (col, row) of a tilemap: `grass` 0,0 is grass and 5,0 is sand; `stone` 0,0 is a
 * stone plateau. `cliff` adds the stone sheet's cliff face below it.
 */
export function terrain(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  block: { col: number; row: number },
  x: number,
  y: number,
  cols: number,
  rows: number,
  cliff = false,
): void {
  const pick = (i: number, n: number) => (i === 0 ? 0 : i === n - 1 ? 2 : 1);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const c = block.col + pick(i, cols);
      const r = block.row + pick(j, rows);
      ctx.drawImage(sheet, c * TILE, r * TILE, TILE, TILE, x + i * TILE, y + j * TILE, TILE, TILE);
    }
  if (cliff)
    for (let i = 0; i < cols; i++)
      ctx.drawImage(
        sheet,
        pick(i, cols) * TILE,
        3 * TILE,
        TILE,
        TILE,
        x + i * TILE,
        y + rows * TILE,
        TILE,
        TILE,
      );
}

/** A 9-slice frame (192px art, 64px corners) stretched to w x h. */
export function nine(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  corner = 64,
): void {
  const s = img.width;
  const cols = [
    [0, corner, x, corner],
    [corner, s - 2 * corner, x + corner, w - 2 * corner],
    [s - corner, corner, x + w - corner, corner],
  ] as const;
  const rows = [
    [0, corner, y, corner],
    [corner, s - 2 * corner, y + corner, h - 2 * corner],
    [s - corner, corner, y + h - corner, corner],
  ] as const;
  for (const [sx, sw, dx, dw] of cols)
    for (const [sy, sh, dy, dh] of rows)
      if (dw > 0 && dh > 0) ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/** A ribbon (192x64, 3-slice) `w` wide centred on cx, with its text. */
export function ribbon(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  text: string,
  cx: number,
  y: number,
  w: number,
  ink: string,
): void {
  const x = Math.round(cx - w / 2);
  ctx.drawImage(img, 0, 0, 64, 64, x, y, 64, 64);
  ctx.drawImage(img, 64, 0, 64, 64, x + 64, y, w - 128, 64);
  ctx.drawImage(img, 128, 0, 64, 64, x + w - 64, y, 64, 64);
  ctx.save();
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.fillText(text, cx, y + 27, w - 70);
  ctx.restore();
}

/** Whether (px, py) falls in a rectangle. */
export const inside = (r: Rect, px: number, py: number) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The gold outline round whatever the pointer is over, on every building page. */
export function highlight(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.save();
  ctx.strokeStyle = '#ffcc33';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, 10);
  ctx.stroke();
  ctx.restore();
}

/** A dark name plate with a blue rim, centred on `cx` with its top at `y`. */
export function plate(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number): void {
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
