import { replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import { ago } from './panels.tsx';
import { BUILDINGS, heroColors, heroPositions, hitTest, walkerPosition } from './village.ts';

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
