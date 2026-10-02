import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type GuildEvent, replay, roster } from '@agent-guild/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TranscriptWatcher } from './watcher.ts';

let root: string;
let events: GuildEvent[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'guild-'));
  events = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const line = (obj: object) => JSON.stringify(obj) + '\n';
const at = (s: number) => new Date(Date.UTC(2026, 8, 30, 12, 0, s)).toISOString();
const tool = (s: number, name: string) => ({
  type: 'assistant',
  timestamp: at(s),
  cwd: '/home/someone/Sandbox/movie-league',
  message: {
    content: [{ type: 'tool_use', name, input: { secret: 'do not leak' } }],
    stop_reason: 'tool_use',
  },
});

function watcher(opts: Partial<ConstructorParameters<typeof TranscriptWatcher>[0]> = {}) {
  return new TranscriptWatcher({
    root,
    maxAgeMs: 0,
    idleMs: 0,
    onEvents: (e) => events.push(...e),
    ...opts,
  });
}

describe('TranscriptWatcher', () => {
  it('starts a hero named after the project, then follows new lines only', async () => {
    const project = join(root, '-home-someone-Sandbox-movie-league');
    await mkdir(project);
    const file = join(project, 'sess-1.jsonl');
    await writeFile(
      file,
      line({ type: 'user', timestamp: at(0), message: { content: 'secret prompt' } }) + line(tool(1, 'Read')),
    );

    const w = watcher();
    await w.scan();
    await appendFile(file, line(tool(2, 'Edit')));
    await w.scan();
    await w.scan(); // nothing new: must not repeat events

    // The user's line is an order: only that it happened, never its text.
    expect(events.map((e) => e.type)).toEqual(['session_start', 'ordered', 'tool', 'tool']);
    const state = replay(events);
    expect(state.heroes['sess-1']).toMatchObject({ name: 'movie-league', location: 'forge' });
    expect(JSON.stringify(events)).not.toMatch(/secret|do not leak/);
  });

  it('counts the tokens of a reply written over several lines once, across scans', async () => {
    const project = join(root, 'p');
    await mkdir(project);
    const file = join(project, 's.jsonl');
    const part = (s: number, name: string) => ({
      ...tool(s, name),
      message: { ...tool(s, name).message, id: 'msg_1', usage: { input_tokens: 7, output_tokens: 90 } },
    });
    await writeFile(file, line(part(1, 'Read')) + line(part(1, 'Grep')));
    const w = watcher();
    await w.scan();
    await appendFile(file, line(part(1, 'Edit')));
    await w.scan();
    expect(replay(events).heroes.s!.tokens).toEqual({ input: 7, output: 90, cacheRead: 0, cacheWrite: 0 });
  });

  it('holds a half-written line until its newline arrives', async () => {
    const project = join(root, 'p');
    await mkdir(project);
    const file = join(project, 's.jsonl');
    const full = JSON.stringify(tool(1, 'Bash'));
    await writeFile(file, line(tool(0, 'Read')) + full.slice(0, 20));
    const w = watcher();
    await w.scan();
    expect(events.filter((e) => e.type === 'tool')).toHaveLength(1);
    await appendFile(file, full.slice(20) + '\n');
    await w.scan();
    expect(events.filter((e) => e.type === 'tool')).toHaveLength(2);
  });

  it('adds a sub-agent to its leader’s party, named from its meta file', async () => {
    const project = join(root, 'p');
    const subDir = join(project, 'lead', 'subagents');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(project, 'lead.jsonl'), line(tool(0, 'Agent')));
    // A sub-agent's transcript opens with its Knight's prompt, which is not an order.
    const prompt = { type: 'user', timestamp: at(1), message: { role: 'user', content: 'Find the callers' } };
    await writeFile(join(subDir, 'agent-abc.jsonl'), line(prompt) + line(tool(1, 'Grep')));
    await writeFile(join(subDir, 'agent-abc.meta.json'), JSON.stringify({ agentType: 'Explore' }));

    await watcher().scan();
    const state = replay(events);
    expect(events.filter((e) => e.type === 'ordered')).toEqual([]);
    expect(roster(state).map((h) => h.name)).toEqual(['movie-league', 'Explore']);
    expect(state.heroes['agent-abc']).toMatchObject({ parentId: 'lead', location: 'library' });
  });

  it('skips transcripts older than the max age', async () => {
    const project = join(root, 'p');
    await mkdir(project);
    const file = join(project, 'old.jsonl');
    await writeFile(file, line(tool(0, 'Read')));
    const old = new Date(Date.now() - 10 * 3_600_000);
    await utimes(file, old, old);
    await watcher({ maxAgeMs: 3_600_000 }).scan();
    expect(events).toEqual([]);
  });

  it('sends a silent session home, and brings it back when it writes again', async () => {
    const project = join(root, 'p');
    await mkdir(project);
    const file = join(project, 's.jsonl');
    await writeFile(file, line(tool(0, 'Read')));
    let now = Date.now();
    const w = watcher({ idleMs: 60_000, now: () => now });
    await w.scan();
    now += 120_000;
    await w.scan();
    expect(events.at(-1)?.type).toBe('session_end');

    await appendFile(file, line(tool(5, 'Edit')));
    now = Date.now(); // the write just happened
    await w.scan();
    const state = replay(events);
    expect(state.heroes.s).toMatchObject({ status: 'working', name: 'movie-league' });
  });

  it('survives a corrupt line and a missing projects directory', async () => {
    const project = join(root, 'p');
    await mkdir(project);
    await writeFile(join(project, 's.jsonl'), '{not json\n' + line(tool(1, 'Read')));
    await watcher().scan();
    expect(events.map((e) => e.type)).toEqual(['session_start', 'tool']);

    const missing = new TranscriptWatcher({
      root: join(root, 'nope'),
      maxAgeMs: 0,
      idleMs: 0,
      onEvents: () => {},
    });
    await expect(missing.scan()).resolves.toBeUndefined();
  });

  it('forwards model and branch only when they change', async () => {
    const project = join(root, 'p');
    await mkdir(project);
    const withMeta = (s: number, branch: string) => ({
      ...tool(s, 'Read'),
      gitBranch: branch,
      message: { model: 'claude-opus-5-5', content: [], stop_reason: 'tool_use' },
    });
    await writeFile(
      join(project, 's.jsonl'),
      line(withMeta(0, 'main')) + line(withMeta(1, 'main')) + line(withMeta(2, 'feat/x')),
    );
    await watcher().scan();
    const metas = events.filter((e) => e.type === 'meta');
    expect(metas.map((e) => e.type === 'meta' && e.branch)).toEqual(['main', 'feat/x']);
  });
});
