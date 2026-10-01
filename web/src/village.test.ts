import { replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import { ago } from './panels.tsx';
import {
  BARRACKS,
  BUILDINGS,
  ROWS,
  bedPlaces,
  bubbleFor,
  isFighting,
  swingFrame,
  shorten,
  THRONE,
  VILLAGE_HEIGHT,
  hslToRgb,
  heroPositions,
  heroTeams,
  hitTest,
  recolor,
  rgbToHsl,
  walkerPosition,
} from './village.ts';

// Everyone busy at the guildhall (TodoWrite keeps a hero there), so nobody is in bed.
const party = replay([
  { t: 0, session: 'a', type: 'session_start', name: 'A' },
  { t: 1, session: 'a1', type: 'subagent_start', parent: 'a', name: 'A1' },
  { t: 2, session: 'b', type: 'session_start', name: 'B' },
  { t: 3, session: 'a', type: 'tool', tool: 'TodoWrite' },
  { t: 3, session: 'a1', type: 'tool', tool: 'TodoWrite' },
  { t: 3, session: 'b', type: 'tool', tool: 'TodoWrite' },
]);

describe('heroTeams', () => {
  it('gives each Knight its own colour, its party the same, and the King gold', () => {
    const state = replay([
      ...Array.from({ length: 7 }, (_, i) => ({
        t: i,
        session: `k${i}`,
        type: 'session_start' as const,
        name: `K${i}`,
      })),
      { t: 8, session: 'k0-sub', type: 'subagent_start', parent: 'k0', name: 'Sub' },
      { t: 9, session: 'king', type: 'session_start', name: 'King' },
      { t: 9, session: 'king', type: 'crown' },
    ]);
    const teams = heroTeams(state);
    const knights = Array.from({ length: 7 }, (_, i) => teams.get(`k${i}`));
    expect(new Set(knights).size).toBe(7); // no two Knights share a colour
    expect(knights).not.toContain('Gold');
    expect(teams.get('k0-sub')).toBe(teams.get('k0'));
    expect(teams.get('king')).toBe('Gold');
  });

  it("keeps a Knight's colour when others come and go", () => {
    const alone = heroTeams(replay([{ t: 0, session: 'b', type: 'session_start', name: 'B' }]));
    expect(heroTeams(party).get('b')).toBe(alone.get('b'));
  });
});

describe('heroPositions', () => {
  it('stands leaders in a row below their building, centred on it', () => {
    const positions = heroPositions(party); // A and B at the guildhall
    const [a, b] = ['a', 'b'].map((id) => positions.get(id)!);
    expect(a!.x + b!.x).toBe(2 * ROWS.guildhall.x);
    expect(a!.y).toBeGreaterThan(BUILDINGS.guildhall.y);
  });

  it('keeps the King on his throne whatever tools he uses', () => {
    const state = replay([
      { t: 0, session: 'k', type: 'session_start', name: 'King' },
      { t: 0, session: 'k', type: 'crown' },
      { t: 1, session: 'k', type: 'tool', tool: 'Read' },
    ]);
    expect(heroPositions(state).get('k')).toEqual({ ...THRONE, pose: 'stand' });
  });

  it('keeps a crowd of resting Knights on the map', () => {
    const crowd = replay(
      Array.from({ length: 14 }, (_, i) => ({
        t: i,
        session: `k${i}`,
        type: 'session_start' as const,
        name: `K${i}`,
      })),
    );
    for (const p of heroPositions(crowd).values()) expect(p.y).toBeLessThanOrEqual(VILLAGE_HEIGHT - 16);
  });

  it('puts a resting Knight to bed in the Barracks, its party asleep at the foot', () => {
    const state = replay([
      { t: 0, session: 'a', type: 'session_start', name: 'A' },
      { t: 1, session: 'a1', type: 'subagent_start', parent: 'a', name: 'A1' },
      { t: 2, session: 'a', type: 'stop' },
    ]);
    const positions = heroPositions(state);
    const a = positions.get('a')!;
    const a1 = positions.get('a1')!;
    expect(a.pose).toBe('sleep');
    expect(a1.pose).toBe('sleep');
    for (const p of [a, a1]) {
      expect(p.x).toBeGreaterThan(BARRACKS.left);
      expect(p.x).toBeLessThan(BARRACKS.right);
      expect(p.y).toBeGreaterThan(BARRACKS.top);
      expect(p.y).toBeLessThan(BARRACKS.bottom);
    }
    expect(a1.y).toBeGreaterThan(a.y);
  });

  it('gives every sleeper its own bed, inside the camp, however many there are', () => {
    for (const n of [1, 3, 9, 15]) {
      const beds = bedPlaces(n);
      expect(new Set(beds.map((b) => `${b.x},${b.y}`)).size).toBe(n);
      for (const b of beds) expect(b.y).toBeLessThan(BARRACKS.bottom - 20);
    }
  });

  it('sends a Knight just given an order before the throne, facing the King, then to work', () => {
    const state = replay([
      { t: 0, session: 'a', type: 'session_start', name: 'A' },
      { t: 1, session: 'a', type: 'stop' },
      { t: 100, session: 'a', type: 'ordered' },
      { t: 100.5, session: 'a', type: 'tool', tool: 'Edit' },
    ]);
    const hearing = heroPositions(state, 102).get('a')!;
    expect(Math.abs(hearing.x - THRONE.x)).toBeLessThan(200);
    expect(Math.abs(hearing.y - THRONE.y)).toBeLessThan(100);
    expect(hearing.face).toBe(hearing.x > THRONE.x ? 'left' : 'right');
    // Four seconds on, it is at the Forge for the Edit it already started.
    const working = heroPositions(state, 105).get('a')!;
    expect(working).toMatchObject({ x: BUILDINGS.forge.x, pose: 'stand' });
    // With no clock (live Talk buttons, old callers), no audience.
    expect(heroPositions(state).get('a')!.x).toBe(BUILDINGS.forge.x);
  });

  it('stands a follower behind its leader, wherever the leader is', () => {
    const moved = replay([
      { t: 0, session: 'a', type: 'session_start', name: 'A' },
      { t: 1, session: 'a1', type: 'subagent_start', parent: 'a', name: 'A1' },
      { t: 2, session: 'a', type: 'tool', tool: 'Edit' },
      { t: 3, session: 'a1', type: 'tool', tool: 'Grep' }, // the follower reads; it still follows
    ]);
    const positions = heroPositions(moved);
    const a = positions.get('a')!;
    const a1 = positions.get('a1')!;
    expect(a.x).toBe(BUILDINGS.forge.x);
    expect(a1.y).toBeLessThan(a.y);
    expect(Math.abs(a1.x - a.x)).toBeLessThan(70);
  });
});

describe('recolor', () => {
  const pixel = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255]);
  const shift = { delta: 125, saturation: 1, lightness: 1 };

  it('turns red cloth to the new hue', () => {
    const px = pixel(200, 40, 40);
    recolor(px, shift);
    const [h] = rgbToHsl(px[0]!, px[1]!, px[2]!);
    expect(Math.round(h)).toBe(125);
  });

  it('leaves skin, steel and see-through pixels alone', () => {
    for (const [r, g, b] of [
      [232, 170, 120], // skin
      [70, 90, 130], // steel blue armour
      [128, 128, 128], // grey
    ] as const) {
      const px = pixel(r, g, b);
      recolor(px, shift);
      expect([...px]).toEqual([r, g, b, 255]);
    }
    const clear = new Uint8ClampedArray([200, 40, 40, 0]);
    recolor(clear, shift);
    expect([...clear]).toEqual([200, 40, 40, 0]);
  });

  it('converts between RGB and HSL without drift', () => {
    const samples: [number, number, number][] = [
      [200, 40, 40],
      [58, 166, 201],
      [10, 200, 90],
    ];
    for (const [r, g, b] of samples) expect(hslToRgb(...rgbToHsl(r, g, b))).toEqual([r, g, b]);
  });
});

describe('walkerPosition', () => {
  const walker = { fromX: 0, fromY: 0, toX: 240, toY: 0, startMs: 1000 };

  it('moves at a fixed speed and faces the way it walks', () => {
    expect(walkerPosition(walker, 1500)).toEqual({ x: 120, y: 0, moving: true, left: false });
    expect(walkerPosition({ ...walker, fromX: 240, toX: 0 }, 1500).left).toBe(true);
  });

  it('stops exactly on the target and never overshoots', () => {
    expect(walkerPosition(walker, 99_999)).toEqual({ x: 240, y: 0, moving: false, left: false });
  });

  it('treats a zero-length walk as already arrived', () => {
    expect(walkerPosition({ ...walker, toX: 0 }, 1000).moving).toBe(false);
  });
});

describe('hitTest', () => {
  const none = new Map();

  it('finds a hero by its body and its name tag', () => {
    const at = heroPositions(party).get('a')!;
    expect(hitTest(party, none, 0, at.x, at.y - 30)).toEqual({ kind: 'hero', id: 'a' });
    expect(hitTest(party, none, 0, at.x, at.y + 15)).toEqual({ kind: 'hero', id: 'a' });
  });

  it('finds a building by its art and its label, and nothing on open grass', () => {
    const forge = BUILDINGS.forge;
    expect(hitTest(party, none, 0, forge.x, forge.y - 60)).toEqual({ kind: 'building', id: 'forge' });
    expect(hitTest(party, none, 0, forge.x, forge.y + 12)).toEqual({ kind: 'building', id: 'forge' });
    expect(hitTest(party, none, 0, 300, 250)).toBeNull();
  });

  it('picks a smaller follower by its own, smaller body', () => {
    const at = heroPositions(party).get('a1')!;
    expect(hitTest(party, new Map(), 0, at.x, at.y - 20)).toEqual({ kind: 'hero', id: 'a1' });
    expect(hitTest(party, new Map(), 0, at.x, at.y - 55)).not.toEqual({ kind: 'hero', id: 'a1' });
  });

  it('finds a sleeper lying across its bed', () => {
    const asleep = replay([
      { t: 0, session: 's', type: 'session_start', name: 'S' },
      { t: 1, session: 's', type: 'stop' },
    ]);
    const bed = heroPositions(asleep).get('s')!;
    expect(hitTest(asleep, new Map(), 0, bed.x + 25, bed.y)).toEqual({ kind: 'hero', id: 's' });
    expect(hitTest(asleep, new Map(), 0, bed.x, bed.y - 50)).toBeNull();
  });

  it('follows a hero part way along a walk', () => {
    const walkers = new Map([['b', { fromX: 100, fromY: 300, toX: 340, toY: 300, startMs: 0 }]]);
    expect(hitTest(party, walkers, 500, 220, 280)).toEqual({ kind: 'hero', id: 'b' });
  });
});

describe('ago', () => {
  it('reads like a person would say it', () => {
    expect(ago(3)).toBe('just now');
    expect(ago(42)).toBe('42s ago');
    expect(ago(5 * 60 + 9)).toBe('5 min ago');
    expect(ago(3 * 3600)).toBe('3 h ago');
    expect(ago(-5)).toBe('just now');
  });
});

describe('bubbleFor', () => {
  const state = replay([
    { t: 0, session: 'w', type: 'session_start', name: 'W' },
    { t: 1, session: 'w', type: 'tool', tool: 'Edit' },
    { t: 0, session: 'q', type: 'session_start', name: 'Q' },
    { t: 1, session: 'q', type: 'needs_input' },
    { t: 0, session: 'r', type: 'session_start', name: 'R' },
    { t: 1, session: 'r', type: 'stop' },
  ]);

  it('shows "!" to a hero waiting on the user, "zzz" to a resting one, and nothing to a worker', () => {
    expect(bubbleFor(state.heroes.q!)).toBe('alert');
    expect(bubbleFor(state.heroes.r!)).toBe('sleep');
    expect(bubbleFor(state.heroes.w!)).toBeNull();
  });
});

describe('shorten', () => {
  it('keeps short text, and cuts long text at a word with an ellipsis', () => {
    expect(shorten('Add tests', 28)).toBe('Add tests');
    expect(shorten('Build the standings page with filters by season', 28)).toBe('Build the standings page…');
    expect(shorten('Supercalifragilisticexpialidocious', 10)).toBe('Supercali…');
  });
});

describe('the training yard', () => {
  const state = replay([
    { t: 0, session: 'w', type: 'session_start', name: 'W' },
    { t: 1, session: 'w', type: 'tool', tool: 'Edit' },
    { t: 0, session: 'q', type: 'session_start', name: 'Q' },
    { t: 1, session: 'q', type: 'needs_input' },
    { t: 0, session: 'k', type: 'session_start', name: 'K' },
    { t: 0, session: 'k', type: 'crown' },
    { t: 1, session: 'k', type: 'tool', tool: 'Read' },
  ]);

  it('sets a hero fighting only while it works and stands still, and never the King', () => {
    expect(isFighting(state.heroes.w!, false)).toBe(true);
    expect(isFighting(state.heroes.w!, true)).toBe(false); // still walking to its post
    expect(isFighting(state.heroes.q!, false)).toBe(false); // waiting on the user
    expect(isFighting(state.heroes.k!, false)).toBe(false);
  });

  it('runs each swing through all six frames, out of step between heroes', () => {
    const frames = Array.from({ length: 6 }, (_, i) => swingFrame('hero-a', i * 105));
    expect(new Set(frames).size).toBe(6);
    const starts = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => swingFrame(id, 0));
    expect(new Set(starts).size).toBeGreaterThan(1);
  });
});
