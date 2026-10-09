import { replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import type { WarInfo } from './api.ts';
import { decisions, waitingCount } from './decisions.ts';
import { warBanners } from './warBanners.ts';
import {
  REPORTS,
  TABLE,
  bannerRect,
  bannerXs,
  describeWars,
  samePick,
  tableBanners,
  warModel,
  warPick,
} from './warScene.ts';

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

describe('the War Room scene', () => {
  it('counts fighting and stalled battles, and leaves ended wars off the table', () => {
    const model = warModel([
      war('a', {
        victories: 2,
        battles: [battle('feat/x', 'fighting'), battle('fix/y', 'stalled'), battle('feat/z', 'unclear')],
      }),
      war('b', { archived: true }),
    ]);
    expect(model.wars).toEqual([
      { id: 'a', name: 'War a', banner: 'Blue', victories: 2, fighting: 1, stalled: 2 },
    ]);
    expect(warModel(null).wars).toBeNull();
  });

  it('stands up to six banners on the table, five and "+N" past that', () => {
    expect(tableBanners(warModel(null))).toEqual([]);
    const six = warModel(['1', '2', '3', '4', '5', '6'].map((id) => war(id)));
    expect(tableBanners(six)).toHaveLength(6);
    const nine = tableBanners(warModel(['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((id) => war(id))));
    expect(nine).toHaveLength(6);
    expect(nine[5]).toEqual({ more: 4 });
  });

  it('spreads the banners evenly across the table', () => {
    const xs = bannerXs(3);
    expect(xs).toHaveLength(3);
    expect(xs[0]! > TABLE.x && xs[2]! < TABLE.x + TABLE.w).toBe(true);
    expect(xs[1]! - xs[0]!).toBe(xs[2]! - xs[1]!);
  });

  it('picks a war by its banner, the "+N", the reports and the table', () => {
    const model = warModel(['1', '2', '3', '4', '5', '6', '7'].map((id) => war(id)));
    const xs = bannerXs(6);
    expect(warPick(model, ...centre(bannerRect(xs[0]!)))).toEqual({ kind: 'war', id: '1' });
    expect(warPick(model, ...centre(bannerRect(xs[5]!)))).toEqual({ kind: 'more' });
    expect(warPick(model, ...centre(REPORTS))).toEqual({ kind: 'reports' });
    expect(warPick(model, TABLE.x + 4, TABLE.y + TABLE.h - 4)).toEqual({ kind: 'table' });
    expect(warPick(model, 2, 2)).toBeNull();
    expect(samePick({ kind: 'war', id: '1' }, { kind: 'war', id: '1' })).toBe(true);
    expect(samePick({ kind: 'war', id: '1' }, { kind: 'war', id: '2' })).toBe(false);
  });

  it('describes the table for screen readers', () => {
    expect(describeWars(warModel(null))).toMatch(/war table/);
    expect(describeWars(warModel([]))).toMatch(/No war has been declared/);
    expect(
      describeWars(
        warModel([war('a', { name: 'Bakery', victories: 1, battles: [battle('fix/y', 'stalled')] })]),
      ),
    ).toBe('The War Room: Bakery (1 victory, 0 fighting, 1 stalled).');
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
