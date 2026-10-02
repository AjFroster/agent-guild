import { execFile } from 'node:child_process';

import type { GitState, GuildEvent } from '@agent-guild/core';

/**
 * Work that exists only on this machine: for each recent session's folder, how many
 * commits are on no remote branch and how many files are uncommitted. A session can sit
 * idle for days on a computer that then goes offline; this is what says so first.
 *
 * Read-only, and only counts leave this file: no file names, branch contents or commit
 * messages. Git runs without optional locks, so it never blocks a session's own git
 * commands, and with fsmonitor off, so a repository's config cannot start a program.
 */

export type RunGit = (cwd: string, args: string[]) => Promise<string>;

const SAFE = ['--no-optional-locks', '-c', 'core.fsmonitor=false'];

export const runGit: RunGit = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      [...SAFE, ...args],
      { cwd, timeout: 5_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });

/** Entries in `git status --porcelain=v2` output: one per changed or untracked file. */
export function countDirty(porcelain: string): number {
  return porcelain.split('\n').filter((l) => l && !l.startsWith('#')).length;
}

/** The folder's git state, or null when it is not a repository (or git is missing). */
export async function gitState(cwd: string, run: RunGit = runGit): Promise<GitState | null> {
  let status: string;
  try {
    status = await run(cwd, ['status', '--porcelain=v2']);
  } catch {
    return null;
  }
  const dirty = countDirty(status);
  const remotes = await run(cwd, ['remote']).catch(() => '');
  if (!remotes.trim()) return { unpushed: 0, dirty, remote: false };
  // Commits reachable from HEAD but from no remote-tracking branch. Fails on a repository
  // with no commits yet, which has nothing to push either.
  const count = await run(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes']).catch(() => '0');
  const unpushed = Number.parseInt(count.trim(), 10);
  return { unpushed: Number.isFinite(unpushed) ? unpushed : 0, dirty, remote: true };
}

export interface GitWatcherOptions {
  /** Sessions to look at, each with the folder it runs in. */
  sessions: () => { session: string; cwd: string }[];
  onEvents: (events: GuildEvent[]) => void;
  run?: RunGit;
  now?: () => number;
}

export class GitWatcher {
  private readonly opts: GitWatcherOptions;
  /** Last state sent per session, so an event goes out only on a change. */
  private readonly sent = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(opts: GitWatcherOptions) {
    this.opts = opts;
  }

  /** Poll every `everyMs`, the first time after `firstMs` (once sessions are found). */
  start(everyMs = 60_000, firstMs = 5_000): void {
    const first = setTimeout(() => void this.poll(), firstMs);
    first.unref?.();
    this.timer = setInterval(() => void this.poll(), everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Public so tests can drive it without timers. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const byFolder = new Map<string, Promise<GitState | null>>();
      const events: GuildEvent[] = [];
      const t = (this.opts.now?.() ?? Date.now()) / 1000;
      for (const { session, cwd } of this.opts.sessions()) {
        // Sessions in the same folder share one look.
        if (!byFolder.has(cwd)) byFolder.set(cwd, gitState(cwd, this.opts.run));
        const state = await byFolder.get(cwd)!;
        if (!state) continue;
        const key = `${state.unpushed}/${state.dirty}/${state.remote}`;
        if (this.sent.get(session) === key) continue;
        this.sent.set(session, key);
        events.push({ t, session, type: 'git', ...state });
      }
      if (events.length > 0) this.opts.onEvents(events);
    } finally {
      this.polling = false;
    }
  }
}
