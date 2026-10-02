import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GuildEvent } from '@agent-guild/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitWatcher, countDirty, gitState } from './git.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'guild-git-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    stdio: 'pipe',
  }).toString();

async function repo(name: string): Promise<string> {
  const path = join(dir, name);
  git(dir, 'init', '-q', '-b', 'main', path);
  return path;
}

async function commit(path: string, file: string) {
  await writeFile(join(path, file), file);
  git(path, 'add', file);
  git(path, 'commit', '-q', '-m', `add ${file}`);
}

describe('gitState', () => {
  it('is null outside a repository', async () => {
    expect(await gitState(dir)).toBeNull();
    expect(await gitState(join(dir, 'missing'))).toBeNull();
  });

  it('counts uncommitted files and says when there is no remote', async () => {
    const path = await repo('local');
    await commit(path, 'a.txt');
    await writeFile(join(path, 'a.txt'), 'changed');
    await writeFile(join(path, 'new.txt'), 'x');
    expect(await gitState(path)).toEqual({ unpushed: 0, dirty: 2, remote: false });
  });

  it('counts commits on no remote branch, with or without an upstream', async () => {
    const origin = join(dir, 'origin.git');
    git(dir, 'init', '-q', '--bare', origin);
    const path = await repo('work');
    git(path, 'remote', 'add', 'origin', origin);
    await commit(path, 'a.txt');
    git(path, 'push', '-q', 'origin', 'main');
    expect(await gitState(path)).toEqual({ unpushed: 0, dirty: 0, remote: true });

    // A new branch never pushed: no upstream, which is how work gets stranded.
    git(path, 'checkout', '-q', '-b', 'feat/x');
    await commit(path, 'b.txt');
    await commit(path, 'c.txt');
    expect(await gitState(path)).toEqual({ unpushed: 2, dirty: 0, remote: true });
  });

  it('treats a repository with a remote but no commits as nothing to push', async () => {
    const path = await repo('empty');
    git(path, 'remote', 'add', 'origin', join(dir, 'nowhere.git'));
    expect(await gitState(path)).toEqual({ unpushed: 0, dirty: 0, remote: true });
  });
});

describe('countDirty', () => {
  it('counts entries and skips header lines', () => {
    expect(countDirty('# branch.oid abc\n# branch.head main\n1 .M N... a\n? b\n')).toBe(2);
    expect(countDirty('')).toBe(0);
  });
});

describe('GitWatcher', () => {
  it('sends a session state once, again only when it changes, and looks at a folder once', async () => {
    const calls: string[] = [];
    let dirty = '1 .M N... a\n';
    const events: GuildEvent[] = [];
    const w = new GitWatcher({
      sessions: () => [
        { session: 'a', cwd: '/repo' },
        { session: 'b', cwd: '/repo' },
        { session: 'c', cwd: '/not-a-repo' },
      ],
      onEvents: (e) => events.push(...e),
      now: () => 5_000,
      run: async (cwd, args) => {
        calls.push(`${cwd} ${args[0]}`);
        if (cwd === '/not-a-repo') throw new Error('not a git repository');
        if (args[0] === 'status') return dirty;
        if (args[0] === 'remote') return 'origin\n';
        return '3\n';
      },
    });
    await w.poll();
    expect(events).toEqual([
      { t: 5, session: 'a', type: 'git', unpushed: 3, dirty: 1, remote: true },
      { t: 5, session: 'b', type: 'git', unpushed: 3, dirty: 1, remote: true },
    ]);
    expect(calls.filter((c) => c.startsWith('/repo status'))).toHaveLength(1);

    await w.poll();
    expect(events).toHaveLength(2);
    dirty = '';
    await w.poll();
    expect(events.slice(2).map((e) => e.type === 'git' && e.dirty)).toEqual([0, 0]);
  });
});
