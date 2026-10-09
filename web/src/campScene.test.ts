import { replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import type { WarInfo } from './api.ts';
import {
  DUEL_SLOTS,
  campKnights,
  campModel,
  campPick,
  describeCamp,
  sameCampPick,
  tentRect,
  warMood,
} from './campScene.ts';
import { decisions, waitingCount } from './decisions.ts';
import { type DuelKnight, type GoblinArt, knightRect } from './duel.ts';
import type { Sprites } from './village.ts';
import { warBanners } from './warBanners.ts';

type BattleInfo = WarInfo['battles'][number];

const battle = (branch: string, state: BattleInfo['state'], over: Partial<BattleInfo> = {}): BattleInfo => ({
  branch,
  title: branch,
  kind: 'feature',
  state,
  knights: [],
  pull: null,
  lastActivityAt: 100,
  ahead: 1,
  wonAt: null,
  worktree: null,
  aimId: null,
  clearGuard: null,
  ...over,
});

const war = (id: string, over: Partial<WarInfo> = {}): WarInfo => ({
  id,
  name: `War ${id}`,
  goal: '',
  banner: 'Blue',
  folder: `repo-${id}`,
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

const sprites: Sprites = { grass: null!, tree: null!, buildings: {}, units: {} };
const goblins: GoblinArt = { sheets: {}, house: null!, tower: null! };
const knight = (id: string, active = false): DuelKnight => ({
  id,
  name: id.toUpperCase(),
  banner: 'Blue',
  active,
  needsYou: false,
  battle: null,
  quests: { done: 0, total: 0 },
});
const camp = (wars: WarInfo[] | null, knights: DuelKnight[] = []) =>
  campModel(wars, knights, sprites, goblins);

describe('the War Camp', () => {
  it('tells active, sleeping and ended wars apart', () => {
    expect(warMood(war('a', { battles: [battle('feat/y', 'holding'), battle('feat/x', 'fighting')] }))).toBe(
      'active',
    );
    expect(warMood(war('a', { battles: [battle('feat/y', 'holding')] }))).toBe('sleeping');
    expect(warMood(war('a', { archived: true, battles: [battle('feat/x', 'fighting')] }))).toBe('ended');
  });

  it('pitches a tent per war, active wars first, and none for ended ones', () => {
    const model = camp([
      war('a', { victories: 2 }),
      war('b', { battles: [battle('feat/x', 'fighting')] }),
      war('c', { archived: true }),
    ]);
    expect(model.tents).toEqual([
      { id: 'b', name: 'War b', banner: 'Blue', victories: 0, sleeping: false },
      { id: 'a', name: 'War a', banner: 'Blue', victories: 2, sleeping: true },
    ]);
    expect(model.moreWars).toBe(0);
    expect(camp(null).tents).toBeNull();
  });

  it('pitches three tents, or two and "+N" past that', () => {
    expect(camp(['1', '2', '3'].map((id) => war(id))).tents).toHaveLength(3);
    const five = camp(['1', '2', '3', '4', '5'].map((id) => war(id)));
    expect(five.tents).toHaveLength(2);
    expect(five.moreWars).toBe(3);
  });

  it('puts four duels on the field, working Knights first, and counts the rest', () => {
    const model = camp(
      [],
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => knight(id, id === 'f')),
    );
    expect(model.duels.map((d) => d.knight.id)).toEqual(['f', 'a', 'b', 'c']);
    expect(model.duels.map((d) => [d.x, d.y])).toEqual(DUEL_SLOTS);
    expect(model.moreKnights).toBe(2);
  });

  it("gathers every open war's Knights once, in their war's colours", () => {
    const state = replay([
      { t: 0, session: 'k1', type: 'session_start', name: 'Tristan' },
      { t: 1, session: 'k2', type: 'session_start', name: 'Isolde' },
      { t: 2, session: 'k3', type: 'session_start', name: 'Mark' },
    ]);
    const knights = campKnights(state, [
      war('a', { banner: 'Red', knights: ['k1', 'k2'] }),
      war('b', { banner: 'Green', knights: ['k2'] }),
      war('c', { banner: 'Black', knights: ['k3'], archived: true }),
    ]);
    expect(knights.map((k) => [k.name, k.banner])).toEqual([
      ['Tristan', 'Red'],
      ['Isolde', 'Red'],
    ]);
    // Demo mode reads no wars: the demo's Knights drill in blue.
    expect(campKnights(state, null).map((k) => k.name)).toEqual(['Tristan', 'Isolde', 'Mark']);
  });

  it('picks a Knight by its body, a war by its tent, and the "+N" tent', () => {
    const model = camp(
      ['1', '2', '3', '4'].map((id) => war(id)),
      [knight('a')],
    );
    expect(campPick(model, ...centre(knightRect(model.duels[0]!)))).toEqual({ kind: 'knight', id: 'a' });
    expect(campPick(model, ...centre(tentRect(0)))).toEqual({ kind: 'war', id: '1' });
    expect(campPick(model, ...centre(tentRect(2)))).toEqual({ kind: 'more' });
    expect(campPick(model, 2, 2)).toBeNull();
    expect(campPick(camp(['1'].map((id) => war(id))), ...centre(tentRect(2)))).toBeNull();
    expect(sameCampPick({ kind: 'war', id: '1' }, { kind: 'war', id: '1' })).toBe(true);
    expect(sameCampPick({ kind: 'war', id: '1' }, { kind: 'knight', id: '1' })).toBe(false);
  });

  it('describes the camp for screen readers', () => {
    expect(describeCamp(camp([]))).toBe('The War Camp: no war declared yet. The field is quiet.');
    const model = camp([war('a', { name: 'Bakery', victories: 1 })], [knight('x', true)]);
    expect(describeCamp(model)).toBe(
      `The War Camp: Bakery (1 victory, sleeping). On the field, X fights ${model.duels[0]!.goblin.name}.`,
    );
  });
});

describe('war banners', () => {
  it("dresses each war's Knights in its banner and plants one banner per war", () => {
    const b = warBanners([
      war('a', {
        banner: 'Red',
        knights: ['k1', 'k2'],
        victories: 3,
        battles: [battle('feat/x', 'fighting')],
      }),
      war('b', { banner: 'Green', knights: ['k2', 'k3'] }),
      war('c', { banner: 'Black', knights: ['k4'], archived: true }),
    ]);
    expect([...b.teams]).toEqual([
      ['k1', 'Red'],
      ['k2', 'Red'], // a Knight in two wars keeps the first
      ['k3', 'Green'],
    ]);
    expect(b.warOf.get('k3')).toEqual({ id: 'b', name: 'War b' });
    expect(b.map).toEqual([
      { name: 'War a', banner: 'Red', victories: 3, fighting: true },
      { name: 'War b', banner: 'Green', victories: 0, fighting: false },
    ]);
    expect(warBanners(null).map).toEqual([]);
  });
});

describe('battles in Needs you', () => {
  it('lists stalled and unclear battles, newest first, and counts them', () => {
    const state = replay([]);
    const list = decisions(
      state,
      [],
      [],
      [
        war('a', {
          battles: [
            battle('fix/old', 'stalled', { lastActivityAt: 10 }),
            battle('feat/gone', 'unclear', { lastActivityAt: 50 }),
            battle('feat/ok', 'fighting'),
            battle('feat/won', 'won'),
          ],
        }),
        war('b', { archived: true, battles: [battle('fix/ended', 'stalled')] }),
      ],
    );
    expect(list.map((d) => d.key)).toEqual(['battle:a:feat/gone', 'battle:a:fix/old']);
    expect(waitingCount(state, 0, 0, 2)).toBe(2);
  });
});
