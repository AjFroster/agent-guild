import { type GuildEvent, replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import {
  type ArchiveView,
  BOARD,
  NOTE_SLOTS,
  boardNotes,
  describeScene,
  libraryModel,
  libraryPick,
  librarySeats,
  seatRect,
} from './libraryScene.ts';

const librarian = (id: string, name: string, t = 0): GuildEvent[] => [
  { t, session: id, type: 'session_start', name },
  { t, session: id, type: 'librarian' },
];
const centre = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;
const skill = (n: number) => ({ id: `id${n}`, name: `skill-${n}`, verdict: 'gap' as const });

describe('the Library scene', () => {
  const state = replay([
    ...librarian('old-scout', 'Scout'),
    { t: 1, session: 'old-scout', type: 'stop' },
    ...librarian('scout', 'Scout', 2),
    { t: 3, session: 'scout', type: 'tool', tool: 'WebSearch' },
    { t: 4, session: 'knight', type: 'session_start', name: 'Percival' },
  ]);

  it('seats the newest librarian of each role, and marks an empty station away', () => {
    const seats = librarySeats(state);
    expect(seats.map((s) => [s.role, s.hero?.id ?? null, s.state])).toEqual([
      ['Scout', 'scout', 'working'],
      ['Reviewer', null, 'away'],
    ]);
  });

  it('pins up to three skills to the board, folding the rest into "+N more"', () => {
    const archive = (n: number): ArchiveView => ({
      waiting: Array.from({ length: n }, (_, i) => skill(i)),
      installed: 0,
    });
    expect(boardNotes(null)).toEqual([]);
    expect(boardNotes(archive(3))).toHaveLength(3);
    expect(boardNotes(archive(5))).toEqual([skill(0), skill(1), { more: 3 }]);
  });

  it('says what a click lands on: a librarian, a skill, the board, or nothing', () => {
    const model = libraryModel(state, { waiting: [skill(1), skill(2)], installed: 2 });
    expect(libraryPick(model, ...centre(seatRect('Scout')))).toEqual({
      kind: 'librarian',
      role: 'Scout',
      id: 'scout',
    });
    // Nobody at the Reviewer's station to click.
    expect(libraryPick(model, ...centre(seatRect('Reviewer')))).toBeNull();
    expect(libraryPick(model, ...centre(NOTE_SLOTS[1]!))).toEqual({ kind: 'skill', id: 'id2' });
    expect(libraryPick(model, ...centre(NOTE_SLOTS[2]!))).toEqual({ kind: 'archive' }); // an empty slot
    expect(libraryPick(model, BOARD.x + 10, BOARD.y + BOARD.h - 10)).toEqual({ kind: 'archive' });
    expect(libraryPick(model, 20, 20)).toBeNull();
  });

  it('describes itself for screen readers', () => {
    expect(describeScene(libraryModel(state, { waiting: [skill(1)], installed: 0 }))).toBe(
      'The Library: the Scout is at work, the Reviewer is away; 1 skill waits for you on the Archive board.',
    );
  });
});
