import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';

import {
  type Aim,
  type Battle,
  type BattleKind,
  type BattleMemory,
  type BranchFact,
  type Checks,
  type ClearGuard,
  type Dispatch,
  type GuildState,
  type KnightFact,
  type PullFact,
  type War,
  BANNERS,
  BATTLE_KINDS,
  GUARD_TEXT,
  battleTitle,
  battlesOf,
  clearVerdict,
  dispatch,
  dispatchMarkdown,
  isRebuildable,
  nextBanner,
  parseStatusIgnored,
  partyTokens,
  pullFor,
  remember,
  slug,
  totalTokens,
  validBranch,
} from '@agent-guild/core';

import { ChatError } from './chats.ts';
import { type Schedule, isDue, localDate, nextRun } from './crier.ts';
import { type RunGit, runGit } from './git.ts';
import { JsonStore, list } from './jsonStore.ts';

/**
 * The War Room (docs/WARS.md): the user's wars (one repository each) and the battles in
 * them (one branch each). The rules live in core/src/wars.ts; this file gathers the facts
 * for them and keeps the record:
 *
 * - Branches from git, read-only (the same safe flags as git.ts).
 * - Pull requests and their checks from the user's own `gh`, read-only, as states only:
 *   never titles, bodies or commit messages.
 * - Which Knights fight where, from the folders their sessions run in.
 *
 * It writes to a repository in two places only: `git worktree add` when the user or the
 * King sends a Knight to a battle, and `git worktree remove` (never forced) when a won
 * battle's worktree passes every guard, or the user clears it. Git hooks never run for
 * either.
 *
 * The page gets each war's folder name, never its path; the King gets the path.
 */

export type RunGh = (cwd: string, args: string[]) => Promise<string>;

/** `gh`, with no prompts and no colour; the executable can be swapped for tests. */
export const ghRunner =
  (gh = 'gh'): RunGh =>
  (cwd, args) =>
    new Promise((resolve, reject) => {
      execFile(
        gh,
        args,
        {
          cwd,
          timeout: 20_000,
          maxBuffer: 8 * 1024 * 1024,
          env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1' },
        },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });

/** Git that may write (a worktree), given time to check out, and with hooks off. */
export const runGitWrite: RunGit = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args],
      {
        cwd,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (err, stdout, stderr) =>
        err
          ? reject(
              new Error(
                String(stderr || err.message)
                  .trim()
                  .split('\n')
                  .at(-1),
              ),
            )
          : resolve(stdout),
    );
  });

// ------------------------------------------------------------------ reading git and gh

/** The branch pull requests merge into: origin's HEAD, else main, else master, else the folder's own. */
export async function defaultBranch(cwd: string, run: RunGit = runGit): Promise<string> {
  const origin = await run(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '');
  if (origin.trim()) return origin.trim().replace(/^origin\//, '');
  for (const name of ['main', 'master']) {
    const ok = await run(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).then(
      () => true,
      () => false,
    );
    if (ok) return name;
  }
  return (await run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main')).trim();
}

/** `git worktree list --porcelain`: each extra worktree's path and branch (the main one left out). */
export function parseWorktrees(text: string): { path: string; branch: string | null }[] {
  const out: { path: string; branch: string | null }[] = [];
  for (const block of text.split('\n\n')) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (!path) continue;
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
    out.push({ path, branch });
  }
  return out.slice(1);
}

const MAX_BRANCHES = 60;

/** Every local branch with what the battle rules need. */
export async function branchFacts(
  cwd: string,
  base: string,
  run: RunGit = runGit,
): Promise<{ branches: BranchFact[]; worktrees: { path: string; branch: string | null }[] }> {
  const refs = await run(cwd, [
    'for-each-ref',
    '--sort=-committerdate',
    `--count=${MAX_BRANCHES}`,
    '--format=%(refname:short)%09%(committerdate:unix)%09%(objectname)',
    'refs/heads',
  ]);
  const merged = new Set(
    (await run(cwd, ['branch', '--merged', base, '--format=%(refname:short)']).catch(() => ''))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const worktrees = parseWorktrees(await run(cwd, ['worktree', 'list', '--porcelain']).catch(() => ''));
  const branches: BranchFact[] = [];
  for (const line of refs.split('\n')) {
    const [name, when, head] = line.split('\t');
    if (!name || !head || name === base) continue;
    const ahead = Number.parseInt(
      (await run(cwd, ['rev-list', '--count', `${base}..${head}`]).catch(() => '0')).trim(),
      10,
    );
    branches.push({
      name,
      lastCommitAt: Number(when) || 0,
      head,
      ahead: Number.isFinite(ahead) ? ahead : 0,
      mergedByGit: merged.has(name),
      worktree: worktrees.find((w) => w.branch === name)?.path ?? null,
    });
  }
  return { branches, worktrees };
}

interface GhPull {
  number?: unknown;
  state?: unknown;
  headRefName?: unknown;
  headRefOid?: unknown;
  mergedAt?: unknown;
  statusCheckRollup?: unknown;
}

/** A pull request's checks in one word: any failed, else any still running, else passing. */
export function rollup(checks: unknown): Checks | null {
  if (!Array.isArray(checks) || checks.length === 0) return null;
  let pending = false;
  for (const c of checks as Record<string, unknown>[]) {
    // Check runs carry status and conclusion; commit statuses carry state.
    const conclusion = String(c.conclusion ?? '').toUpperCase();
    const status = String(c.status ?? '').toUpperCase();
    const state = String(c.state ?? '').toUpperCase();
    if (['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(conclusion))
      return 'failing';
    if (['FAILURE', 'ERROR'].includes(state)) return 'failing';
    if ((status && status !== 'COMPLETED') || ['PENDING', 'EXPECTED'].includes(state)) pending = true;
  }
  return pending ? 'pending' : 'passing';
}

/** `gh pr list --json ...` output as pull request facts; anything malformed is skipped. */
export function parsePulls(json: string): PullFact[] {
  const raw = JSON.parse(json) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: PullFact[] = [];
  for (const p of raw as GhPull[]) {
    const state = String(p.state ?? '').toLowerCase();
    if (typeof p.number !== 'number' || typeof p.headRefName !== 'string') continue;
    if (state !== 'open' && state !== 'merged' && state !== 'closed') continue;
    const mergedAt = typeof p.mergedAt === 'string' && p.mergedAt ? Date.parse(p.mergedAt) / 1000 : null;
    out.push({
      number: p.number,
      branch: p.headRefName,
      state,
      head: typeof p.headRefOid === 'string' ? p.headRefOid : '',
      mergedAt: mergedAt !== null && Number.isFinite(mergedAt) ? mergedAt : null,
      checks: rollup(p.statusCheckRollup),
    });
  }
  return out;
}

export const GH_PR_ARGS = [
  'pr',
  'list',
  '--state',
  'all',
  '--limit',
  '100',
  '--json',
  'number,state,headRefName,headRefOid,mergedAt,statusCheckRollup',
];

// ------------------------------------------------------------------ the record

export interface WarSettings {
  /** Clear a won battle's worktree on its own when every guard holds. */
  autoClear: boolean;
  /** Days without a commit or a Knight before a battle counts as stalled. */
  stallDays: number;
  /** The daily battle report: off until the user turns it on. */
  reports: Schedule;
}

export const DEFAULT_WAR_SETTINGS: WarSettings = {
  autoClear: true,
  stallDays: 2,
  reports: { enabled: false, time: '18:00', lastRunDate: null },
};

interface WarFile {
  wars: War[];
  settings: WarSettings;
  /** When the last report was written (epoch seconds): the next one covers what came after. */
  lastReportAt: number | null;
}

const shapeWar = (w: Partial<War>): War => ({
  id: String(w.id ?? randomUUID()),
  name: String(w.name ?? 'A war'),
  goal: String(w.goal ?? ''),
  banner: (BANNERS as readonly string[]).includes(String(w.banner)) ? w.banner! : 'Blue',
  folder: String(w.folder ?? ''),
  createdAt: Number(w.createdAt ?? 0),
  archived: w.archived === true,
  aims: list<Aim>(w.aims),
  battles: list<BattleMemory>(w.battles),
});

export class WarStore extends JsonStore<WarFile> {
  constructor(file: string) {
    super(file, (raw) => ({
      wars: list<Partial<War>>(raw.wars).map(shapeWar),
      settings: {
        ...DEFAULT_WAR_SETTINGS,
        ...(raw.settings ?? {}),
        reports: { ...DEFAULT_WAR_SETTINGS.reports, ...(raw.settings?.reports ?? {}) },
      },
      lastReportAt: typeof raw.lastReportAt === 'number' ? raw.lastReportAt : null,
    }));
  }
}

// ------------------------------------------------------------------ what the page and the King see

export interface WarView {
  id: string;
  name: string;
  goal: string;
  banner: War['banner'];
  /** The folder's name only. */
  folder: string;
  archived: boolean;
  /** The war's folder is missing or not a repository any more. */
  problem: string | null;
  defaultBranch: string | null;
  /** `gh` answered for this repository: pull requests and checks are known. */
  gh: boolean;
  battles: (Battle & { clearGuard: string | null })[];
  /** Every Knight fighting in this war, present or not: they wear its banner. */
  knights: string[];
  victories: number;
  tokens: number;
  looseEnds: { unpushed: number; dirty: number };
}

export interface Suggestion {
  /** An opaque key for the folder: its path stays on the server. */
  key: string;
  folder: string;
  knights: number;
}

export interface WarStatus {
  wars: WarView[];
  suggestions: Suggestion[];
  settings: Omit<WarSettings, 'reports'> & {
    reports: { enabled: boolean; time: string; nextRunAt: number | null };
  };
  lastReport: { date: string; at: number } | null;
  /** Battles that need the user: stalled ones, and branches gone with an unknown outcome. */
  waiting: number;
}

// ------------------------------------------------------------------ the War Room

export interface SessionFolder {
  id: string;
  cwd: string;
}

export interface WarRoomOptions {
  dir: string;
  run?: RunGit;
  write?: RunGit;
  /** Null: `gh` is off. Pull requests are then unknown and nothing is cleared on its own. */
  gh: RunGh | null;
  /** A folder inside the user's home, resolved, or a refusal (ChatManager.checkFolder). */
  checkFolder: (raw: unknown) => Promise<string>;
  state: () => GuildState;
  /** Main sessions and the folders they run in (transcripts and the guild's own chats). */
  sessions: () => SessionFolder[];
  /** The guild's chats right now: which are running or mid-turn, and where. */
  chats: () => { id: string; cwd: string; running: boolean; busy: boolean }[];
  /** When a session's transcript last changed (epoch ms). */
  lastWrite: (id: string) => number | null;
  now?: () => Date;
  /** How often `gh` is asked (ms); every poll in tests. */
  ghEveryMs?: number;
  onChange?: (status: WarStatus) => void;
  /** Battles were won: reward the Knights who fought them. */
  onVictory?: (sessions: string[]) => void;
  /** A report was written. */
  onReport?: (d: Dispatch) => void;
}

interface Facts {
  defaultBranch: string;
  branches: BranchFact[];
  worktrees: { path: string; branch: string | null }[];
  pulls: PullFact[] | null;
  knights: (KnightFact & { git: { unpushed: number; dirty: number } | null; tokens: number })[];
  allKnights: string[];
}

const KIND_PREFIX: Record<BattleKind, string> = {
  feature: 'feat',
  fix: 'fix',
  refactor: 'refactor',
  other: 'battle',
};

const inside = (path: string, folder: string) => path === folder || path.startsWith(folder + sep);
const keyOf = (path: string) => createHash('sha256').update(path).digest('hex').slice(0, 16);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class WarRoom {
  readonly store: WarStore;
  private readonly opts: WarRoomOptions;
  private readonly run: RunGit;
  private readonly write: RunGit;
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<void> | null = null;
  private next: Promise<void> | null = null;
  private status: WarStatus | null = null;
  /** Each war's facts from the last poll, and when `gh` was last asked. */
  private facts = new Map<string, Facts & { problem: string | null }>();
  private ghAt = new Map<string, { at: number; pulls: PullFact[] | null }>();
  /** Folder to repository root (or null), for suggestions. */
  private roots = new Map<string, string | null>();
  /** Why the last automatic clearing did not happen, per war and branch. */
  private guards = new Map<string, ClearGuard>();
  private reporting = false;

  constructor(opts: WarRoomOptions) {
    this.opts = opts;
    this.store = new WarStore(join(opts.dir, 'wars.json'));
    this.run = opts.run ?? runGit;
    this.write = opts.write ?? runGitWrite;
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  private seconds(): number {
    return this.now().getTime() / 1000;
  }

  get worktreesDir(): string {
    return join(this.opts.dir, 'worktrees');
  }

  get reportsDir(): string {
    return join(this.opts.dir, 'battle-reports');
  }

  private camp(war: Pick<War, 'id' | 'name'>): string {
    return join(this.worktreesDir, `${slug(war.name)}-${war.id.slice(0, 6)}`);
  }

  start(everyMs = 60_000, firstMs = 4_000): void {
    const first = setTimeout(() => void this.poll(), firstMs);
    first.unref?.();
    this.timer = setInterval(() => {
      void this.poll().then(() => this.maybeReport());
    }, everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The last status, polling once if there is none yet. */
  async statusNow(): Promise<WarStatus> {
    if (!this.status) await this.poll();
    return this.status!;
  }

  /**
   * One pass: gather facts for every war, update the record in one queued change, reward
   * new victories, clear what may be cleared, and tell the page. Calls made while a pass
   * runs share one pass after it, so a change the user just made is always in the answer.
   */
  poll(): Promise<void> {
    if (this.current) {
      this.next ??= this.current.then(() => {
        this.next = null;
        return this.poll();
      });
      return this.next;
    }
    this.current = this.pass().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async pass(): Promise<void> {
    const before = await this.store.read();
    const state = this.opts.state();
    for (const war of before.wars.filter((w) => !w.archived))
      this.facts.set(war.id, await this.gather(war, state));

    const now = this.seconds();
    const won: string[] = [];
    await this.store.change((data) => {
      for (const war of data.wars) {
        const f = this.facts.get(war.id);
        if (war.archived || !f || f.problem) continue;
        const battles = this.battles(war, f, data.settings.stallDays, now);
        const { memory, newlyWon } = remember(war.battles, battles, f.branches, now);
        war.battles = memory;
        for (const m of newlyWon) won.push(...m.knights);
      }
    });
    if (won.length > 0) this.opts.onVictory?.([...new Set(won)]);

    await this.clearFields();
    await this.publish();
  }

  private battles(war: War, f: Facts, stallDays: number, now: number): Battle[] {
    return battlesOf({
      defaultBranch: f.defaultBranch,
      branches: f.branches,
      pulls: f.pulls,
      aims: war.aims,
      memory: war.battles,
      knights: f.knights,
      now,
      stallDays,
    });
  }

  /** Branches, pull requests and Knights for one war. Read-only. */
  private async gather(war: War, state: GuildState): Promise<Facts & { problem: string | null }> {
    const empty = {
      defaultBranch: '',
      branches: [],
      worktrees: [],
      pulls: null,
      knights: [],
      allKnights: [],
    };
    const top = await this.run(war.folder, ['rev-parse', '--show-toplevel']).catch(() => null);
    if (top === null) return { ...empty, problem: 'The folder is missing or no longer a git repository.' };
    const base = await defaultBranch(war.folder, this.run);
    const { branches, worktrees } = await branchFacts(war.folder, base, this.run);

    let pulls: PullFact[] | null = null;
    if (this.opts.gh) {
      const cached = this.ghAt.get(war.id);
      const every = this.opts.ghEveryMs ?? 120_000;
      if (cached && Date.now() - cached.at < every) pulls = cached.pulls;
      else {
        pulls = await this.opts
          .gh(war.folder, GH_PR_ARGS)
          .then(parsePulls)
          .catch(() => null);
        this.ghAt.set(war.id, { at: Date.now(), pulls });
      }
    }

    // Knights whose session runs in the war's folder, its camp of worktrees, or a
    // worktree of its repository anywhere.
    const camp = this.camp(war);
    const trees = [
      ...worktrees,
      ...war.battles.filter((m) => m.worktree).map((m) => ({ path: m.worktree!, branch: m.branch })),
    ];
    const busy = new Map(this.opts.chats().map((c) => [c.id, c.busy]));
    const knights: Facts['knights'] = [];
    const allKnights: string[] = [];
    const seen = new Set<string>();
    for (const s of this.opts.sessions()) {
      if (seen.has(s.id)) continue;
      const tree = trees.find((t) => inside(s.cwd, t.path));
      if (!tree && !inside(s.cwd, war.folder) && !inside(s.cwd, camp)) continue;
      seen.add(s.id);
      allKnights.push(s.id);
      const hero = state.heroes[s.id];
      if (!hero || hero.parentId !== null || hero.crowned || hero.librarian || hero.smith) continue;
      knights.push({
        id: hero.id,
        name: hero.name,
        branch: hero.branch ?? tree?.branch ?? null,
        active: hero.status === 'working' || hero.status === 'needs_you' || busy.get(hero.id) === true,
        lastActiveAt: hero.lastActiveAt,
        git: hero.git,
        tokens: totalTokens(partyTokens(state, hero)),
      });
    }
    return { defaultBranch: base, branches, worktrees, pulls, knights, allKnights, problem: null };
  }

  /** Won battles' worktrees that pass every guard are removed (never forced). */
  private async clearFields(): Promise<void> {
    const data = await this.store.read();
    const now = this.seconds();
    for (const war of data.wars) {
      const f = this.facts.get(war.id);
      if (war.archived || !f || f.problem) continue;
      const battles = this.battles(war, f, data.settings.stallDays, now);
      for (const mem of war.battles) {
        if (!mem.worktree || mem.clearedAt !== null) continue;
        const key = `${war.id}:${mem.branch}`;
        const battle = battles.find((b) => b.branch === mem.branch);
        if (battle?.state !== 'won') {
          this.guards.delete(key);
          continue;
        }
        const exists = await stat(mem.worktree).then(
          (s) => s.isDirectory(),
          () => false,
        );
        if (!exists) {
          // Removed by hand: nothing left to clear.
          await this.markCleared(war.id, mem.branch);
          continue;
        }
        const look = await this.lookInside(mem.worktree);
        const verdict = clearVerdict({
          autoClear: data.settings.autoClear,
          gh: f.pulls !== null,
          pull: f.pulls ? pullFor(f.pulls, mem.branch) : null,
          now,
          knightRunning: this.opts.chats().some((c) => c.running && inside(c.cwd, mem.worktree!)),
          lastKnightWriteAt: this.lastKnightWrite(mem.worktree),
          ...look,
        });
        if (!verdict.clear) {
          this.guards.set(key, verdict.guard);
          continue;
        }
        try {
          await this.write(war.folder, ['worktree', 'remove', mem.worktree]);
          this.guards.delete(key);
          await this.markCleared(war.id, mem.branch);
        } catch {
          // Git refused (something changed since the look): try again next pass.
          this.guards.set(key, 'uncommitted');
        }
      }
    }
  }

  private async lookInside(path: string): Promise<{ dirty: number; ignored: string[]; head: string }> {
    const status = await this.run(path, ['status', '--porcelain=v1', '--ignored']).catch(
      () => '?? unreadable\n',
    );
    const head = (await this.run(path, ['rev-parse', 'HEAD']).catch(() => '')).trim();
    return { ...parseStatusIgnored(status), head };
  }

  private lastKnightWrite(path: string): number | null {
    let last: number | null = null;
    for (const s of this.opts.sessions()) {
      if (!inside(s.cwd, path)) continue;
      const ms = this.opts.lastWrite(s.id);
      if (ms !== null) last = Math.max(last ?? 0, ms / 1000);
    }
    return last;
  }

  private markCleared(warId: string, branch: string): Promise<void> {
    const now = this.seconds();
    return this.store.change((data) => {
      const mem = data.wars.find((w) => w.id === warId)?.battles.find((m) => m.branch === branch);
      if (mem && mem.clearedAt === null) mem.clearedAt = now;
    });
  }

  // ------------------------------------------------------------------ status

  private async publish(): Promise<void> {
    this.status = await this.build();
    this.opts.onChange?.(this.status);
  }

  private async build(): Promise<WarStatus> {
    const data = await this.store.read();
    const now = this.seconds();
    const wars = data.wars.map((war) => this.view(war, data.settings.stallDays, now));
    const settings = data.settings;
    const last = await this.reports().then((r) => r[0] ?? null);
    return {
      wars,
      suggestions: await this.suggestions(data.wars),
      settings: {
        autoClear: settings.autoClear,
        stallDays: settings.stallDays,
        reports: {
          enabled: settings.reports.enabled,
          time: settings.reports.time,
          nextRunAt: nextRun(settings.reports, this.now())?.getTime() ?? null,
        },
      },
      lastReport: last,
      waiting: wars
        .filter((w) => !w.archived)
        .reduce(
          (n, w) => n + w.battles.filter((b) => b.state === 'stalled' || b.state === 'unclear').length,
          0,
        ),
    };
  }

  private view(war: War, stallDays: number, now: number): WarView {
    const f = this.facts.get(war.id);
    const battles = f && !f.problem ? this.battles(war, f, stallDays, now) : [];
    const knights = f?.knights ?? [];
    return {
      id: war.id,
      name: war.name,
      goal: war.goal,
      banner: war.banner,
      folder: basename(war.folder),
      archived: war.archived,
      problem: f?.problem ?? null,
      defaultBranch: f?.defaultBranch || null,
      gh: f?.pulls != null,
      battles: battles.map((b) => {
        const guard = this.guards.get(`${war.id}:${b.branch}`);
        return { ...b, clearGuard: b.state === 'won' && guard ? GUARD_TEXT[guard] : null };
      }),
      knights: [...new Set([...(f?.allKnights ?? []), ...war.battles.flatMap((m) => m.knights)])],
      victories: battles.filter((b) => b.state === 'won').length,
      tokens: knights.reduce((n, k) => n + k.tokens, 0),
      looseEnds: knights.reduce(
        (sum, k) => ({
          unpushed: sum.unpushed + (k.git?.unpushed ?? 0),
          dirty: sum.dirty + (k.git?.dirty ?? 0),
        }),
        { unpushed: 0, dirty: 0 },
      ),
    };
  }

  /** Repositories Knights have worked in that are not wars yet. */
  private async suggestions(wars: War[]): Promise<Suggestion[]> {
    const counts = new Map<string, Set<string>>();
    for (const s of this.opts.sessions()) {
      if (inside(s.cwd, this.opts.dir)) continue;
      if (!this.roots.has(s.cwd)) {
        const top = await this.run(s.cwd, ['rev-parse', '--show-toplevel']).catch(() => '');
        this.roots.set(s.cwd, top.trim() || null);
      }
      const root = this.roots.get(s.cwd);
      if (!root || wars.some((w) => !w.archived && w.folder === root)) continue;
      counts.set(root, (counts.get(root) ?? new Set()).add(s.id));
    }
    return [...counts.entries()]
      .map(([root, ids]) => ({ key: keyOf(root), folder: basename(root), knights: ids.size }))
      .sort((a, b) => b.knights - a.knights);
  }

  // ------------------------------------------------------------------ the user's and the King's changes

  private async find(id: string): Promise<War> {
    const war = (await this.store.read()).wars.find(
      (w) => w.id === id || w.name.toLowerCase() === id.toLowerCase(),
    );
    if (!war) throw new ChatError(404, `No war "${id}". List the wars to see them.`);
    return war;
  }

  /** Declare a war on a repository: by a suggestion's key or by a folder path. */
  async declare(body: { key?: unknown; folder?: unknown; name?: unknown; goal?: unknown }): Promise<WarView> {
    let folder: string | null = null;
    if (typeof body.key === 'string' && body.key) {
      for (const root of this.roots.values()) if (root && keyOf(root) === body.key) folder = root;
      if (!folder) throw new ChatError(404, 'That suggestion is gone. Refresh the War Camp.');
    } else folder = await this.opts.checkFolder(body.folder);
    const top = (await this.run(folder, ['rev-parse', '--show-toplevel']).catch(() => '')).trim();
    if (!top) throw new ChatError(400, 'A war is fought in a git repository: that folder is not one.');
    // The repository's root, resolved like any folder a session may start in.
    const root = await this.opts.checkFolder(top);
    const name = cleanText(body.name, 60) || basename(root);
    const goal = cleanText(body.goal, 300);
    const war = await this.store.change((data) => {
      if (data.wars.some((w) => !w.archived && w.folder === root))
        throw new ChatError(409, `A war is already being fought in ${basename(root)}.`);
      const war = shapeWar({
        id: randomUUID(),
        name,
        goal,
        banner: nextBanner(data.wars),
        folder: root,
        createdAt: this.seconds(),
      });
      data.wars.push(war);
      return war;
    });
    await this.poll();
    return this.status!.wars.find((w) => w.id === war.id)!;
  }

  async update(id: string, patch: { name?: unknown; goal?: unknown; banner?: unknown; archived?: unknown }) {
    const war = await this.find(id);
    if (patch.banner !== undefined && !(BANNERS as readonly string[]).includes(String(patch.banner)))
      throw new ChatError(400, `A banner is one of ${BANNERS.join(', ')}.`);
    await this.store.change((data) => {
      const w = data.wars.find((x) => x.id === war.id)!;
      if (patch.name !== undefined) w.name = cleanText(patch.name, 60) || w.name;
      if (patch.goal !== undefined) w.goal = cleanText(patch.goal, 300);
      if (patch.banner !== undefined) w.banner = patch.banner as War['banner'];
      if (patch.archived !== undefined) {
        const archived = patch.archived === true;
        if (!archived && data.wars.some((x) => x.id !== w.id && !x.archived && x.folder === w.folder))
          throw new ChatError(409, 'Another war is already being fought in that folder.');
        w.archived = archived;
      }
    });
    await this.poll();
    return this.status!;
  }

  /** A war aim: a battle declared ahead of time, on a branch named from its kind and title. */
  async declareBattle(id: string, body: { title?: unknown; kind?: unknown; branch?: unknown }) {
    const war = await this.find(id);
    const title = cleanText(body.title, 100);
    if (!title) throw new ChatError(400, 'Name the battle.');
    const kind = (BATTLE_KINDS as readonly string[]).includes(String(body.kind))
      ? (body.kind as BattleKind)
      : 'feature';
    const branch =
      typeof body.branch === 'string' && body.branch.trim()
        ? body.branch.trim()
        : `${KIND_PREFIX[kind]}/${slug(title)}`;
    if (!validBranch(branch))
      throw new ChatError(400, `"${branch}" is not a branch name the guild will use.`);
    const aim = await this.store.change((data) => {
      const w = data.wars.find((x) => x.id === war.id)!;
      if (
        w.aims.some((a) => a.branch === branch) ||
        w.battles.some((m) => m.branch === branch && m.wonAt === null)
      )
        throw new ChatError(409, `A battle on ${branch} is already declared.`);
      const aim: Aim = { id: randomUUID(), title, kind, branch, createdAt: this.seconds() };
      w.aims.push(aim);
      return aim;
    });
    await this.poll();
    return { war: war.name, battle: aim };
  }

  async withdrawAim(id: string, aimId: string) {
    const war = await this.find(id);
    await this.store.change((data) => {
      const w = data.wars.find((x) => x.id === war.id)!;
      w.aims = w.aims.filter((a) => a.id !== aimId);
    });
    await this.poll();
    return this.status!;
  }

  /** The user says how a battle ended, when the guild could not tell (or to correct it). */
  async mark(id: string, branch: string, outcome: unknown) {
    const war = await this.find(id);
    if (outcome !== 'won' && outcome !== 'retreated' && outcome !== null)
      throw new ChatError(400, 'A battle is marked won or retreated (or null to undo).');
    const now = this.seconds();
    const rewarded: string[] = [];
    await this.store.change((data) => {
      const w = data.wars.find((x) => x.id === war.id)!;
      const mem = w.battles.find((m) => m.branch === branch);
      if (!mem) throw new ChatError(404, `No battle on ${branch} in ${w.name}.`);
      mem.mark = outcome;
      if (outcome === 'won' && mem.wonAt === null) {
        mem.wonAt = now;
        rewarded.push(...mem.knights);
      }
    });
    if (rewarded.length) this.opts.onVictory?.(rewarded);
    await this.poll();
    return this.status!;
  }

  /**
   * Where a Knight fights a battle: its worktree, made now if needed (the branch from the
   * default branch when it does not exist yet). The war's own folder when it is already on
   * that branch.
   */
  async prepareBattle(id: string, branch: string): Promise<{ war: War; cwd: string; brief: string }> {
    const war = await this.find(id);
    if (war.archived) throw new ChatError(409, `${war.name} has ended.`);
    if (!validBranch(branch))
      throw new ChatError(400, `"${branch}" is not a branch name the guild will use.`);
    const base = await defaultBranch(war.folder, this.run);
    if (branch === base)
      throw new ChatError(400, `Battles are fought on their own branches, not on ${base}.`);
    const current = (
      await this.run(war.folder, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')
    ).trim();
    const { branches, worktrees } = await branchFacts(war.folder, base, this.run);
    let cwd: string;
    if (current === branch) cwd = war.folder;
    else {
      const existing = worktrees.find((w) => w.branch === branch);
      if (existing) cwd = existing.path;
      else {
        cwd = join(this.camp(war), slug(branch));
        await mkdir(this.camp(war), { recursive: true });
        const exists = branches.some((b) => b.name === branch);
        await this.write(
          war.folder,
          exists ? ['worktree', 'add', cwd, branch] : ['worktree', 'add', '-b', branch, cwd, base],
        ).catch((err: Error) => {
          throw new ChatError(409, `Git could not make a worktree for ${branch}: ${err.message}`);
        });
      }
    }
    const now = this.seconds();
    const title = await this.store.change((data) => {
      const w = data.wars.find((x) => x.id === war.id)!;
      let mem = w.battles.find((m) => m.branch === branch);
      if (!mem) {
        mem = {
          branch,
          firstSeen: now,
          aheadSeen: false,
          knights: [],
          mark: null,
          wonAt: null,
          worktree: null,
          clearedAt: null,
        };
        w.battles.push(mem);
      }
      if (cwd !== war.folder) {
        mem.worktree = cwd;
        mem.clearedAt = null;
      }
      return w.aims.find((a) => a.branch === branch)?.title ?? battleTitle(branch);
    });
    const brief = [
      `You are fighting a battle for the guild: "${title}", in the war "${war.name}"${war.goal ? ` (its goal: ${war.goal})` : ''}.`,
      `Work on the branch ${branch} only, in this folder${cwd !== war.folder ? ' (a git worktree of the repository)' : ''}. Do not switch branches.`,
      'When the work is done and checked, commit it, push the branch and open a pull request.',
    ].join('\n');
    return { war, cwd, brief };
  }

  /** Called once a Knight has been sent: the battle shows it at once. */
  async sent(): Promise<void> {
    await this.poll();
  }

  /** The user clears a won (or any) battle's worktree: never forced, and never over files that would be lost. */
  async clearField(id: string, branch: string) {
    const war = await this.find(id);
    const mem = war.battles.find((m) => m.branch === branch);
    if (!mem?.worktree || mem.clearedAt !== null)
      throw new ChatError(404, 'That battle has no worktree to clear.');
    if (this.opts.chats().some((c) => c.running && inside(c.cwd, mem.worktree!)))
      throw new ChatError(409, 'A Knight is working in that worktree. Stop it first.');
    const exists = await stat(mem.worktree).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (exists) {
      const look = await this.lookInside(mem.worktree);
      if (look.dirty > 0)
        throw new ChatError(
          409,
          `It has ${look.dirty} uncommitted or untracked files. Commit or remove them first.`,
        );
      const keep = look.ignored.filter((p) => !isRebuildable(p));
      if (keep.length > 0)
        throw new ChatError(
          409,
          `It holds ignored files that would be lost: ${keep.slice(0, 5).join(', ')}${keep.length > 5 ? '…' : ''}.`,
        );
      await this.write(war.folder, ['worktree', 'remove', mem.worktree]).catch((err: Error) => {
        throw new ChatError(409, `Git would not remove it: ${err.message}`);
      });
    }
    await this.markCleared(war.id, branch);
    await this.poll();
    return this.status!;
  }

  async updateSettings(patch: {
    autoClear?: unknown;
    stallDays?: unknown;
    reports?: { enabled?: unknown; time?: unknown };
  }) {
    const out: Partial<WarSettings> = {};
    if (patch.autoClear !== undefined) out.autoClear = patch.autoClear === true;
    if (patch.stallDays !== undefined) {
      const n = Number(patch.stallDays);
      if (!Number.isInteger(n) || n < 1 || n > 60)
        throw new ChatError(400, 'Stall days must be from 1 to 60.');
      out.stallDays = n;
    }
    const reports = patch.reports;
    if (
      reports?.time !== undefined &&
      (typeof reports.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(reports.time))
    )
      throw new ChatError(400, 'Time must be HH:MM, 24-hour.');
    await this.store.change((data) => {
      Object.assign(data.settings, out);
      if (reports?.enabled !== undefined) data.settings.reports.enabled = reports.enabled === true;
      if (typeof reports?.time === 'string') data.settings.reports.time = reports.time;
    });
    await this.poll();
    return this.status!;
  }

  // ------------------------------------------------------------------ for the King

  /** Every war with its folder and battles: what the King plans with. */
  async kingView() {
    const status = await this.statusNow();
    const data = await this.store.read();
    return {
      wars: status.wars
        .filter((w) => !w.archived)
        .map((w) => ({
          id: w.id,
          name: w.name,
          goal: w.goal,
          folder: data.wars.find((x) => x.id === w.id)?.folder ?? null,
          problem: w.problem,
          defaultBranch: w.defaultBranch,
          pullRequestsKnown: w.gh,
          victories: w.victories,
          battles: w.battles.map((b) => ({
            branch: b.branch,
            title: b.title,
            kind: b.kind,
            state: b.state,
            knights: b.knights.map((k) => `${k.name}${k.active ? ' (working)' : ''}`),
            pullRequest: b.pull
              ? `#${b.pull.number} ${b.pull.state}${b.pull.checks ? `, checks ${b.pull.checks}` : ''}`
              : null,
          })),
        })),
      lastReport: status.lastReport,
    };
  }

  // ------------------------------------------------------------------ battle reports

  private async maybeReport(): Promise<void> {
    const { settings } = await this.store.read();
    if (!this.reporting && isDue(settings.reports, this.now())) await this.report();
  }

  /** Write today's dispatch: free, from the guild's own record and git. */
  async report(): Promise<Dispatch> {
    this.reporting = true;
    try {
      await this.poll();
      const data = await this.store.read();
      const now = this.seconds();
      const date = localDate(this.now());
      const d = dispatch(
        this.status!.wars.filter((w) => !w.archived && !w.problem).map((w) => ({
          war: { ...w, battles: data.wars.find((x) => x.id === w.id)?.battles ?? [] },
          battles: w.battles,
          looseEnds: w.looseEnds,
          tokens: w.tokens,
        })),
        data.lastReportAt,
        now,
        date,
      );
      await mkdir(this.reportsDir, { recursive: true });
      await writeFile(join(this.reportsDir, `${date}.md`), dispatchMarkdown(d), { mode: 0o600 });
      await writeFile(join(this.reportsDir, `${date}.json`), JSON.stringify(d, null, 2) + '\n', {
        mode: 0o600,
      });
      await this.store.change((x) => {
        x.lastReportAt = now;
        x.settings.reports.lastRunDate = date;
      });
      this.opts.onReport?.(d);
      await this.publish();
      return d;
    } finally {
      this.reporting = false;
    }
  }

  /** Reports written, newest first. */
  async reports(): Promise<{ date: string; at: number }[]> {
    const files = await readdir(this.reportsDir).catch(() => [] as string[]);
    const out: { date: string; at: number }[] = [];
    for (const f of files) {
      const date = f.replace(/\.json$/, '');
      if (!f.endsWith('.json') || !DATE.test(date)) continue;
      const at = await stat(join(this.reportsDir, f)).then(
        (s) => s.mtimeMs / 1000,
        () => 0,
      );
      out.push({ date, at });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  async readReport(date: string): Promise<{ date: string; markdown: string; dispatch: Dispatch }> {
    if (!DATE.test(date)) throw new ChatError(400, 'A report is named by its date, YYYY-MM-DD.');
    try {
      const markdown = await readFile(join(this.reportsDir, `${date}.md`), 'utf8');
      const d = JSON.parse(await readFile(join(this.reportsDir, `${date}.json`), 'utf8')) as Dispatch;
      return { date, markdown, dispatch: d };
    } catch {
      throw new ChatError(404, `No battle report for ${date}.`);
    }
  }
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
}
