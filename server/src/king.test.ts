import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { type GuildEvent, replay } from '@agent-guild/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChatManager, type ChildLike } from './chats.ts';
import { Court, KING_TOOLS } from './king.ts';
import { TOOLS, handle } from './kingMcp.ts';

/** A `claude -p` stand-in that answers each message with "Done: <message>". */
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  readonly args: string[];
  readonly cwd: string;
  /** Set false to keep a turn running, as a slow Knight would. */
  answers = !silent;
  constructor(args: string[], cwd: string) {
    super();
    this.args = args;
    this.cwd = cwd;
    let n = 0;
    this.stdin.on('data', (d: Buffer) => {
      for (const line of d.toString('utf8').split('\n').filter(Boolean)) {
        const text = String(JSON.parse(line).message.content);
        if (!this.answers) continue;
        n += 1;
        setImmediate(() => {
          this.emitLine({
            type: 'assistant',
            message: { id: `m${n}`, content: [{ type: 'text', text: `Done: ${text}` }] },
          });
          this.emitLine({ type: 'result', subtype: 'success', is_error: false, result: `Done: ${text}` });
        });
      }
    });
  }
  emitLine(obj: unknown) {
    this.stdout.write(JSON.stringify(obj) + '\n');
  }
  kill() {
    setImmediate(() => this.emit('exit', 130));
    return true;
  }
}

/** New children take their time: turns stay running until a test says otherwise. */
let silent = false;
let home: string;
let children: FakeChild[];
let events: GuildEvent[];
let lastWrites: Map<string, number>;
const NOW = 1_000_000_000_000;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'guild-king-'));
  await mkdir(join(home, 'proj'));
  await mkdir(join(home, 'other'));
  children = [];
  silent = false;
  events = [];
  lastWrites = new Map();
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function setup() {
  const chats = new ChatManager({
    claude: 'claude',
    home,
    spawn: (_cmd, args, o) => {
      const c = new FakeChild(args, o.cwd);
      children.push(c);
      return c as unknown as ChildLike;
    },
  });
  const court = new Court({
    dir: join(home, '.agent-guild'),
    chats,
    state: () => replay(events),
    sessionOf: (id) =>
      events.some((e) => e.session === id) ? { cwd: join(home, 'proj'), file: '/dev/null', name: id } : null,
    lastWrite: (id) => lastWrites.get(id) ?? null,
    // Knights in these tests were never chats: adopt them as the routes would.
    open: async (id) => chats.get(id) ?? chats.adopt(id, join(home, 'proj'), id, []),
    guildUrl: 'http://127.0.0.1:4747',
    token: 'secret-token-0123456789',
    now: () => NOW,
  });
  return { chats, court };
}

const knight = (id: string, name: string, t = 0): GuildEvent[] => [
  { t, session: id, type: 'session_start', name },
];
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

describe('Court.speak', () => {
  it('crowns a King on the first message, in its throne room, with only its tools', async () => {
    const { court } = setup();
    const { id } = await court.speak('Build me a standings page');
    expect(court.kingId).toBe(id);
    const child = children[0]!;
    expect(child.cwd).toBe(court.throneRoom);
    const args = child.args.join(' ');
    expect(args).toContain('--permission-mode default');
    expect(args).toContain(`--allowedTools ${KING_TOOLS.join(',')}`);
    expect(args).toContain(`--mcp-config ${court.mcpConfigFile}`);
    expect(args).toContain('You are the King');

    // The record survives a restart.
    const saved = JSON.parse(await readFile(join(home, '.agent-guild', 'king.json'), 'utf8'));
    expect(saved.id).toBe(id);
  });

  it('writes the MCP config with the token readable only by the user', async () => {
    const { court } = setup();
    await court.speak('hello');
    const config = JSON.parse(await readFile(court.mcpConfigFile, 'utf8'));
    expect(config.mcpServers.guild.env).toEqual({
      GUILD_URL: 'http://127.0.0.1:4747',
      GUILD_TOKEN: 'secret-token-0123456789',
    });
    expect(config.mcpServers.guild.args[0]).toMatch(/kingMcp\.ts$/);
    expect((await stat(court.mcpConfigFile)).mode & 0o777).toBe(0o600);
  });

  it('talks to the same King after that', async () => {
    const { court } = setup();
    const first = await court.speak('one');
    events.push(...knight(first.id, 'King'));
    const second = await court.speak('two');
    expect(second.id).toBe(first.id);
    expect(children).toHaveLength(1);
  });
});

describe('Court orders', () => {
  it('lists Knights with their folder, not the King or sub-agents', async () => {
    const { court } = setup();
    const { id: king } = await court.speak('hi');
    events.push(
      ...knight(king, 'King'),
      { t: 0, session: king, type: 'crown' },
      ...knight(ID_A, 'Percival', 1),
      { t: 2, session: 'sub', type: 'subagent_start', parent: ID_A, name: 'Scout' },
    );
    const list = court.knights();
    expect(list.map((k) => k.name)).toEqual(['Percival']);
    expect(list[0]).toMatchObject({ folder: join(home, 'proj'), party: ['Scout (worker, idle)'] });
  });

  it("gives an order by name and returns the Knight's answer", async () => {
    const { court } = setup();
    events.push(...knight(ID_A, 'Percival'));
    const result = await court.command('percival', { order: 'Add a test' });
    expect(result).toMatchObject({ knight: 'Percival', finished: true, ok: true, reply: 'Done: Add a test' });
    expect(court.commanded.has(ID_A)).toBe(true);
  });

  it('returns at once with wait 0, so several Knights can work together', async () => {
    const { court } = setup();
    events.push(...knight(ID_A, 'Percival'), ...knight(ID_B, 'Gawain'));
    silent = true;
    const [a, b] = await Promise.all([
      court.command('Percival', { order: 'Long job', waitSeconds: 0 }),
      court.command('Gawain', { order: 'Other job', waitSeconds: 0 }),
    ]);
    expect([a.finished, b.finished]).toEqual([false, false]);
    expect(a.reply).toContain('read_knight("Percival")');
    expect(children).toHaveLength(2); // both are working at once
  });

  it('refuses to interrupt a Knight mid-turn', async () => {
    const { court, chats } = setup();
    events.push(...knight(ID_A, 'Percival'));
    await court.command('Percival', { order: 'first', waitSeconds: 0 });
    children[0]!.answers = false;
    chats.send(ID_A, 'still going');
    await expect(court.command('Percival', { order: 'second' })).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to talk over a session someone is using in a terminal', async () => {
    const { court } = setup();
    events.push(...knight(ID_A, 'Percival'));
    lastWrites.set(ID_A, NOW - 10_000);
    await expect(court.command('Percival', { order: 'x' })).rejects.toMatchObject({ status: 409 });
    lastWrites.set(ID_A, NOW - 120_000);
    await expect(court.command('Percival', { order: 'x' })).resolves.toMatchObject({ finished: true });
  });

  it('refuses orders to the King himself, to nobody, and to an ambiguous name', async () => {
    const { court } = setup();
    const { id: king } = await court.speak('hi');
    events.push(
      ...knight(king, 'King'),
      { t: 0, session: king, type: 'crown' },
      ...knight(ID_A, 'Twin'),
      ...knight(ID_B, 'twin'),
    );
    await expect(court.command(king, { order: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(court.command('Nobody', { order: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(court.command('twin', { order: 'x' })).rejects.toMatchObject({ status: 409 });
  });

  it('raises a new Knight in a folder, but never one that skips permission checks', async () => {
    const { court } = setup();
    const result = await court.raise({ folder: join(home, 'other'), name: 'Gawain', order: 'Fix the sync' });
    expect(result).toMatchObject({ knight: 'Gawain', reply: 'Done: Fix the sync' });
    expect(children.at(-1)!.cwd).toBe(join(home, 'other'));
    await expect(
      court.raise({ folder: join(home, 'other'), name: 'Mordred', order: 'x', mode: 'bypassPermissions' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(court.raise({ folder: '/etc', name: 'Outside', order: 'x' })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('can order a Knight it just raised, before the guild has read its transcript', async () => {
    const { court } = setup();
    await court.raise({ folder: join(home, 'other'), name: 'Gawain', order: 'Start' });
    // No events for Gawain yet: only the guild's own chat knows him.
    await expect(court.command('gawain', { order: 'Next' })).resolves.toMatchObject({
      reply: 'Done: Next',
    });
  });

  it("reads a Knight's latest messages", async () => {
    const { court } = setup();
    events.push(...knight(ID_A, 'Percival'));
    await court.command('Percival', { order: 'Report' });
    const read = await court.read('Percival', 5);
    expect(read.messages).toEqual([
      { from: 'order', text: 'Report' },
      { from: 'knight', text: 'Done: Report' },
    ]);
  });
});

describe('King MCP server', () => {
  const calls: [string, string, unknown][] = [];
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    calls.push([method, path, body]);
    if (path.includes('Mordred')) throw new Error('No Knight called "Mordred".');
    return { ok: true };
  };

  it('answers the handshake and lists its tools', async () => {
    const init = await handle(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      call,
    );
    expect(init).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
    });
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, call)).toBeNull();
    const list = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, call)) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });

  it('maps a tool call to its guild route', async () => {
    await handle(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'command_knight',
          arguments: { knight: 'Sir Percival', order: 'Go', wait_seconds: 0 },
        },
      },
      call,
    );
    expect(calls.at(-1)).toEqual([
      'POST',
      '/api/king/knights/Sir%20Percival/orders',
      { order: 'Go', waitSeconds: 0 },
    ]);
  });

  it('hands a refusal back as a tool error the King can read', async () => {
    const answer = await handle(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'read_knight', arguments: { knight: 'Mordred' } },
      },
      call,
    );
    expect(answer).toMatchObject({
      result: { isError: true, content: [{ text: 'No Knight called "Mordred".' }] },
    });
    const unknown = await handle(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'burn_castle' } },
      call,
    );
    expect(unknown).toMatchObject({ error: { code: -32602 } });
  });
});

describe('King MCP server over stdio', () => {
  it('runs as its own process, speaking one JSON-RPC message per line', async () => {
    const { createServer } = await import('node:http');
    const { spawn } = await import('node:child_process');
    const seen: string[] = [];
    const guild = createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ knights: [{ name: 'Percival' }] }));
    });
    await new Promise<void>((r) => guild.listen(0, '127.0.0.1', r));
    const port = (guild.address() as { port: number }).port;
    const child = spawn(process.execPath, [join(import.meta.dirname, 'kingMcp.ts')], {
      env: { ...process.env, GUILD_URL: `http://127.0.0.1:${port}`, GUILD_TOKEN: 'tok' },
    });
    const lines: unknown[] = [];
    let buffer = '';
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString('utf8');
      for (let i = buffer.indexOf('\n'); i !== -1; i = buffer.indexOf('\n')) {
        lines.push(JSON.parse(buffer.slice(0, i)));
        buffer = buffer.slice(i + 1);
      }
    });
    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_knights', arguments: {} } });
    for (let i = 0; i < 100 && lines.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    child.kill();
    guild.close();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ id: 2, result: { content: [{ type: 'text' }] } });
    expect(JSON.stringify(lines[1])).toContain('Percival');
    expect(seen).toEqual(['GET /api/king/knights Bearer tok']);
  });
});
