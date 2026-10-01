import { replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import { BUILDINGS, heroColors, heroPositions, walkerPosition } from './village.ts';

const party = replay([
  { t: 0, session: 'a', type: 'session_start', name: 'A' },
  { t: 1, session: 'a1', type: 'subagent_start', parent: 'a', name: 'A1' },
  { t: 2, session: 'b', type: 'session_start', name: 'B' },
]);

describe('heroColors', () => {
  it('gives each leader its own colour and a party member its leader’s', () => {
    const colors = heroColors(party);
    expect(colors.get('a')).toBe('Blue');
    expect(colors.get('a1')).toBe('Blue');
    expect(colors.get('b')).toBe('Red');
  });
});

describe('heroPositions', () => {
  it('stands heroes in a row below their building, centred on it', () => {
    const positions = heroPositions(party); // all three at the guildhall
    const xs = ['a', 'a1', 'b'].map((id) => positions.get(id)!.x);
    expect(xs[1]).toBe(BUILDINGS.guildhall.x);
    expect(xs[0]! + xs[2]!).toBe(2 * BUILDINGS.guildhall.x);
    for (const id of ['a', 'a1', 'b']) expect(positions.get(id)!.y).toBeGreaterThan(BUILDINGS.guildhall.y);
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
