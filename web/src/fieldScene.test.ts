import { replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import type { WarInfo } from './api.ts';
import {
  type FieldKnight,
  describeField,
  duelSlots,
  enemyFor,
  fieldKnights,
  fieldModel,
  fieldPick,
  knightRect,
  seedOf,
} from './fieldScene.ts';
import type { Sprites } from './village.ts';
import { warMood } from './warScene.ts';

const sprites: Sprites = { grass: null!, tree: null!, buildings: {}, units: {} };
const knight = (id: string, active = false): FieldKnight => ({
  id,
  name: id.toUpperCase(),
  active,
  needsYou: false,
  battle: null,
});
const war = (over: Partial<WarInfo> = {}): WarInfo => ({
  id: 'w1',
  name: 'Siege',
  goal: '',
  banner: 'Blue',
  folder: 'castle',
  archived: false,
  problem: null,
  defaultBranch: 'main',
  gh: true,
  battles: [],
  knights: [],
  victories: 0,
  tokens: 0,
  looseEnds: { unpushed: 0, dirty: 0 },
  ...over,
});
const centre = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;

describe('the battlefield', () => {
  it('draws each Knight the same enemy every time, never in its own colour or gold', () => {
    expect(enemyFor('session-a', 'Blue')).toEqual(enemyFor('session-a', 'Blue'));
    expect(seedOf('a')).not.toBe(seedOf('b'));
    const foes = Array.from({ length: 60 }, (_, i) => enemyFor(`session-${i}`, 'Red'));
    expect(foes.some((f) => f.team === 'Red' || f.team === 'Gold')).toBe(false);
    // Random enough: many names, both kinds of unit, several colours.
    expect(new Set(foes.map((f) => f.name)).size).toBeGreaterThan(20);
    expect(new Set(foes.map((f) => f.unit))).toEqual(new Set(['Warrior', 'Pawn']));
    expect(new Set(foes.map((f) => f.team)).size).toBeGreaterThan(3);
  });

  it('puts working Knights on the field first, six at most, and counts the rest', () => {
    const knights = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => knight(id, id === 'h'));
    const model = fieldModel('Blue', knights, sprites);
    expect(model.duels).toHaveLength(6);
    expect(model.duels[0]!.knight.id).toBe('h');
    expect(model.more).toBe(2);
    expect(new Set(model.duels.map((d) => `${d.x},${d.y}`)).size).toBe(6);
  });

  it('centres a lone duel and spreads more over two columns', () => {
    expect(duelSlots(0)).toEqual([]);
    const [lone] = duelSlots(1);
    expect(lone![0] + 75).toBe(560);
    expect(duelSlots(3).map(([x]) => x)).toEqual([250, 700, 250]);
    expect(duelSlots(9)).toHaveLength(6);
  });

  it('picks a Knight by its body, and nothing on open ground', () => {
    const model = fieldModel('Blue', [knight('a'), knight('b')], sprites);
    expect(fieldPick(model, ...centre(knightRect(model.duels[1]!)))).toEqual({ kind: 'knight', id: 'b' });
    expect(fieldPick(model, 5, 5)).toBeNull();
  });

  it('describes the duels for screen readers', () => {
    expect(describeField(fieldModel('Blue', [], sprites))).toMatch(/quiet/);
    const model = fieldModel('Blue', [knight('a', true)], sprites);
    expect(describeField(model)).toBe(`The battlefield: A fights ${model.duels[0]!.enemy.name}.`);
  });
});

describe('the list of wars', () => {
  it('tells active, sleeping and ended wars apart', () => {
    const fighting = { branch: 'feat/x', state: 'fighting' } as WarInfo['battles'][number];
    const holding = { branch: 'feat/y', state: 'holding' } as WarInfo['battles'][number];
    expect(warMood(war({ battles: [holding, fighting] }))).toBe('active');
    expect(warMood(war({ battles: [holding] }))).toBe('sleeping');
    expect(warMood(war({ archived: true, battles: [fighting] }))).toBe('ended');
  });

  it("finds a war's Knights in the guild, leaving out those gone", () => {
    const state = replay([
      { t: 0, session: 'k1', type: 'session_start', name: 'Tristan' },
      { t: 1, session: 'k1', type: 'tool', tool: 'Edit' },
      { t: 2, session: 'k2', type: 'session_start', name: 'Isolde' },
      { t: 3, session: 'k2', type: 'stop' },
      { t: 4, session: 'k3', type: 'session_start', name: 'Gone' },
      { t: 5, session: 'k3', type: 'session_end' },
    ]);
    const knights = fieldKnights(
      state,
      war({
        knights: ['k1', 'k2', 'k3', 'unknown'],
        battles: [
          {
            branch: 'feat/x',
            state: 'fighting',
            knights: [{ id: 'k1', name: 'Tristan', active: true }],
          } as WarInfo['battles'][number],
        ],
      }),
    );
    expect(knights.map((k) => [k.name, k.active, k.battle])).toEqual([
      ['Tristan', true, 'feat/x'],
      ['Isolde', false, null],
    ]);
  });
});
