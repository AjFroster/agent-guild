import { replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import type { WarInfo } from './api.ts';
import {
  type DuelKnight,
  GOBLIN_COLOURS,
  GOBLIN_KINDS,
  type GoblinArt,
  goblinFor,
  goblinsFor,
  health,
  knightRect,
  seedOf,
  warKnights,
} from './duel.ts';
import { describeField, duelSlots, fieldModel, fieldPick } from './fieldScene.ts';
import type { Sprites } from './village.ts';

const sprites: Sprites = { grass: null!, tree: null!, buildings: {}, units: {} };
const goblins: GoblinArt = { sheets: {}, house: null!, tower: null! };
const knight = (id: string, active = false, quests = { done: 0, total: 0 }): DuelKnight => ({
  id,
  name: id.toUpperCase(),
  banner: 'Blue',
  active,
  needsYou: false,
  battle: null,
  quests,
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

describe('a duel with a goblin', () => {
  it('gives each Knight the same goblin every time, from every kind and colour in the pack', () => {
    expect(goblinFor('session-a')).toEqual(goblinFor('session-a'));
    expect(seedOf('a')).not.toBe(seedOf('b'));
    const foes = Array.from({ length: 80 }, (_, i) => goblinFor(`session-${i}`));
    expect(new Set(foes.map((f) => f.kind))).toEqual(new Set(GOBLIN_KINDS));
    expect(new Set(foes.map((f) => f.colour))).toEqual(new Set(GOBLIN_COLOURS));
    expect(new Set(foes.map((f) => f.name)).size).toBeGreaterThan(12);
  });

  it('never puts two goblins of the same name on one field', () => {
    const ids = Array.from({ length: 18 }, (_, i) => `session-${i}`);
    const foes = goblinsFor(ids);
    expect(new Set(foes.map((f) => f.name)).size).toBe(18);
    // The first keeps its own goblin; a clash only renames the later one.
    expect(foes[0]).toEqual(goblinFor('session-0'));
    expect(foes.map((f) => f.kind)).toEqual(ids.map((id) => goblinFor(id).kind));
  });

  it("measures the goblin's health in the Knight's quests still to do", () => {
    expect(health(knight('a', true, { done: 2, total: 5 }))).toEqual({ left: 0.6, label: 'quests 2/5' });
    expect(health(knight('a', true, { done: 4, total: 4 }))).toEqual({ left: 0, label: 'quests 4/4' });
    // No quests yet: no bar. A resting Knight's goblin is untouched.
    expect(health(knight('a', true))).toBeNull();
    expect(health(knight('a', false, { done: 1, total: 3 }))).toEqual({ left: 1, label: 'resting' });
  });

  it("finds a war's Knights in the guild with their quests, leaving out those gone", () => {
    const state = replay([
      { t: 0, session: 'k1', type: 'session_start', name: 'Tristan' },
      { t: 1, session: 'k1', type: 'tool', tool: 'Edit' },
      {
        t: 2,
        session: 'k1',
        type: 'todos',
        todos: [
          { id: '1', title: 'Raise the gate', status: 'completed' },
          { id: '2', title: 'Hang the banner', status: 'in_progress' },
        ],
      },
      { t: 3, session: 'k2', type: 'session_start', name: 'Isolde' },
      { t: 4, session: 'k2', type: 'stop' },
      { t: 5, session: 'k3', type: 'session_start', name: 'Gone' },
      { t: 6, session: 'k3', type: 'session_end' },
    ]);
    const knights = warKnights(
      state,
      war({
        banner: 'Red',
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
    expect(knights.map((k) => [k.name, k.banner, k.active, k.battle, k.quests])).toEqual([
      ['Tristan', 'Red', true, 'feat/x', { done: 1, total: 2 }],
      ['Isolde', 'Red', false, null, { done: 0, total: 0 }],
    ]);
  });
});

describe("a war's battlefield", () => {
  it('puts working Knights on the field first, six at most, and counts the rest', () => {
    const knights = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => knight(id, id === 'h'));
    const model = fieldModel('Blue', knights, sprites, goblins);
    expect(model.duels).toHaveLength(6);
    expect(model.duels[0]!.knight.id).toBe('h');
    expect(model.duels[0]!.goblin).toEqual(goblinFor('h'));
    expect(model.more).toBe(2);
    expect(new Set(model.duels.map((d) => `${d.x},${d.y}`)).size).toBe(6);
  });

  it('centres a lone duel and spreads more over two columns', () => {
    expect(duelSlots(0)).toEqual([]);
    expect(duelSlots(1)).toHaveLength(1);
    expect(duelSlots(3).map(([x]) => x)).toEqual([250, 700, 250]);
    expect(duelSlots(9)).toHaveLength(6);
  });

  it('picks a Knight by its body, and nothing on open ground', () => {
    const model = fieldModel('Blue', [knight('a'), knight('b')], sprites, goblins);
    expect(fieldPick(model, ...centre(knightRect(model.duels[1]!)))).toEqual({ kind: 'knight', id: 'b' });
    expect(fieldPick(model, 5, 5)).toBeNull();
  });

  it('describes the duels for screen readers', () => {
    expect(describeField(fieldModel('Blue', [], sprites, goblins))).toMatch(/quiet/);
    const model = fieldModel('Blue', [knight('a', true)], sprites, goblins);
    expect(describeField(model)).toBe(`The battlefield: A fights ${model.duels[0]!.goblin.name}.`);
  });
});
