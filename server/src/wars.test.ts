import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { type GuildEvent, DAY, replay } from '@agent-guild/core';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChatError } from './chats.ts';
import type { Court } from './king.ts';
import { registerWarRoutes } from './warRoutes.ts';
import {
  type RunGh,
  type SessionFolder,
  type WarStatus,
  WarRoom,
  branchFacts,
  defaultBranch,
  parsePulls,
  parseWorktrees,
  rollup,
} from './wars.ts';

let dir: string;
let home: string;
let data: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'guild-wars-')));
  home = join(dir, 'home');
  data = join(home, '.agent-guild');
  await mkdir(data, { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Commits are dated an hour before the tests' clock, so nothing looks stalled by accident. */
const COMMIT_DATE = '2027-03-10T11:00:00';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_DATE: COMMIT_DATE, GIT_COMMITTER_DATE: COMMIT_DATE },
  })
    .toString()
    .trim();

async function repo(name = 'shop'): Promise<string> {
  const path = join(home, name);
  await mkdir(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  await commit(path, 'README.md');
  return path;
}

async function commit(path: string, file: string, text = file) {
  await writeFile(join(path, file), text);
  git(path, 'add', file);
  git(path, 'commit', '-q', '-m', `add ${file}`);
}

/** A folder inside home, like ChatManager.checkFolder: anything else is refused. */
const checkFolder = async (raw: unknown) => {
  if (typeof raw !== 'string' || !raw) throw new ChatError(400, 'Choose a folder.');
  const real = await realpath(raw).catch(() => {
    throw new ChatError(400, 'No such folder.');
  });
  if (!real.startsWith(home + sep)) throw new ChatError(403, 'Only folders inside your home.');
  return real;
};

interface Rig {
  room: WarRoom;
  events: GuildEvent[];
  sessions: SessionFolder[];
  chats: { id: string; cwd: string; running: boolean; busy: boolean }[];
  pulls: unknown[];
  ghCalls: number;
  victories: string[][];
  statuses: WarStatus[];
  clock: { now: number };
  writes: { ms: Record<string, number> };
}

function rig({ gh = true }: { gh?: boolean } = {}): Rig {
  const r: Rig = {
    room: null as unknown as WarRoom,
    events: [],
    sessions: [],
    chats: [],
    pulls: [],
    ghCalls: 0,
    victories: [],
    statuses: [],
    clock: { now: Date.parse('2027-03-10T12:00:00') },
    writes: { ms: {} },
  };
  const fakeGh: RunGh = async (_cwd, args) => {
    expect(args.slice(0, 2)).toEqual(['pr', 'list']);
    r.ghCalls += 1;
    return JSON.stringify(r.pulls);
  };
  r.room = new WarRoom({
    dir: data,
    gh: gh ? fakeGh : null,
    ghEveryMs: 0,
    checkFolder,
    state: () => replay(r.events),
    sessions: () => r.sessions,
    chats: () => r.chats,
    lastWrite: (id) => r.writes.ms[id] ?? null,
    now: () => new Date(r.clock.now),
    onChange: (s) => r.statuses.push(s),
    onVictory: (ids) => r.victories.push(ids),
  });
  return r;
}

/** A Knight in the guild: arrived, on a branch, and working (or resting). */
function knight(r: Rig, id: string, cwd: string, branch: string, working = true) {
  const t = r.clock.now / 1000 - 60;
  r.events.push(
    { t, session: id, type: 'session_start', name: id },
    { t, session: id, type: 'meta', branch },
    working ? { t: t + 1, session: id, type: 'tool', tool: 'Edit' } : { t: t + 1, session: id, type: 'stop' },
  );
  r.sessions.push({ id, cwd });
}

const head = (path: string) => git(path, 'rev-parse', 'HEAD');
const merged = (n: number, branch: string, sha: string, at: number) => ({
  number: n,
  state: 'MERGED',
  headRefName: branch,
  headRefOid: sha,
  mergedAt: new Date(at).toISOString(),
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
});

describe('reading gh and git', () => {
  it('rolls checks up into one word', () => {
    expect(rollup([])).toBeNull();
    expect(rollup(undefined)).toBeNull();
    expect(rollup([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }])).toBe('passing');
    expect(
      rollup([
        { status: 'IN_PROGRESS', conclusion: '' },
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
      ]),
    ).toBe('pending');
    expect(rollup([{ state: 'PENDING' }])).toBe('pending');
    expect(rollup([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }])).toBe(
      'failing',
    );
    expect(rollup([{ state: 'ERROR' }])).toBe('failing');
    expect(rollup([{ status: 'COMPLETED', conclusion: 'SKIPPED' }])).toBe('passing');
  });

  it('reads pull requests as states only, skipping anything malformed', () => {
    const pulls = parsePulls(
      JSON.stringify([
        merged(4, 'feat/a', 'abc', Date.parse('2027-03-01T10:00:00Z')),
        {
          number: 5,
          state: 'OPEN',
          headRefName: 'fix/b',
          headRefOid: 'def',
          mergedAt: null,
          title: 'secret',
        },
        { number: 6, state: 'CLOSED', headRefName: 'x', headRefOid: 'g', mergedAt: '' },
        { number: 'seven', state: 'OPEN', headRefName: 'y' },
        { number: 8, state: 'DRAFT', headRefName: 'z' },
      ]),
    );
    expect(pulls).toEqual([
      {
        number: 4,
        branch: 'feat/a',
        state: 'merged',
        head: 'abc',
        mergedAt: Date.parse('2027-03-01T10:00:00Z') / 1000,
        checks: 'passing',
      },
      { number: 5, branch: 'fix/b', state: 'open', head: 'def', mergedAt: null, checks: null },
      { number: 6, branch: 'x', state: 'closed', head: 'g', mergedAt: null, checks: null },
    ]);
    expect(JSON.stringify(pulls)).not.toContain('secret');
    expect(parsePulls('{}')).toEqual([]);
  });

  it('reads extra worktrees, leaving the main one out', () => {
    const text = [
      'worktree /repo\nHEAD 1\nbranch refs/heads/main',
      'worktree /wt/a\nHEAD 2\nbranch refs/heads/feat/a',
      'worktree /wt/detached\nHEAD 3\ndetached',
      '',
    ].join('\n\n');
    expect(parseWorktrees(text)).toEqual([
      { path: '/wt/a', branch: 'feat/a' },
      { path: '/wt/detached', branch: null },
    ]);
  });

  it('finds the default branch and every other branch with what the rules need', async () => {
    const path = await repo();
    expect(await defaultBranch(path)).toBe('main');
    git(path, 'checkout', '-q', '-b', 'feat/a');
    await commit(path, 'a.ts');
    await commit(path, 'b.ts');
    git(path, 'checkout', '-q', 'main');
    git(path, 'branch', 'fix/fresh');
    const { branches } = await branchFacts(path, 'main');
    const byName = Object.fromEntries(branches.map((b) => [b.name, b]));
    expect(Object.keys(byName).sort()).toEqual(['feat/a', 'fix/fresh']);
    expect(byName['feat/a']).toMatchObject({ ahead: 2, mergedByGit: false, worktree: null });
    expect(byName['fix/fresh']).toMatchObject({ ahead: 0, mergedByGit: true });
    expect(byName['feat/a']!.head).toBe(git(path, 'rev-parse', 'feat/a'));
  });
});

describe('declaring wars', () => {
  it('declares a war on a repository, at its root, with the next free banner', async () => {
    const r = rig();
    const path = await repo('shop');
    await mkdir(join(path, 'src'));
    const war = await r.room.declare({ folder: join(path, 'src'), goal: '  Ship   the cart ' });
    expect(war).toMatchObject({
      name: 'shop',
      goal: 'Ship the cart',
      banner: 'Blue',
      folder: 'shop',
      problem: null,
    });
    const second = await r.room.declare({ folder: await repo('blog'), name: 'The War for the Blog' });
    expect(second).toMatchObject({ name: 'The War for the Blog', banner: 'Red' });
    // The page never gets the path; the stored record does.
    expect(JSON.stringify(r.statuses.at(-1))).not.toContain(home);
    const stored = JSON.parse(await readFile(join(data, 'wars.json'), 'utf8')) as {
      wars: { folder: string }[];
    };
    expect(stored.wars.map((w) => w.folder)).toEqual([path, join(home, 'blog')]);
  });

  it('refuses a folder that is not a repository, outside home, or already at war', async () => {
    const r = rig();
    await mkdir(join(home, 'plain'));
    await expect(r.room.declare({ folder: join(home, 'plain') })).rejects.toThrow('not one');
    await expect(r.room.declare({ folder: dir })).rejects.toMatchObject({ status: 403 });
    const path = await repo();
    await r.room.declare({ folder: path });
    await expect(r.room.declare({ folder: path })).rejects.toMatchObject({ status: 409 });
  });

  it('suggests repositories Knights have worked in, and declares one by its key', async () => {
    const r = rig();
    const path = await repo('shop');
    await mkdir(join(path, 'web'));
    r.sessions.push(
      { id: 'a', cwd: path },
      { id: 'b', cwd: join(path, 'web') },
      { id: 'c', cwd: join(home, 'nowhere') },
    );
    r.sessions.push({ id: 'king', cwd: join(data, 'throne-room') });
    const status = await r.room.statusNow();
    expect(status.suggestions).toEqual([{ key: expect.any(String), folder: 'shop', knights: 2 }]);
    expect(JSON.stringify(status.suggestions)).not.toContain(home);
    await r.room.declare({ key: status.suggestions[0]!.key });
    expect((await r.room.statusNow()).suggestions).toEqual([]);
    await expect(r.room.declare({ key: 'nope' })).rejects.toMatchObject({ status: 404 });
  });

  it('renames, re-flags and ends a war, and shows a missing folder as a problem', async () => {
    const r = rig();
    const path = await repo();
    const war = await r.room.declare({ folder: path });
    let status = await r.room.update(war.id, { name: 'Shopfront', banner: 'Green', goal: 'Launch' });
    expect(status.wars[0]).toMatchObject({ name: 'Shopfront', banner: 'Green', goal: 'Launch' });
    await expect(r.room.update(war.id, { banner: 'Gold' })).rejects.toMatchObject({ status: 400 });
    await expect(r.room.update('missing', {})).rejects.toMatchObject({ status: 404 });
    status = await r.room.update(war.id, { archived: true });
    expect(status.wars[0]!.archived).toBe(true);
    // An ended war frees its folder for a new one.
    await r.room.declare({ folder: path });
    await expect(r.room.update(war.id, { archived: false })).rejects.toMatchObject({ status: 409 });

    const other = await r.room.declare({ folder: await repo('gone') });
    await rm(join(home, 'gone'), { recursive: true });
    await r.room.poll();
    expect((await r.room.statusNow()).wars.find((w) => w.id === other.id)!.problem).toContain('missing');
  });
});

describe('battles', () => {
  it('finds battles on branches, with the Knights fighting them, and wears the war banner', async () => {
    const r = rig();
    const path = await repo();
    git(path, 'checkout', '-q', '-b', 'feat/cart');
    await commit(path, 'cart.ts');
    knight(r, 'tristan', path, 'feat/cart');
    knight(r, 'outsider', join(home, 'elsewhere'), 'feat/cart');
    await r.room.declare({ folder: path });
    const war = (await r.room.statusNow()).wars[0]!;
    expect(war.battles).toEqual([
      expect.objectContaining({
        branch: 'feat/cart',
        title: 'Cart',
        kind: 'feature',
        state: 'fighting',
        knights: [{ id: 'tristan', name: 'tristan', active: true }],
        ahead: 1,
      }),
    ]);
    expect(war.knights).toEqual(['tristan']);
  });

  it('declares a battle ahead of time, refuses a bad or taken branch, and withdraws it', async () => {
    const r = rig();
    const war = await r.room.declare({ folder: await repo() });
    const { battle } = await r.room.declareBattle(war.id, {
      title: 'Guild-wide activity feed',
      kind: 'feature',
    });
    expect(battle.branch).toBe('feat/guild-wide-activity-feed');
    await r.room.declareBattle(war.name, { title: 'Login', kind: 'fix' });
    let status = await r.room.statusNow();
    expect(status.wars[0]!.battles.map((b) => [b.branch, b.state, b.kind])).toEqual([
      ['feat/guild-wide-activity-feed', 'planned', 'feature'],
      ['fix/login', 'planned', 'fix'],
    ]);
    await expect(r.room.declareBattle(war.id, { title: 'Again', branch: 'fix/login' })).rejects.toMatchObject(
      {
        status: 409,
      },
    );
    await expect(
      r.room.declareBattle(war.id, { title: 'x', branch: '--upload-pack=evil' }),
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(r.room.declareBattle(war.id, { title: ' ' })).rejects.toMatchObject({ status: 400 });
    status = await r.room.withdrawAim(war.id, battle.id);
    expect(status.wars[0]!.battles.map((b) => b.branch)).toEqual(['fix/login']);
  });

  it('makes a worktree for a battle, on a new branch from the default one, and briefs the Knight', async () => {
    const r = rig();
    const path = await repo();
    const war = await r.room.declare({ folder: path, goal: 'Ship it' });
    await r.room.declareBattle(war.id, { title: 'Activity feed', kind: 'feature' });
    const { cwd, brief } = await r.room.prepareBattle(war.id, 'feat/activity-feed');
    expect(cwd.startsWith(join(data, 'worktrees') + sep)).toBe(true);
    expect(git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/activity-feed');
    expect(git(path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(brief).toContain('"Activity feed"');
    expect(brief).toContain('war "shop" (its goal: Ship it)');
    expect(brief).toContain('branch feat/activity-feed only');
    // Again: the same worktree, not a second one.
    expect((await r.room.prepareBattle(war.id, 'feat/activity-feed')).cwd).toBe(cwd);
    // A Knight sent there fights the battle.
    knight(r, 'gawain', cwd, 'feat/activity-feed');
    await r.room.sent();
    const battle = (await r.room.statusNow()).wars[0]!.battles[0]!;
    expect(battle).toMatchObject({ state: 'fighting', worktree: { cleared: false, clearedAt: null } });
    expect(battle.knights.map((k) => k.id)).toEqual(['gawain']);
  });

  it('uses an existing branch, and the main folder when it is already on that branch', async () => {
    const r = rig();
    const path = await repo();
    git(path, 'branch', 'fix/old');
    const war = await r.room.declare({ folder: path });
    const { cwd } = await r.room.prepareBattle(war.id, 'fix/old');
    expect(git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('fix/old');
    git(path, 'checkout', '-q', '-b', 'feat/here');
    expect((await r.room.prepareBattle(war.id, 'feat/here')).cwd).toBe(path);
    await expect(r.room.prepareBattle(war.id, 'main')).rejects.toMatchObject({ status: 400 });
    await expect(r.room.prepareBattle(war.id, 'a..b')).rejects.toMatchObject({ status: 400 });
  });
});

describe('victories and clearing the field', () => {
  /** A war with one battle fought in a worktree and pushed as a pull request. */
  async function fought(r: Rig) {
    const path = await repo();
    await writeFile(join(path, '.gitignore'), 'node_modules/\n.env\n');
    git(path, 'add', '.gitignore');
    git(path, 'commit', '-q', '-m', 'ignore');
    const war = await r.room.declare({ folder: path });
    const { cwd } = await r.room.prepareBattle(war.id, 'feat/cart');
    await commit(cwd, 'cart.ts');
    knight(r, 'tristan', cwd, 'feat/cart', false);
    r.writes.ms.tristan = r.clock.now - 3 * DAY * 1000;
    r.pulls = [
      { number: 12, state: 'OPEN', headRefName: 'feat/cart', headRefOid: head(cwd), mergedAt: null },
    ];
    await r.room.poll();
    return { path, war, cwd };
  }
  const battleOf = async (r: Rig) => (await r.room.statusNow()).wars[0]!.battles[0]!;
  const mergeAt = (r: Rig, cwd: string, msAgo: number) => {
    r.pulls = [merged(12, 'feat/cart', head(cwd), r.clock.now - msAgo)];
  };

  it('rewards every Knight who fought a battle once, when its pull request merges', async () => {
    const r = rig();
    const { cwd } = await fought(r);
    expect((await battleOf(r)).state).toBe('holding');
    mergeAt(r, cwd, 60_000);
    await r.room.poll();
    await r.room.poll();
    expect(r.victories).toEqual([['tristan']]);
    const battle = await battleOf(r);
    expect(battle).toMatchObject({ state: 'won', pull: { number: 12, state: 'merged', checks: 'passing' } });
    expect((await r.room.statusNow()).wars[0]!.victories).toBe(1);
  });

  it('clears a won battle’s worktree a day after the merge, when nothing would be lost', async () => {
    const r = rig();
    const { path, cwd } = await fought(r);
    await mkdir(join(cwd, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(join(cwd, 'node_modules', 'left-pad', 'index.js'), '');
    mergeAt(r, cwd, 3600_000);
    await r.room.poll();
    expect(existsSync(cwd)).toBe(true);
    expect((await battleOf(r)).clearGuard).toBe('It merged less than a day ago.');

    r.clock.now += DAY * 1000;
    await r.room.poll();
    expect(existsSync(cwd)).toBe(false);
    // The branch stays: only the folder went.
    expect(git(path, 'branch', '--list', 'feat/cart')).toContain('feat/cart');
    expect(await battleOf(r)).toMatchObject({ state: 'won', worktree: { cleared: true }, clearGuard: null });
  });

  it.each([
    ['an uncommitted file', async (cwd: string) => writeFile(join(cwd, 'draft.ts'), 'x'), 'uncommitted'],
    ['a .env', async (cwd: string) => writeFile(join(cwd, '.env'), 'KEY=1'), 'cannot be rebuilt'],
    [
      'a commit after the pull request',
      async (cwd: string) => commit(cwd, 'late.ts'),
      'did not go into the merge',
    ],
  ])('keeps the worktree when it holds %s', async (_, spoil, text) => {
    const r = rig();
    const { cwd } = await fought(r);
    mergeAt(r, cwd, 2 * DAY * 1000);
    await spoil(cwd);
    await r.room.poll();
    expect(existsSync(cwd)).toBe(true);
    expect((await battleOf(r)).clearGuard).toContain(text);
  });

  it('keeps the worktree while a Knight is in it, or was in the last day', async () => {
    const r = rig();
    const { cwd } = await fought(r);
    mergeAt(r, cwd, 2 * DAY * 1000);
    r.chats.push({ id: 'tristan', cwd, running: true, busy: false });
    await r.room.poll();
    expect(existsSync(cwd)).toBe(true);
    r.chats = [];
    r.writes.ms.tristan = r.clock.now - 3600_000;
    await r.room.poll();
    expect(existsSync(cwd)).toBe(true);
    expect((await battleOf(r)).clearGuard).toContain('Knight');
  });

  it('never clears on its own without gh, or with clearing turned off', async () => {
    for (const setup of [{ gh: false }, { gh: true, off: true }]) {
      await rm(home, { recursive: true, force: true });
      await mkdir(data, { recursive: true });
      const r = rig({ gh: setup.gh });
      const { cwd } = await fought(r);
      if (setup.off) await r.room.updateSettings({ autoClear: false });
      mergeAt(r, cwd, 2 * DAY * 1000);
      // Without gh, git cannot see the win; the user marks it.
      if (!setup.gh) await r.room.mark((await r.room.statusNow()).wars[0]!.id, 'feat/cart', 'won');
      await r.room.poll();
      expect(existsSync(cwd)).toBe(true);
      expect((await battleOf(r)).clearGuard).toContain(setup.gh ? 'turned off' : 'Without gh');
    }
  });

  it('lets the user clear a worktree by hand, but never over files that would be lost', async () => {
    const r = rig();
    const { war, cwd } = await fought(r);
    await writeFile(join(cwd, '.env'), 'KEY=1');
    await expect(r.room.clearField(war.id, 'feat/cart')).rejects.toThrow('.env');
    await rm(join(cwd, '.env'));
    await writeFile(join(cwd, 'draft.ts'), 'x');
    await expect(r.room.clearField(war.id, 'feat/cart')).rejects.toThrow('uncommitted');
    await rm(join(cwd, 'draft.ts'));
    r.chats.push({ id: 'tristan', cwd, running: true, busy: false });
    await expect(r.room.clearField(war.id, 'feat/cart')).rejects.toThrow('working');
    r.chats = [];
    await r.room.clearField(war.id, 'feat/cart');
    expect(existsSync(cwd)).toBe(false);
    await expect(r.room.clearField(war.id, 'feat/cart')).rejects.toMatchObject({ status: 404 });
  });

  it('asks how a battle ended when its branch is gone without a word, and rewards a win once', async () => {
    const r = rig({ gh: false });
    const path = await repo();
    git(path, 'checkout', '-q', '-b', 'feat/x');
    await commit(path, 'x.ts');
    knight(r, 'tristan', path, 'feat/x', false);
    git(path, 'checkout', '-q', 'main');
    const war = await r.room.declare({ folder: path });
    git(path, 'branch', '-D', 'feat/x');
    await r.room.poll();
    let status = await r.room.statusNow();
    expect(status.wars[0]!.battles[0]!.state).toBe('unclear');
    expect(status.waiting).toBe(1);
    status = await r.room.mark(war.id, 'feat/x', 'won');
    await r.room.mark(war.id, 'feat/x', 'won');
    expect(status.wars[0]!.battles[0]!.state).toBe('won');
    expect(status.waiting).toBe(0);
    expect(r.victories).toEqual([['tristan']]);
    await expect(r.room.mark(war.id, 'feat/x', 'maybe')).rejects.toMatchObject({ status: 400 });
    await expect(r.room.mark(war.id, 'nope', 'won')).rejects.toMatchObject({ status: 404 });
  });

  it('counts a merge git can see (a merge commit) as a win without gh', async () => {
    const r = rig({ gh: false });
    const path = await repo();
    const war = await r.room.declare({ folder: path });
    git(path, 'checkout', '-q', '-b', 'feat/m');
    await commit(path, 'm.ts');
    git(path, 'checkout', '-q', 'main');
    await r.room.poll();
    git(path, 'merge', '-q', '--no-ff', '-m', 'merge', 'feat/m');
    await r.room.poll();
    expect((await r.room.statusNow()).wars.find((w) => w.id === war.id)!.battles[0]!.state).toBe('won');
  });
});

describe('battle reports and settings', () => {
  it('writes a free dispatch to the reports folder, and the next one covers only what came after', async () => {
    const r = rig();
    const path = await repo();
    git(path, 'checkout', '-q', '-b', 'feat/cart');
    await commit(path, 'cart.ts');
    knight(r, 'tristan', path, 'feat/cart');
    await r.room.declare({ folder: path, goal: 'Ship the cart' });
    const d = await r.room.report();
    expect(d.date).toBe('2027-03-10');
    expect(d.since).toBeNull();
    expect(d.wars[0]!.fighting.map((b) => b.branch)).toEqual(['feat/cart']);
    const saved = await r.room.readReport('2027-03-10');
    expect(saved.markdown).toContain('# Battle report, 2027-03-10');
    expect(saved.markdown).toContain('**Fighting** (1)\n- Cart (`feat/cart`): tristan');
    expect(await r.room.reports()).toEqual([{ date: '2027-03-10', at: expect.any(Number) }]);
    expect((await r.room.statusNow()).lastReport?.date).toBe('2027-03-10');
    r.clock.now += DAY * 1000;
    expect((await r.room.report()).since).toBe(d.at);
    await expect(r.room.readReport('../../etc')).rejects.toMatchObject({ status: 400 });
    await expect(r.room.readReport('2020-01-01')).rejects.toMatchObject({ status: 404 });
  });

  it('checks settings', async () => {
    const r = rig();
    const s = await r.room.updateSettings({
      stallDays: 5,
      autoClear: false,
      reports: { enabled: true, time: '07:30' },
    });
    expect(s.settings).toMatchObject({
      stallDays: 5,
      autoClear: false,
      reports: { enabled: true, time: '07:30' },
    });
    // Turned on after today's time: today's report is written on the next look, like the Town Crier's.
    expect(s.settings.reports.nextRunAt).toBe(r.clock.now);
    const later = await r.room.updateSettings({ reports: { time: '19:00' } });
    expect(later.settings.reports.nextRunAt).toBe(Date.parse('2027-03-10T19:00:00'));
    await expect(r.room.updateSettings({ stallDays: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(r.room.updateSettings({ reports: { time: '25:00' } })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('the War Room routes', () => {
  const TOKEN = 'a-token-of-sixteen-chars';
  async function app(r: Rig) {
    const started: { cwd: string; name: string; message: string }[] = [];
    const raised: unknown[] = [];
    const court = {
      raise: async (o: unknown) => {
        raised.push(o);
        return { knight: 'k', id: 'k', finished: false, ok: true, reply: 'Still working.' };
      },
    } as unknown as Court;
    const server = Fastify();
    await registerWarRoutes(server, {
      isToken: (t) => t === TOKEN,
      wars: r.room,
      court,
      startKnight: async (o) => {
        started.push(o);
        return { id: 'new-knight' };
      },
    });
    const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, token = TOKEN) =>
      server.inject({
        method,
        url,
        ...(payload ? { payload } : {}),
        headers: { authorization: `Bearer ${token}` },
      });
    return { server, call, started, raised };
  }

  it('refuses every route without the token', async () => {
    const { server } = await app(rig());
    for (const [method, url] of [
      ['GET', '/api/wars'],
      ['POST', '/api/wars'],
      ['POST', '/api/wars/x/knights'],
      ['GET', '/api/king/wars'],
      ['POST', '/api/king/wars/x/knights'],
    ] as const)
      expect((await server.inject({ method, url })).statusCode, url).toBe(401);
  });

  it('declares a war, a battle, and sends the user’s Knight into its worktree', async () => {
    const r = rig();
    const { call, started } = await app(r);
    const path = await repo();
    const declared = await call('POST', '/api/wars', { folder: path, goal: 'Ship' });
    expect(declared.statusCode).toBe(201);
    const war = declared.json() as { id: string };
    expect(
      (await call('POST', `/api/wars/${war.id}/battles`, { title: 'Cart', kind: 'feature' })).statusCode,
    ).toBe(201);
    expect((await call('POST', `/api/wars/${war.id}/knights`, { branch: 'feat/cart' })).statusCode).toBe(400);
    const sent = await call('POST', `/api/wars/${war.id}/knights`, {
      branch: 'feat/cart',
      order: 'Build the cart.',
    });
    expect(sent.statusCode).toBe(201);
    expect(started).toEqual([
      {
        cwd: expect.stringContaining(join('worktrees', 'shop-')),
        name: 'cart',
        message: expect.stringContaining('Build the cart.'),
      },
    ]);
    expect(started[0]!.message).toContain('branch feat/cart only');
    const status = (await call('GET', '/api/wars')).json() as WarStatus;
    expect(status.wars[0]!.battles[0]).toMatchObject({ branch: 'feat/cart', state: 'holding' });
    expect((await call('POST', '/api/wars/nope/battles', { title: 'x' })).statusCode).toBe(404);
  });

  it('gives the King folders and battles, and raises his Knight in the worktree', async () => {
    const r = rig();
    const { call, raised } = await app(r);
    const path = await repo();
    await r.room.declare({ folder: path, name: 'Shop' });
    const view = (await call('GET', '/api/king/wars')).json() as { wars: { folder: string; name: string }[] };
    expect(view.wars).toEqual([expect.objectContaining({ name: 'Shop', folder: path })]);
    expect(
      (await call('POST', '/api/king/wars/Shop/battles', { title: 'Search', kind: 'feature' })).statusCode,
    ).toBe(201);
    const res = await call('POST', '/api/king/wars/shop/knights', {
      branch: 'feat/search',
      order: 'Add search.',
      mode: 'plan',
      waitSeconds: 0,
    });
    expect(res.statusCode).toBe(201);
    expect(raised).toEqual([
      expect.objectContaining({
        name: 'search',
        mode: 'plan',
        order: expect.stringContaining('Add search.'),
      }),
    ]);
    expect((raised[0] as { folder: string }).folder).toContain(join('worktrees', 'shop-'));
  });

  it('runs a report now and reads it back', async () => {
    const r = rig();
    const { call } = await app(r);
    await r.room.declare({ folder: await repo() });
    expect((await call('POST', '/api/wars/reports')).statusCode).toBe(201);
    const listed = (await call('GET', '/api/wars/reports')).json() as { reports: { date: string }[] };
    expect(listed.reports.map((x) => x.date)).toEqual(['2027-03-10']);
    const report = (await call('GET', '/api/wars/reports/2027-03-10')).json() as { markdown: string };
    expect(report.markdown).toContain('## shop');
  });
});
