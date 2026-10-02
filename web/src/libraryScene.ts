import {
  type GuildState,
  type Hero,
  type LibrarianState,
  librarianState,
  librariansIn,
  roleName,
} from '@agent-guild/core';

import {
  type Art,
  type Rect,
  FRAMES,
  frameAt,
  grass,
  highlight,
  inside,
  nine,
  put,
  ribbon,
  terrain,
} from './scene.ts';
import { bubble } from './village.ts';

/**
 * The Library page's scene: the Library on its stone terrace, the Scout's lookout and the
 * Reviewer's study either side, and a sand courtyard where the librarians work. The Scout
 * scries for new skills at a crystal orb that glows while it searches; the Reviewer reads
 * at a lectern whose pages turn; the Archive is a carved board holding a parchment note
 * for each skill waiting for the user; gold sacks count the skills installed.
 *
 * `libraryModel` and `libraryPick` are pure, so tests can check what is shown and what a
 * click lands on without a canvas.
 */

export const ROLES = ['Scout', 'Reviewer'] as const;
export type Role = (typeof ROLES)[number];

export interface Seat {
  role: Role;
  hero: Hero | undefined;
  state: LibrarianState | 'away';
}

export interface WaitingSkill {
  id: string;
  name: string;
  verdict: 'gap' | 'better' | 'duplicate' | 'risky' | null;
}

/** What the Archive holds, when the page can read it (live mode). */
export interface ArchiveView {
  waiting: WaitingSkill[];
  installed: number;
}

export interface LibraryModel {
  seats: Seat[];
  archive: ArchiveView | null;
}

/** The newest librarian of each role takes its station. */
export function librarySeats(state: GuildState): Seat[] {
  const present = librariansIn(state);
  return ROLES.map((role) => {
    const hero = present.find((h) => roleName(h.name) === role);
    return { role, hero, state: hero ? librarianState(hero) : 'away' };
  });
}

export function libraryModel(state: GuildState, archive: ArchiveView | null): LibraryModel {
  return { seats: librarySeats(state), archive };
}

/** Where each librarian stands: feet at (x, base). The Reviewer faces left, to its lectern. */
export const STATIONS: Record<Role, { x: number; base: number; flip: boolean }> = {
  Scout: { x: 300, base: 430, flip: false },
  Reviewer: { x: 860, base: 430, flip: true },
};

/** The Archive board, and the slots for parchment notes on it. */
export const BOARD: Rect = { x: 410, y: 490, w: 300, h: 170 };
export const NOTE_SLOTS: Rect[] = [0, 1, 2].map((k) => ({ x: 428 + k * 92, y: 520, w: 84, h: 100 }));

/** A librarian's clickable area: its bubble, its body and its name ribbon. */
export const seatRect = (role: Role): Rect => ({
  x: STATIONS[role].x - 45,
  y: STATIONS[role].base - 150,
  w: 90,
  h: 175,
});

/** The notes on the board: up to three skills, or two and a "+N more" note. */
export function boardNotes(archive: ArchiveView | null): (WaitingSkill | { more: number })[] {
  if (!archive) return [];
  const { waiting } = archive;
  if (waiting.length <= NOTE_SLOTS.length) return waiting;
  return [...waiting.slice(0, NOTE_SLOTS.length - 1), { more: waiting.length - (NOTE_SLOTS.length - 1) }];
}

export type ScenePick =
  { kind: 'librarian'; role: Role; id: string } | { kind: 'skill'; id: string } | { kind: 'archive' };

/** What a click at (px, py) on the scene lands on. Away librarians are not there to click. */
export function libraryPick(model: LibraryModel, px: number, py: number): ScenePick | null {
  for (const seat of model.seats)
    if (seat.hero && inside(seatRect(seat.role), px, py))
      return { kind: 'librarian', role: seat.role, id: seat.hero.id };
  const notes = boardNotes(model.archive);
  for (const [i, note] of notes.entries())
    if (inside(NOTE_SLOTS[i]!, px, py))
      return 'more' in note ? { kind: 'archive' } : { kind: 'skill', id: note.id };
  if (inside({ ...BOARD, y: BOARD.y - 40, h: BOARD.h + 40 }, px, py)) return { kind: 'archive' };
  return null;
}

export const samePick = (a: ScenePick | null, b: ScenePick | null) =>
  a?.kind === b?.kind && JSON.stringify(a) === JSON.stringify(b);

/** A sentence for screen readers: what the picture shows. */
export function describeScene(model: LibraryModel): string {
  const who = model.seats.map((s) =>
    s.state === 'away'
      ? `the ${s.role} is away`
      : `the ${s.role} is ${s.state === 'working' ? 'at work' : s.state === 'needs_you' ? 'waiting for you' : 'resting'}`,
  );
  const n = model.archive?.waiting.length ?? 0;
  const archive = model.archive
    ? `; ${n} ${n === 1 ? 'skill waits' : 'skills wait'} for you on the Archive board`
    : '';
  return `The Library: ${who.join(', ')}${archive}.`;
}

const GOLD_SPOTS: readonly [number, number][] = [
  [760, 630],
  [800, 640],
  [840, 628],
  [736, 652],
  [880, 646],
  [816, 664],
];

const TREES: readonly [number, number][] = [
  [60, 250],
  [1060, 230],
  [40, 700],
  [1090, 700],
  [760, 140],
  [330, 150],
];

const VERDICT_INK: Record<NonNullable<WaitingSkill['verdict']>, string> = {
  gap: '#2e7d32',
  better: '#2e7d32',
  duplicate: '#7a7466',
  risky: '#b22828',
};

const INK = '#3c2410';

export function drawLibraryScene(
  ctx: CanvasRenderingContext2D,
  art: Art,
  model: LibraryModel,
  nowMs: number,
  hovered: ScenePick | null = null,
): void {
  ctx.imageSmoothingEnabled = false;
  const seat = (role: Role) => model.seats.find((s) => s.role === role)!;
  const scout = seat('Scout');
  const reviewer = seat('Reviewer');
  const anyoneWorking = model.seats.some((s) => s.state === 'working');

  // Ground: grass, the stone terrace the Library stands on, the sand courtyard.
  grass(ctx, art);
  terrain(ctx, art.stone, { col: 0, row: 0 }, 384, 60, 6, 3, true);
  terrain(ctx, art.grass, { col: 5, row: 0 }, 96, 330, 15, 5);

  // Everything standing is drawn back to front by its feet.
  const tree = { x: 0, y: 0, w: 192, h: 192 };
  const things: [number, () => void][] = [
    ...TREES.map(([x, y]): [number, () => void] => [y, () => put(ctx, art.tree, x, y, { crop: tree })]),
    [262, () => put(ctx, art.library, 576, 262, { scale: 0.85 })],
    [245, () => put(ctx, art.bookshelfSmall, 455, 245)],
    [245, () => put(ctx, art.bookshelfSmall, 700, 245)],
    [262, () => put(ctx, art.bookStack, 640, 262)],
    [330, () => put(ctx, art.towerPurple, 190, 330)],
    [330, () => put(ctx, art.housePurple, 960, 330)],
    [420, () => put(ctx, art.signpost, 200, 420)],
    [250, () => put(ctx, art.bushBig, 300, 250)],
    [260, () => put(ctx, art.bush, 860, 260)],
    [300, () => put(ctx, art.fern, 700, 300)],
    [300, () => put(ctx, art.sprout, 480, 300)],
    [470, () => put(ctx, art.mushroomSmall, 120, 470)],
    [470, () => put(ctx, art.rock, 1010, 470)],
    [560, () => put(ctx, art.mushroom, 1060, 560)],
    [700, () => put(ctx, art.bookshelf, 170, 700)],
    [640, () => put(ctx, art.scrolls, 1060, 640)],
    [450, () => put(ctx, art.bookStack, 1010, 450)],
    // The Scout's orb glows while it searches; the Reviewer's pages turn while it reads.
    [
      430,
      () =>
        put(ctx, art.orb, 405, 430, {
          frames: FRAMES.orb,
          frame: scout.state === 'working' ? 1 + frameAt(5, nowMs, 160) : 0,
        }),
    ],
    [
      430,
      () =>
        put(ctx, art.lectern, 760, 430, {
          frames: FRAMES.lectern,
          frame: reviewer.state === 'working' ? frameAt(4, nowMs, 260) : 0,
        }),
    ],
    // The campfire burns while anyone is at work.
    [
      700,
      () => {
        put(ctx, art.logs, 300, 700);
        if (anyoneWorking)
          put(ctx, art.fire, 300, 680, { frames: FRAMES.fire, frame: frameAt(7, nowMs, 100) });
      },
    ],
    // Installed skills: a sack of gold each, up to six.
    ...GOLD_SPOTS.slice(0, Math.min(model.archive?.installed ?? 0, GOLD_SPOTS.length)).map(
      ([x, y]): [number, () => void] => [y, () => put(ctx, art.gold, x, y)],
    ),
    [BOARD.y + BOARD.h, () => drawBoard(ctx, art, model, hovered)],
    ...model.seats
      .filter((s) => s.hero)
      .map((s): [number, () => void] => [STATIONS[s.role].base, () => drawLibrarian(ctx, art, s, nowMs)]),
  ];
  things.sort((a, b) => a[0] - b[0]).forEach(([, draw]) => draw());

  // Signs over everything: who is where, and what the Archive holds.
  for (const s of model.seats) {
    const { x, base } = STATIONS[s.role];
    const away = s.state === 'away';
    ribbon(
      ctx,
      away ? art.ribbonBlue : s.state === 'needs_you' ? art.ribbonRed : art.ribbonYellow,
      away ? `${s.role} · away` : s.role,
      x,
      base - 34,
      away ? 200 : 180,
      away || s.state === 'needs_you' ? '#ffffff' : '#281800',
    );
    if (!away)
      bubble(
        ctx,
        x,
        base - 100,
        s.state === 'working' ? 'work' : s.state === 'needs_you' ? 'alert' : 'sleep',
        1.1,
        nowMs,
      );
    if (hovered?.kind === 'librarian' && hovered.role === s.role) highlight(ctx, seatRect(s.role));
  }
  const waiting = model.archive?.waiting.length ?? 0;
  ribbon(
    ctx,
    art.ribbonRed,
    model.archive ? (waiting > 0 ? `The Archive · ${waiting} wait for you` : 'The Archive') : 'The Archive',
    BOARD.x + BOARD.w / 2,
    BOARD.y - 40,
    300,
    '#ffffff',
  );
}

function drawLibrarian(ctx: CanvasRenderingContext2D, art: Art, s: Seat, nowMs: number): void {
  const { x, base, flip } = STATIONS[s.role];
  // At work it shifts on its feet (the idle animation); resting or waiting, it stands still.
  const frame = s.state === 'working' ? frameAt(6, nowMs, 110) : 0;
  put(ctx, art.pawnPurple, x, base, { crop: { x: 0, y: 0, w: 192, h: 192 }, frame, flip });
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  art: Art,
  model: LibraryModel,
  hovered: ScenePick | null,
): void {
  nine(ctx, art.board, BOARD.x, BOARD.y, BOARD.w, BOARD.h);
  const notes = boardNotes(model.archive);
  if (model.archive && notes.length === 0) {
    ctx.save();
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.fillText('Nothing waiting', BOARD.x + BOARD.w / 2, BOARD.y + BOARD.h / 2 + 6);
    ctx.restore();
    return;
  }
  notes.forEach((note, i) => {
    const r = NOTE_SLOTS[i]!;
    // The parchment banner without its outer margin, as a pinned note.
    ctx.drawImage(art.parchment, 8, 8, 176, 176, r.x, r.y, r.w, r.h);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    const cx = r.x + r.w / 2;
    if ('more' in note) {
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.fillText(`+${note.more}`, cx, r.y + 50);
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText('more', cx, r.y + 66);
    } else {
      ctx.fillStyle = note.verdict ? VERDICT_INK[note.verdict] : '#7a7466';
      ctx.strokeStyle = '#281800';
      ctx.beginPath();
      ctx.arc(cx, r.y + 30, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = '700 11px system-ui, sans-serif';
      const [first, ...rest] = note.name.split('-');
      ctx.fillText(first ?? '', cx, r.y + 54, r.w - 16);
      if (rest.length) ctx.fillText(rest.join('-'), cx, r.y + 69, r.w - 16);
    }
    ctx.restore();
    const pick = 'more' in note ? null : note.id;
    if (pick && hovered?.kind === 'skill' && hovered.id === pick) highlight(ctx, r);
  });
}
