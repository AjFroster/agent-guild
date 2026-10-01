import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChatError, ChatManager, type ChildLike } from './chats.ts';

/** A stand-in for a `claude -p` process: records what it was sent, emits what we script. */
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  sent: unknown[] = [];
  killedWith: string | null = null;
  readonly cmd: string;
  readonly args: string[];
  readonly cwd: string;
  constructor(cmd: string, args: string[], cwd: string) {
    super();
    this.cmd = cmd;
    this.args = args;
    this.cwd = cwd;
    this.stdin.on('data', (d: Buffer) => {
      for (const line of d.toString('utf8').split('\n').filter(Boolean)) this.sent.push(JSON.parse(line));
    });
  }
  emitLine(obj: unknown) {
    this.stdout.write(JSON.stringify(obj) + '\n');
  }
  kill(signal?: NodeJS.Signals) {
    this.killedWith = signal ?? 'SIGTERM';
    setImmediate(() => this.emit('exit', 130));
    return true;
  }
}

let home: string;
let project: string;
let children: FakeChild[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'guild-home-'));
  project = join(home, 'proj');
  await mkdir(project);
  children = [];
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function manager(extra: { allowBypass?: boolean } = {}) {
  return new ChatManager({
    ...extra,
    claude: 'claude',
    home,
    spawn: (cmd, args, o) => {
      const c = new FakeChild(cmd, args, o.cwd);
      children.push(c);
      return c as unknown as ChildLike;
    },
  });
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe('ChatManager.start', () => {
  it('refuses to skip permission checks unless the guild allows it', async () => {
    const off = manager();
    await expect(off.start({ cwd: project, mode: 'bypassPermissions', message: 'go' })).rejects.toMatchObject(
      { status: 403 },
    );
    expect(children).toHaveLength(0);

    const on = manager({ allowBypass: true });
    await on.start({ cwd: project, mode: 'bypassPermissions', message: 'go' });
    expect(children[0]!.args.join(' ')).toContain('--permission-mode bypassPermissions');
  });

  it('refuses to switch a running chat to skipping checks', async () => {
    const m = manager();
    const info = await m.start({ cwd: project, message: 'hi' });
    expect(() => m.send(info.id, 'now go wild', 'bypassPermissions')).toThrow(ChatError);
  });

  it('starts claude headless with a fixed session id and sends the first message', async () => {
    const m = manager();
    const info = await m.start({ cwd: project, name: 'Fixer', message: 'Fix the bug' });
    const child = children[0]!;
    expect(child.cwd).toBe(project);
    expect(child.args).toEqual(
      expect.arrayContaining(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json']),
    );
    expect(child.args.join(' ')).toContain(`--session-id ${info.id}`);
    expect(child.args.join(' ')).toContain('--permission-mode acceptEdits');
    await tick();
    expect(child.sent).toEqual([
      { type: 'user', message: { role: 'user', content: 'Fix the bug' }, parent_tool_use_id: null },
    ]);
    expect(m.get(info.id)!.items[0]).toMatchObject({ kind: 'user', text: 'Fix the bug' });
  });

  it('refuses folders outside home, missing folders, unknown modes and empty messages', async () => {
    const m = manager();
    await expect(m.start({ cwd: tmpdir(), message: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(m.start({ cwd: join(home, 'nope'), message: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(m.start({ cwd: project, message: 'x', mode: 'yolo' as never })).rejects.toBeInstanceOf(
      ChatError,
    );
    await expect(m.start({ cwd: project, message: '   ' })).rejects.toMatchObject({ status: 400 });
    expect(children).toHaveLength(0);
  });
});

describe('ChatManager streaming and lifecycle', () => {
  it('turns the process output into chat items and notifies subscribers', async () => {
    const m = manager();
    const info = await m.start({ cwd: project, message: 'Hi' });
    const seen: string[] = [];
    m.subscribe(info.id, (c) => c.type === 'item' && seen.push(c.item.kind));
    const child = children[0]!;
    child.emitLine({ type: 'system', subtype: 'init', model: 'claude-opus-5-5' });
    child.emitLine({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hello' }] } });
    child.emitLine({ type: 'result', subtype: 'success', result: 'Hello', total_cost_usd: 0.001 });
    await tick();
    expect(seen).toEqual(['assistant', 'result']);
    expect(m.get(info.id)!.info.busy).toBe(false);
  });

  it('stays busy through a second turn until its result, and waitForTurn returns its reply', async () => {
    const m = manager();
    const info = await m.start({ cwd: project, message: 'Hi' });
    const child = children[0]!;
    child.emitLine({ type: 'system', subtype: 'init' });
    child.emitLine({ type: 'result', subtype: 'success', result: 'first' });
    await tick();

    m.send(info.id, 'Again');
    const waiting = m.waitForTurn(info.id, 5_000);
    // The second turn's first line carries no busy signal of its own; it must not end the turn.
    child.emitLine({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm2' } } });
    await tick();
    expect(m.get(info.id)!.info.busy).toBe(true);
    child.emitLine({
      type: 'assistant',
      message: { id: 'm2', content: [{ type: 'text', text: 'Second answer' }] },
    });
    child.emitLine({ type: 'result', subtype: 'success', result: 'Second answer' });
    expect(await waiting).toEqual({ done: true, ok: true, reply: 'Second answer' });
  });

  it('resumes the same session with a new process after the first one exits', async () => {
    const m = manager();
    const info = await m.start({ cwd: project, message: 'One' });
    m.stop(info.id);
    expect(children[0]!.killedWith).toBe('SIGINT');
    await tick();
    expect(m.get(info.id)!.info.running).toBe(false);

    m.send(info.id, 'Two');
    const second = children[1]!;
    expect(second.args.join(' ')).toContain(`--resume ${info.id}`);
    expect(second.args).not.toContain('--session-id');
  });

  it('notes an unexpected exit in the chat', async () => {
    const m = manager();
    const info = await m.start({ cwd: project, message: 'Hi' });
    children[0]!.stderr.write('boom\n');
    await tick();
    children[0]!.emit('exit', 2);
    await tick();
    expect(m.get(info.id)!.items.at(-1)).toMatchObject({ kind: 'notice', tone: 'error' });
    expect(m.get(info.id)!.items.at(-1)).toMatchObject({ text: expect.stringContaining('boom') });
  });

  it('adopts an existing session with its history and continues it by resuming', async () => {
    const m = manager();
    const id = '0f1e2d3c-4b5a-4968-8776-655443322110';
    await m.adopt(id, project, 'old', [{ kind: 'user', id: 'u', t: 1, text: 'earlier' }]);
    expect(m.get(id)!.items).toHaveLength(1);
    m.send(id, 'and now');
    expect(children[0]!.args.join(' ')).toContain(`--resume ${id}`);
  });

  it('caps how many sessions run at once', async () => {
    const m = new ChatManager({
      claude: 'claude',
      home,
      maxRunning: 1,
      spawn: (cmd, args, o) => new FakeChild(cmd, args, o.cwd) as unknown as ChildLike,
    });
    await m.start({ cwd: project, message: 'a' });
    await expect(m.start({ cwd: project, message: 'b' })).rejects.toMatchObject({ status: 429 });
  });

  it('makes room by closing the longest-idle process, which resumes on its next message', async () => {
    const spawned: FakeChild[] = [];
    const m = new ChatManager({
      claude: 'claude',
      home,
      maxRunning: 2,
      spawn: (cmd, args, o) => {
        const c = new FakeChild(cmd, args, o.cwd);
        spawned.push(c);
        return c as unknown as ChildLike;
      },
    });
    const finish = (c: FakeChild) => c.emitLine({ type: 'result', subtype: 'success', result: 'ok' });
    const a = await m.start({ cwd: project, message: 'a' });
    finish(spawned[0]!);
    await tick();
    await new Promise((r) => setTimeout(r, 5));
    const b = await m.start({ cwd: project, message: 'b' });
    finish(spawned[1]!);
    await tick();

    // Both idle and the cap reached: a third closes the one idle longest, a.
    await m.start({ cwd: project, message: 'c' });
    expect(m.get(a.id)!.info.running).toBe(false);
    expect(m.get(b.id)!.info.running).toBe(true);
    // a is not lost: its next message resumes it (closing b, now the longest idle).
    m.send(a.id, 'again');
    expect(spawned.at(-1)!.args.join(' ')).toContain(`--resume ${a.id}`);
  });

  it('runs helpers in their own pool, closing each when its turn ends: a Knight is never evicted', async () => {
    const spawned: FakeChild[] = [];
    const m = new ChatManager({
      claude: 'claude',
      home,
      maxRunning: 1,
      maxHelpers: 1,
      spawn: (cmd, args, o) => {
        const c = new FakeChild(cmd, args, o.cwd);
        spawned.push(c);
        return c as unknown as ChildLike;
      },
    });
    const finish = (c: FakeChild) => c.emitLine({ type: 'result', subtype: 'success', result: 'ok' });
    const knight = await m.start({ cwd: project, message: 'work' });
    finish(spawned[0]!);
    await tick();
    // The Knights' pool is full (idle), yet a helper starts without closing the Knight.
    const scout = await m.start({ cwd: project, message: 'scout', helper: true });
    expect(m.get(knight.id)!.info.running).toBe(true);
    // Mid-turn, the helpers' pool is full: another helper waits, the Knight is untouched.
    await expect(m.start({ cwd: project, message: 'review', helper: true })).rejects.toMatchObject({
      status: 429,
    });
    // The helper's turn ends: its process closes at once, freeing its slot.
    finish(spawned[1]!);
    await tick();
    expect(m.get(scout.id)!.info.running).toBe(false);
    expect(m.get(knight.id)!.info.running).toBe(true);
    await m.start({ cwd: project, message: 'review', helper: true });
    expect(m.get(knight.id)!.info.running).toBe(true);
  });

  it('tells subscribers when an item is dropped, such as a duplicated login reply', async () => {
    const m = manager();
    const info = await m.start({ cwd: project, message: 'Hi' });
    const removed: string[] = [];
    m.subscribe(info.id, (c) => c.type === 'remove' && removed.push(c.id));
    const child = children[0]!;
    child.emitLine({
      type: 'assistant',
      message: { id: 'login', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
    });
    child.emitLine({ type: 'result', subtype: 'success', result: 'Not logged in · Please run /login' });
    await tick();
    expect(removed).toEqual(['login']);
    expect(m.get(info.id)!.info.loginRequired).toBe(true);
  });
});
