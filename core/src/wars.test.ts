import { describe, expect, it } from 'vitest';

import { replay } from './game.ts';
import type { GuildEvent } from './events.ts';
import {
  type Aim,
  type BattleMemory,
  type BranchFact,
  type ClearInput,
  type KnightFact,
  type PullFact,
  BANNERS,
  CLEAR_AFTER_S,
  DAY,
  battleKind,
  battleTitle,
  battlesOf,
  clearVerdict,
  dispatch,
  dispatchMarkdown,
  isRebuildable,
  nextBanner,
  parseStatusIgnored,
  pullFor,
  remember,
  slug,
  validBranch,
} from './wars.ts';

const NOW = 1_800_000_000;

const branch = (name: string, over: Partial<BranchFact> = {}): BranchFact => ({
  name,
  lastCommitAt: NOW - 3600,
  head: `${name}-head`,
  ahead: 2,
  mergedByGit: false,
  worktree: null,
  ...over,
});
const pull = (n: number, b: string, over: Partial<PullFact> = {}): PullFact => ({
  number: n,
  branch: b,
  state: 'open',
  head: `${b}-head`,
  mergedAt: null,
  checks: null,
  ...over,
});
const knight = (id: string, b: string | null, over: Partial<KnightFact> = {}): KnightFact => ({
  id,
  name: id,
  branch: b,
  active: false,
  lastActiveAt: NOW - 600,
  ...over,
});
const mem = (b: string, over: Partial<BattleMemory> = {}): BattleMemory => ({
  branch: b,
  firstSeen: NOW - 5 * DAY,
  aheadSeen: true,
  knights: [],
  mark: null,
  wonAt: null,
  worktree: null,
  clearedAt: null,
  ...over,
});
const aim = (b: string, over: Partial<Aim> = {}): Aim => ({
  id: `aim-${b}`,
  title: 'Activity feed',
  kind: 'feature',
  branch: b,
  createdAt: NOW - DAY,
  ...over,
});

const base = {
  defaultBranch: 'main',
  branches: [] as BranchFact[],
  pulls: [] as PullFact[] | null,
  aims: [] as Aim[],
  memory: [] as BattleMemory[],
  knights: [] as KnightFact[],
  now: NOW,
  stallDays: 2,
};
const one = (over: Partial<typeof base>) => {
  const battles = battlesOf({ ...base, ...over });
  expect(battles).toHaveLength(1);
  return battles[0]!;
};

describe('battle kinds and titles', () => {
  it('reads the kind from the branch prefix the repo uses', () => {
    expect(battleKind('feat/activity-feed')).toBe('feature');
    expect(battleKind('feature/x')).toBe('feature');
    expect(battleKind('fix/login')).toBe('fix');
    expect(battleKind('hotfix/now')).toBe('fix');
    expect(battleKind('refactor/store')).toBe('refactor');
    expect(battleKind('chore/ci')).toBe('refactor');
    expect(battleKind('spike')).toBe('other');
    expect(battleKind('claude/project-thread')).toBe('other');
  });

  it('turns a branch into a readable title', () => {
    expect(battleTitle('feat/activity-feed')).toBe('Activity feed');
    expect(battleTitle('fix/login_redirect')).toBe('Login redirect');
    expect(battleTitle('spike')).toBe('Spike');
    expect(battleTitle('a/b/c-d')).toBe('B c d');
  });
});

describe('battle states', () => {
  it('leaves the default branch out', () => {
    expect(battlesOf({ ...base, branches: [branch('main'), branch('feat/a')] }).map((b) => b.branch)).toEqual(
      ['feat/a'],
    );
  });

  it('is fighting while a Knight works on it, and lists its Knights', () => {
    const b = one({
      branches: [branch('feat/a')],
      knights: [knight('k1', 'feat/a', { active: true }), knight('k2', 'main'), knight('k3', 'feat/a')],
    });
    expect(b.state).toBe('fighting');
    expect(b.knights).toEqual([
      { id: 'k1', name: 'k1', active: true },
      { id: 'k3', name: 'k3', active: false },
    ]);
  });

  it('is holding when nobody is on it and it moved recently, stalled after the stall days', () => {
    expect(one({ branches: [branch('feat/a', { lastCommitAt: NOW - DAY })] }).state).toBe('holding');
    expect(one({ branches: [branch('feat/a', { lastCommitAt: NOW - 3 * DAY })] }).state).toBe('stalled');
    // A Knight's recent work counts as activity even without a commit.
    expect(
      one({
        branches: [branch('feat/a', { lastCommitAt: NOW - 3 * DAY })],
        knights: [knight('k', 'feat/a', { lastActiveAt: NOW - 3600 })],
      }).state,
    ).toBe('holding');
    expect(one({ branches: [branch('feat/a', { lastCommitAt: NOW - 3 * DAY })], stallDays: 5 }).state).toBe(
      'holding',
    );
  });

  it('is won when its pull request merged, whatever git says', () => {
    const b = one({
      branches: [branch('feat/a', { mergedByGit: false })],
      pulls: [pull(7, 'feat/a', { state: 'merged', mergedAt: NOW - 100, checks: 'passing' })],
    });
    expect(b.state).toBe('won');
    expect(b.wonAt).toBe(NOW - 100);
    expect(b.pull).toEqual({ number: 7, state: 'merged', checks: 'passing' });
  });

  it('is still won after the merged branch is deleted', () => {
    expect(
      one({ memory: [mem('feat/a')], pulls: [pull(7, 'feat/a', { state: 'merged', mergedAt: NOW })] }).state,
    ).toBe('won');
  });

  it('counts a git merge only for a branch that was ahead before (a fresh branch is not a win)', () => {
    const fresh = branch('feat/new', { ahead: 0, mergedByGit: true });
    expect(one({ branches: [fresh], pulls: null }).state).toBe('holding');
    expect(
      one({ branches: [fresh], pulls: null, memory: [mem('feat/new', { aheadSeen: false })] }).state,
    ).toBe('holding');
    expect(
      one({ branches: [fresh], pulls: null, memory: [mem('feat/new', { aheadSeen: true })] }).state,
    ).toBe('won');
    // An open pull request means it is not over, whatever git says.
    expect(one({ branches: [fresh], pulls: [pull(1, 'feat/new')], memory: [mem('feat/new')] }).state).toBe(
      'holding',
    );
  });

  it('is retreated when its pull request closed and the branch went', () => {
    expect(one({ memory: [mem('feat/a')], pulls: [pull(3, 'feat/a', { state: 'closed' })] }).state).toBe(
      'retreated',
    );
  });

  it('asks the user when the branch is gone and nothing says how it ended', () => {
    expect(one({ memory: [mem('feat/a')], pulls: null }).state).toBe('unclear');
    expect(one({ memory: [mem('feat/a')], pulls: [] }).state).toBe('unclear');
    expect(one({ memory: [mem('feat/a', { mark: 'won' })], pulls: null }).state).toBe('won');
    expect(one({ memory: [mem('feat/a', { mark: 'retreated' })], pulls: null }).state).toBe('retreated');
    // Once seen won, it stays won when the branch is deleted.
    expect(one({ memory: [mem('feat/a', { wonAt: NOW - 5 })], pulls: null }).state).toBe('won');
  });

  it('shows a war aim as planned until its branch exists, under the aim title and kind', () => {
    const planned = one({ aims: [aim('feat/feed', { title: 'Guild feed', kind: 'refactor' })] });
    expect(planned).toMatchObject({
      state: 'planned',
      title: 'Guild feed',
      kind: 'refactor',
      aimId: 'aim-feat/feed',
    });
    expect(planned.lastActivityAt).toBeNull();
    const started = one({ aims: [aim('feat/feed')], branches: [branch('feat/feed')] });
    expect(started.state).toBe('holding');
    expect(started.title).toBe('Activity feed');
  });

  it('lists what needs eyes first', () => {
    const battles = battlesOf({
      ...base,
      branches: [
        branch('a-holding'),
        branch('b-stalled', { lastCommitAt: NOW - 9 * DAY }),
        branch('c-fighting'),
        branch('d-won'),
      ],
      pulls: [pull(1, 'd-won', { state: 'merged', mergedAt: NOW })],
      aims: [aim('e-planned')],
      knights: [knight('k', 'c-fighting', { active: true })],
    });
    expect(battles.map((b) => b.state)).toEqual(['fighting', 'stalled', 'holding', 'planned', 'won']);
  });

  it('picks the pull request that speaks for a branch', () => {
    const pulls = [
      pull(1, 'b', { state: 'closed' }),
      pull(2, 'b', { state: 'merged', mergedAt: 1 }),
      pull(3, 'b', { state: 'open' }),
      pull(4, 'other'),
    ];
    expect(pullFor(pulls, 'b')?.number).toBe(3);
    expect(pullFor(pulls.slice(0, 2), 'b')?.number).toBe(2);
    expect(pullFor(pulls.slice(0, 1), 'b')?.number).toBe(1);
    expect(pullFor(pulls, 'none')).toBeNull();
  });
});

describe('remember', () => {
  it('remembers new battles, their Knights and that they were ahead', () => {
    const branches = [branch('feat/a', { ahead: 3 })];
    const battles = battlesOf({ ...base, branches, knights: [knight('k1', 'feat/a', { active: true })] });
    const { memory, newlyWon } = remember([], battles, branches, NOW);
    expect(newlyWon).toEqual([]);
    expect(memory).toEqual([
      {
        branch: 'feat/a',
        firstSeen: NOW,
        aheadSeen: true,
        knights: ['k1'],
        mark: null,
        wonAt: null,
        worktree: null,
        clearedAt: null,
      },
    ]);
  });

  it('reports a win once, with every Knight who fought it, and keeps the old memory intact', () => {
    const before = [mem('feat/a', { knights: ['k1'] })];
    const branches = [branch('feat/a', { ahead: 0 })];
    const pulls = [pull(9, 'feat/a', { state: 'merged', mergedAt: NOW - 50 })];
    const battles = battlesOf({
      ...base,
      branches,
      pulls,
      memory: before,
      knights: [knight('k2', 'feat/a')],
    });
    const first = remember(before, battles, branches, NOW);
    expect(first.newlyWon.map((m) => [m.branch, m.knights, m.wonAt])).toEqual([
      ['feat/a', ['k1', 'k2'], NOW - 50],
    ]);
    expect(before[0]!.knights).toEqual(['k1']);
    const again = remember(
      first.memory,
      battlesOf({ ...base, branches, pulls, memory: first.memory }),
      branches,
      NOW + 60,
    );
    expect(again.newlyWon).toEqual([]);
  });

  it('does not remember a planned aim, so it stays planned', () => {
    const battles = battlesOf({ ...base, aims: [aim('feat/x')] });
    expect(remember([], battles, [], NOW).memory).toEqual([]);
  });
});

describe('clearing a won battle’s worktree', () => {
  const merged = pull(5, 'feat/a', { state: 'merged', mergedAt: NOW - 2 * DAY, head: 'abc' });
  const ok: ClearInput = {
    autoClear: true,
    gh: true,
    pull: merged,
    now: NOW,
    knightRunning: false,
    lastKnightWriteAt: NOW - 3 * DAY,
    dirty: 0,
    head: 'abc',
    ignored: ['node_modules/', 'web/dist/', 'tsconfig.tsbuildinfo'],
  };

  it('clears when every guard holds', () => {
    expect(clearVerdict(ok)).toEqual({ clear: true });
    expect(clearVerdict({ ...ok, lastKnightWriteAt: null, ignored: [] })).toEqual({ clear: true });
  });

  it.each([
    ['off', { autoClear: false }],
    ['no-gh', { gh: false }],
    ['not-merged', { pull: null }],
    ['not-merged', { pull: { ...merged, state: 'open' as const, mergedAt: null } }],
    ['not-merged', { pull: { ...merged, state: 'closed' as const } }],
    ['too-soon', { pull: { ...merged, mergedAt: NOW - CLEAR_AFTER_S + 60 } }],
    ['knight', { knightRunning: true }],
    ['knight', { lastKnightWriteAt: NOW - 3600 }],
    ['uncommitted', { dirty: 1 }],
    ['not-pr-head', { head: 'def' }],
    ['ignored-files', { ignored: ['node_modules/', '.env'] }],
    ['ignored-files', { ignored: ['secrets/key.pem'] }],
  ] as const)('refuses: %s', (guard, over) => {
    expect(clearVerdict({ ...ok, ...over })).toEqual({ clear: false, guard });
  });

  it('checks the guards in order: the merge before anything in the folder', () => {
    expect(clearVerdict({ ...ok, gh: false, dirty: 3 })).toEqual({ clear: false, guard: 'no-gh' });
    expect(clearVerdict({ ...ok, pull: null, dirty: 3 })).toEqual({ clear: false, guard: 'not-merged' });
  });

  it('knows rebuildable output from files that would be lost', () => {
    for (const p of [
      'node_modules/',
      'web/node_modules/',
      'dist/',
      'packages/a/build/',
      '.vite/',
      'coverage/',
      'test-results/',
      'npm-debug.log',
      'app.tsbuildinfo',
      '__pycache__/',
      'src/x.pyc',
    ])
      expect(isRebuildable(p), p).toBe(true);
    for (const p of ['.env', '.env.local', 'notes.md', 'secrets/', 'config/local.json', 'distro/'])
      expect(isRebuildable(p), p).toBe(false);
  });

  it('reads git status with ignored files', () => {
    expect(parseStatusIgnored(' M a.ts\n?? new.ts\n!! node_modules/\n!! .env\n')).toEqual({
      dirty: 2,
      ignored: ['node_modules/', '.env'],
    });
    expect(parseStatusIgnored('')).toEqual({ dirty: 0, ignored: [] });
  });
});

describe('names and banners', () => {
  it('accepts ordinary branch names and refuses dangerous ones', () => {
    for (const ok of ['feat/activity-feed', 'fix/a.b', 'refactor/x_y', 'v2'])
      expect(validBranch(ok), ok).toBe(true);
    for (const bad of [
      '',
      '-rf',
      '--upload-pack=x',
      'a..b',
      'a//b',
      'a/',
      'a.',
      'a.lock',
      'a/.hidden',
      'a@{1}',
      'a b',
      'a~1',
      'a^',
      'a:b',
      '/abs',
      'x'.repeat(101),
    ])
      expect(validBranch(bad), bad).toBe(false);
  });

  it('makes folder-safe slugs', () => {
    expect(slug('The War for the Guild!')).toBe('the-war-for-the-guild');
    expect(slug('feat/activity-feed')).toBe('feat-activity-feed');
    expect(slug('../..')).toBe('war');
  });

  it('gives each war a banner no other war flies, then the least used', () => {
    expect(nextBanner([])).toBe('Blue');
    expect(nextBanner([{ banner: 'Blue', archived: false }])).toBe('Red');
    expect(nextBanner([{ banner: 'Blue', archived: true }])).toBe('Blue');
    const all = BANNERS.map((banner) => ({ banner, archived: false }));
    expect(nextBanner([...all, { banner: 'Blue', archived: false }])).toBe('Red');
  });
});

describe('the battle report', () => {
  const war = { id: 'w1', name: 'The War for the Guild', goal: 'Ship the Armorer', banner: 'Blue' as const };

  it('splits battles by state and counts only wins since the last report', () => {
    const battles = battlesOf({
      ...base,
      branches: [
        branch('feat/live', { name: 'feat/live' }),
        branch('fix/old', { lastCommitAt: NOW - 9 * DAY }),
      ],
      pulls: [
        pull(1, 'feat/won-now', { state: 'merged', mergedAt: NOW - 100 }),
        pull(2, 'feat/won-before', { state: 'merged', mergedAt: NOW - 3 * DAY }),
      ],
      memory: [mem('feat/won-now'), mem('feat/won-before', { wonAt: NOW - 3 * DAY })],
      aims: [aim('feat/next')],
      knights: [knight('Tristan', 'feat/live', { active: true })],
    });
    const d = dispatch(
      [
        {
          war: {
            ...war,
            battles: [mem('x', { clearedAt: NOW - 10 }), mem('y', { clearedAt: NOW - 9 * DAY })],
          },
          battles,
          looseEnds: { unpushed: 2, dirty: 1 },
          tokens: 12345,
        },
      ],
      NOW - DAY,
      NOW,
      '2027-01-15',
    );
    const w = d.wars[0]!;
    expect(w.won.map((b) => b.branch)).toEqual(['feat/won-now']);
    expect(w.victories).toBe(2);
    expect(w.fighting.map((b) => b.branch)).toEqual(['feat/live']);
    expect(w.stalled.map((b) => b.branch)).toEqual(['fix/old']);
    expect(w.planned).toBe(1);
    expect(w.cleared).toEqual(['x']);

    const md = dispatchMarkdown(d);
    expect(md).toContain('# Battle report, 2027-01-15');
    expect(md).toContain('## The War for the Guild');
    expect(md).toContain('_Ship the Armorer_');
    expect(md).toContain('**Won** (1)\n- Won now (`feat/won-now`), #1');
    expect(md).toContain('**Fighting** (1)\n- Live (`feat/live`): Tristan');
    expect(md).toContain('**Stalled** (1)\n- Old (`fix/old`)');
    expect(md).toContain('2 victories in all · 1 planned · 12,345 tokens spent by its Knights');
    expect(md).toContain('loose ends: 2 unpushed commits, 1 uncommitted files');
    expect(md).toContain('fields cleared: `x`');
  });

  it('counts every win in the first report, and says when a front is quiet', () => {
    const d = dispatch(
      [{ war: { ...war, battles: [] }, battles: [], looseEnds: { unpushed: 0, dirty: 0 }, tokens: 0 }],
      null,
      NOW,
      'd',
    );
    expect(dispatchMarkdown(d)).toContain('All quiet on this front.');
    expect(dispatchMarkdown(dispatch([], null, NOW, 'd'))).toContain('No wars declared yet.');
  });
});

describe('victories in the game', () => {
  const t0 = 100;
  const events: GuildEvent[] = [
    { t: t0, session: 'k', type: 'session_start', name: 'Tristan' },
    { t: t0 + 1, session: 'k', type: 'session_end' },
    { t: t0 + 2, session: 'k', type: 'victory' },
    { t: t0 + 3, session: 'ghost', type: 'victory' },
  ];

  it('rewards a Knight for a won battle even after it left, and ignores unknown sessions', () => {
    const state = replay(events);
    expect(state.heroes.k).toMatchObject({ victories: 1, xp: 100, status: 'gone' });
    expect(state.heroes.ghost).toBeUndefined();
  });
});
