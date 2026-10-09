/**
 * Wars and Battles (docs/WARS.md): the guild's projects and the branches of work in them.
 *
 * A war is one repository folder the user declared, with a goal and a banner its Knights
 * wear. A battle is one branch in it: a feature, a fix, a refactor. This file holds the
 * rules, as pure functions over facts the server gathers (branches from git, pull
 * requests from `gh`, Knights from the guild): what state each battle is in, when a won
 * battle's worktree may be cleared, and what the battle report says. Times are epoch
 * seconds, like guild events.
 */

export type BattleKind = 'feature' | 'fix' | 'refactor' | 'other';

/**
 * - planned: a war aim no one has started (no branch yet).
 * - fighting: a Knight is working on it right now.
 * - holding: open, nobody on it this moment, but not stalled.
 * - stalled: no commit and no Knight on it for the stall time.
 * - won: its pull request merged (or, without `gh`, git saw it merged).
 * - retreated: dropped (its pull request closed and the branch deleted, or the user said so).
 * - unclear: the branch is gone and nothing says whether it won: the War Room asks.
 */
export type BattleState = 'planned' | 'fighting' | 'holding' | 'stalled' | 'won' | 'retreated' | 'unclear';

export const BATTLE_KINDS: readonly BattleKind[] = ['feature', 'fix', 'refactor', 'other'];

/** The banner colours a war can fly: the Knights' team colours (gold is the King's). */
export const BANNERS = ['Blue', 'Red', 'Purple', 'Green', 'Orange', 'Pink', 'Black'] as const;
export type Banner = (typeof BANNERS)[number];

export const DAY = 86_400;

/** How long a won battle's worktree waits after the merge before it may be cleared. */
export const CLEAR_AFTER_S = DAY;

// ------------------------------------------------------------------ what the store keeps

export interface Aim {
  id: string;
  title: string;
  kind: BattleKind;
  /** The branch it will be fought on. */
  branch: string;
  createdAt: number;
}

/** What the guild remembers about a battle between polls (a branch can disappear). */
export interface BattleMemory {
  branch: string;
  firstSeen: number;
  /** The branch was once ahead of the default branch: a later git merge is a real win. */
  aheadSeen: boolean;
  /** Every Knight seen fighting it, so a victory can reward them after they leave. */
  knights: string[];
  /** The user said how it ended, when the guild could not tell. */
  mark: 'won' | 'retreated' | null;
  /** When the guild first saw it won (for "won since the last report" and the clearing wait). */
  wonAt: number | null;
  /** The worktree the guild made for it, and when the guild cleared it. */
  worktree: string | null;
  clearedAt: number | null;
}

export interface War {
  id: string;
  name: string;
  goal: string;
  banner: Banner;
  /** The repository folder (absolute). Kept on the server and told to the King; the page gets its name only. */
  folder: string;
  createdAt: number;
  archived: boolean;
  aims: Aim[];
  battles: BattleMemory[];
}

// ------------------------------------------------------------------ facts from outside

export interface BranchFact {
  name: string;
  /** Its latest commit's time. */
  lastCommitAt: number;
  head: string;
  /** Commits on it that the default branch lacks. */
  ahead: number;
  /** `git branch --merged <default>` lists it. */
  mergedByGit: boolean;
  /** A worktree has it checked out (not the war's main folder). */
  worktree: string | null;
}

export type Checks = 'passing' | 'failing' | 'pending';

export interface PullFact {
  number: number;
  branch: string;
  state: 'open' | 'merged' | 'closed';
  /** The commit the pull request ends at. */
  head: string;
  mergedAt: number | null;
  checks: Checks | null;
}

export interface KnightFact {
  id: string;
  name: string;
  /** The branch its folder is on (a battle's worktree, or the war's own folder). */
  branch: string | null;
  /** Working on a turn or waiting on the user right now. */
  active: boolean;
  lastActiveAt: number;
}

// ------------------------------------------------------------------ battles

export interface Battle {
  branch: string;
  title: string;
  kind: BattleKind;
  state: BattleState;
  /** Knights on it now. */
  knights: { id: string; name: string; active: boolean }[];
  pull: { number: number; state: PullFact['state']; checks: Checks | null } | null;
  /** Its latest commit or Knight activity; null for a planned battle. */
  lastActivityAt: number | null;
  ahead: number;
  wonAt: number | null;
  worktree: { cleared: boolean; clearedAt: number | null } | null;
  /** A war aim declared ahead of time. */
  aimId: string | null;
}

/** A battle's kind from the branch prefix the repo already uses. */
export function battleKind(branch: string): BattleKind {
  const prefix = branch.split('/')[0]!.toLowerCase();
  if (['feat', 'feature', 'features'].includes(prefix)) return 'feature';
  if (['fix', 'bugfix', 'hotfix', 'bug'].includes(prefix)) return 'fix';
  if (['refactor', 'chore', 'cleanup', 'perf'].includes(prefix)) return 'refactor';
  return 'other';
}

/** "feat/activity-feed" reads as "Activity feed". */
export function battleTitle(branch: string): string {
  const parts = branch.split('/');
  const last = (parts.length > 1 ? parts.slice(1).join(' ') : parts[0]!).replace(/[-_]+/g, ' ').trim();
  return last ? last[0]!.toUpperCase() + last.slice(1) : branch;
}

/** The pull request that speaks for a branch: an open one, else the latest merged, else the latest closed. */
export function pullFor(pulls: readonly PullFact[], branch: string): PullFact | null {
  const mine = pulls.filter((p) => p.branch === branch).sort((a, b) => b.number - a.number);
  return (
    mine.find((p) => p.state === 'open') ??
    mine.find((p) => p.state === 'merged') ??
    mine.find((p) => p.state === 'closed') ??
    null
  );
}

export interface BattleInput {
  defaultBranch: string;
  branches: readonly BranchFact[];
  /** Null when `gh` is not available: then wins come from git alone. */
  pulls: readonly PullFact[] | null;
  aims: readonly Aim[];
  memory: readonly BattleMemory[];
  knights: readonly KnightFact[];
  now: number;
  stallDays: number;
}

const ORDER: Record<BattleState, number> = {
  fighting: 0,
  stalled: 1,
  unclear: 2,
  holding: 3,
  planned: 4,
  won: 5,
  retreated: 6,
};

/** Every battle in a war, the ones that need eyes first. */
export function battlesOf(input: BattleInput): Battle[] {
  const branches = new Map(input.branches.map((b) => [b.name, b]));
  const memory = new Map(input.memory.map((m) => [m.branch, m]));
  const aims = new Map(input.aims.map((a) => [a.branch, a]));
  const names = new Set([...branches.keys(), ...memory.keys(), ...aims.keys()]);
  names.delete(input.defaultBranch);

  const battles: Battle[] = [];
  for (const branch of names) {
    const fact = branches.get(branch) ?? null;
    const mem = memory.get(branch) ?? null;
    const aim = aims.get(branch) ?? null;
    const pull = input.pulls ? pullFor(input.pulls, branch) : null;
    const knights = input.knights.filter((k) => k.branch === branch);
    const activity = [fact?.lastCommitAt ?? -Infinity, ...knights.map((k) => k.lastActiveAt)];
    const lastActivityAt = fact || knights.length > 0 ? Math.max(...activity) : null;

    let state: BattleState;
    if (mem?.mark) state = mem.mark;
    else if (pull?.state === 'merged') state = 'won';
    else if (fact && fact.mergedByGit && mem?.aheadSeen && fact.ahead === 0 && pull?.state !== 'open')
      state = 'won';
    else if (!fact) {
      if (!mem) state = 'planned';
      else if (pull?.state === 'closed') state = 'retreated';
      else if (mem.wonAt !== null) state = 'won';
      else state = 'unclear';
    } else if (knights.some((k) => k.active)) state = 'fighting';
    else if (lastActivityAt !== null && input.now - lastActivityAt > input.stallDays * DAY) state = 'stalled';
    else state = 'holding';

    battles.push({
      branch,
      title: aim?.title ?? battleTitle(branch),
      kind: aim?.kind ?? battleKind(branch),
      state,
      knights: knights.map((k) => ({ id: k.id, name: k.name, active: k.active })),
      pull: pull ? { number: pull.number, state: pull.state, checks: pull.checks } : null,
      lastActivityAt: lastActivityAt === -Infinity ? null : lastActivityAt,
      ahead: fact?.ahead ?? 0,
      wonAt: state === 'won' ? (mem?.wonAt ?? pull?.mergedAt ?? input.now) : null,
      worktree: mem?.worktree ? { cleared: mem.clearedAt !== null, clearedAt: mem.clearedAt } : null,
      aimId: aim?.id ?? null,
    });
  }
  return battles.sort(
    (a, b) => ORDER[a.state] - ORDER[b.state] || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
  );
}

/**
 * The memory after a poll: new branches remembered, Knights added, "ahead" noted, and the
 * moment each battle was first seen won. Returns the battles that were won just now, so
 * the server can reward their Knights once.
 */
export function remember(
  before: readonly BattleMemory[],
  battles: readonly Battle[],
  branches: readonly BranchFact[],
  now: number,
): { memory: BattleMemory[]; newlyWon: BattleMemory[] } {
  const byBranch = new Map(before.map((m) => [m.branch, { ...m, knights: [...m.knights] }]));
  const facts = new Map(branches.map((b) => [b.name, b]));
  const newlyWon: BattleMemory[] = [];
  for (const battle of battles) {
    if (battle.state === 'planned') continue;
    const fact = facts.get(battle.branch);
    const mem = byBranch.get(battle.branch) ?? {
      branch: battle.branch,
      firstSeen: now,
      aheadSeen: false,
      knights: [],
      mark: null,
      wonAt: null,
      worktree: null,
      clearedAt: null,
    };
    if (fact && fact.ahead > 0) mem.aheadSeen = true;
    for (const k of battle.knights) if (!mem.knights.includes(k.id)) mem.knights.push(k.id);
    if (battle.state === 'won' && mem.wonAt === null) {
      mem.wonAt = battle.wonAt ?? now;
      newlyWon.push(mem);
    }
    byBranch.set(battle.branch, mem);
  }
  return { memory: [...byBranch.values()], newlyWon };
}

// ------------------------------------------------------------------ clearing the field

export type ClearGuard =
  'off' | 'no-gh' | 'not-merged' | 'too-soon' | 'knight' | 'uncommitted' | 'not-pr-head' | 'ignored-files';

export const GUARD_TEXT: Record<ClearGuard, string> = {
  off: 'Automatic clearing is turned off.',
  'no-gh': 'Without gh the guild cannot tell a squash merge from an abandoned branch.',
  'not-merged': 'Its pull request has not merged.',
  'too-soon': 'It merged less than a day ago.',
  knight: 'A Knight is still in it, or was in the last day.',
  uncommitted: 'It has uncommitted or untracked files.',
  'not-pr-head': "Its last commit is not the pull request's: some work there did not go into the merge.",
  'ignored-files': 'It holds ignored files that cannot be rebuilt (a .env, say).',
};

/** Ignored output that a build or an install puts back: safe to lose with a worktree. */
const REBUILDABLE = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'test-results',
  'playwright-report',
  'e2e-screenshots',
  '.vite',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.svelte-kit',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.venv',
  'venv',
  'target',
  '.gradle',
]);
const REBUILDABLE_FILES = [/\.tsbuildinfo$/, /^\.eslintcache$/, /\.log$/, /^\.DS_Store$/, /\.pyc$/];

/** Whether an ignored path (as `git status --ignored` prints it) is rebuildable output. */
export function isRebuildable(path: string): boolean {
  const parts = path.replace(/\/+$/, '').split('/');
  if (parts.some((p) => REBUILDABLE.has(p))) return true;
  const name = parts.at(-1) ?? '';
  return REBUILDABLE_FILES.some((re) => re.test(name));
}

export interface ClearInput {
  autoClear: boolean;
  gh: boolean;
  pull: PullFact | null;
  now: number;
  /** A Knight's session is running in the worktree right now. */
  knightRunning: boolean;
  /** The last time any Knight's transcript in that folder was written, or null. */
  lastKnightWriteAt: number | null;
  /** Changed or untracked files in the worktree. */
  dirty: number;
  /** The worktree's last commit. */
  head: string;
  /** Ignored paths in the worktree. */
  ignored: readonly string[];
}

export type ClearVerdict = { clear: true } | { clear: false; guard: ClearGuard };

/** Whether a won battle's worktree may be cleared on its own: every guard, in the doc's order. */
export function clearVerdict(i: ClearInput): ClearVerdict {
  const no = (guard: ClearGuard): ClearVerdict => ({ clear: false, guard });
  if (!i.autoClear) return no('off');
  if (!i.gh) return no('no-gh');
  if (!i.pull || i.pull.state !== 'merged' || i.pull.mergedAt === null) return no('not-merged');
  if (i.now - i.pull.mergedAt < CLEAR_AFTER_S) return no('too-soon');
  if (i.knightRunning || (i.lastKnightWriteAt !== null && i.now - i.lastKnightWriteAt < CLEAR_AFTER_S))
    return no('knight');
  if (i.dirty > 0) return no('uncommitted');
  if (i.head !== i.pull.head) return no('not-pr-head');
  if (i.ignored.some((p) => !isRebuildable(p))) return no('ignored-files');
  return { clear: true };
}

/** `git status --porcelain=v1 --ignored`: changed or untracked files, and ignored paths. */
export function parseStatusIgnored(text: string): { dirty: number; ignored: string[] } {
  let dirty = 0;
  const ignored: string[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (line.startsWith('!! ')) ignored.push(line.slice(3));
    else dirty += 1;
  }
  return { dirty, ignored };
}

// ------------------------------------------------------------------ names and banners

/** A branch name the guild will create or check out: git's rules, kept strict. */
export function validBranch(name: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(name)) return false;
  if (name.includes('..') || name.includes('//') || name.includes('/.') || name.includes('@{')) return false;
  return !name.endsWith('/') && !name.endsWith('.') && !name.endsWith('.lock');
}

/** A short name for folders: lowercase letters, digits and dashes. */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'war'
  );
}

/** The first banner no other war flies, or the least used one. */
export function nextBanner(wars: readonly Pick<War, 'banner' | 'archived'>[]): Banner {
  const used = new Map<Banner, number>(BANNERS.map((b) => [b, 0]));
  for (const w of wars) if (!w.archived) used.set(w.banner, (used.get(w.banner) ?? 0) + 1);
  return [...BANNERS].sort((a, b) => used.get(a)! - used.get(b)!)[0]!;
}

// ------------------------------------------------------------------ the battle report

export interface WarDispatch {
  id: string;
  name: string;
  goal: string;
  banner: Banner;
  won: Battle[];
  fighting: Battle[];
  stalled: Battle[];
  holding: Battle[];
  unclear: Battle[];
  planned: number;
  /** Worktrees the guild cleared since the last report. */
  cleared: string[];
  looseEnds: { unpushed: number; dirty: number };
  tokens: number;
  victories: number;
}

export interface Dispatch {
  /** Local date, "YYYY-MM-DD". */
  date: string;
  at: number;
  since: number | null;
  wars: WarDispatch[];
}

export interface DispatchInput {
  war: Pick<War, 'id' | 'name' | 'goal' | 'banner' | 'battles'>;
  battles: readonly Battle[];
  looseEnds: { unpushed: number; dirty: number };
  tokens: number;
}

/** The dispatch: per war, what was won since the last report, what is under way, what is stuck. */
export function dispatch(
  input: readonly DispatchInput[],
  since: number | null,
  now: number,
  date: string,
): Dispatch {
  const after = (t: number | null) => t !== null && (since === null || t > since);
  return {
    date,
    at: now,
    since,
    wars: input.map(({ war, battles, looseEnds, tokens }) => ({
      id: war.id,
      name: war.name,
      goal: war.goal,
      banner: war.banner,
      won: battles.filter((b) => b.state === 'won' && after(b.wonAt)),
      fighting: battles.filter((b) => b.state === 'fighting'),
      stalled: battles.filter((b) => b.state === 'stalled'),
      holding: battles.filter((b) => b.state === 'holding'),
      unclear: battles.filter((b) => b.state === 'unclear'),
      planned: battles.filter((b) => b.state === 'planned').length,
      cleared: war.battles.filter((m) => after(m.clearedAt)).map((m) => m.branch),
      looseEnds,
      tokens,
      victories: battles.filter((b) => b.state === 'won').length,
    })),
  };
}

const list = (battles: readonly Battle[], extra: (b: Battle) => string = () => '') =>
  battles.map((b) => `- ${b.title} (\`${b.branch}\`)${extra(b)}`);

/** The dispatch as Markdown, for the reports folder and the War Room. */
export function dispatchMarkdown(d: Dispatch): string {
  const lines = [`# Battle report, ${d.date}`, ''];
  if (d.wars.length === 0) lines.push('No wars declared yet.');
  for (const w of d.wars) {
    lines.push(`## ${w.name}`, '');
    if (w.goal) lines.push(`_${w.goal}_`, '');
    const quiet =
      w.won.length + w.fighting.length + w.stalled.length + w.holding.length + w.unclear.length === 0;
    if (w.won.length)
      lines.push(
        `**Won** (${w.won.length})`,
        ...list(w.won, (b) => (b.pull ? `, #${b.pull.number}` : '')),
        '',
      );
    if (w.fighting.length)
      lines.push(
        `**Fighting** (${w.fighting.length})`,
        ...list(w.fighting, (b) => (b.knights.length ? `: ${b.knights.map((k) => k.name).join(', ')}` : '')),
        '',
      );
    if (w.stalled.length) lines.push(`**Stalled** (${w.stalled.length})`, ...list(w.stalled), '');
    if (w.unclear.length)
      lines.push(`**Branch gone, outcome unknown** (${w.unclear.length})`, ...list(w.unclear), '');
    if (w.holding.length) lines.push(`**Holding** (${w.holding.length})`, ...list(w.holding), '');
    if (quiet) lines.push('All quiet on this front.', '');
    const facts = [
      `${w.victories} ${w.victories === 1 ? 'victory' : 'victories'} in all`,
      `${w.planned} planned`,
      `${w.tokens.toLocaleString('en-US')} tokens spent by its Knights`,
    ];
    if (w.looseEnds.unpushed || w.looseEnds.dirty)
      facts.push(
        `loose ends: ${w.looseEnds.unpushed} unpushed commits, ${w.looseEnds.dirty} uncommitted files`,
      );
    if (w.cleared.length) facts.push(`fields cleared: ${w.cleared.map((b) => `\`${b}\``).join(', ')}`);
    lines.push(facts.join(' · '), '');
  }
  return lines.join('\n').trimEnd() + '\n';
}
