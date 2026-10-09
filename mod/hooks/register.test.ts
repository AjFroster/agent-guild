import type { On, PromptSubmitResult, SessionStartResult, TurnCompleteResult } from 'claude-code';
import { type Engine, expect, mock, test } from 'claude-code/testing';

/**
 * The Herald against a fake guild: every `$` call the mod makes beneath it is answered
 * here, so nothing leaves the test. The checks follow docs/MOD.md, goal G4.
 */

const TOKEN = 'tok-0123456789abcdef-SECRET';
const SESSION = 'sess-1';
const SURFACE = { cwd: '/home/hero/quest', surface: 'terminal', isInteractive: true } as const;
const KNIGHT = { name: 'Ser Quill', rank: 'knight', level: 3, xp: 320, status: 'working' };

type Fetch = { url: string; method: string; headers: Record<string, string>; body?: string };
type Answer = { status: number; text?: string } | 'reject' | 'hang';

/**
 * A guild that answers each path with `answer`, and records every request, status line,
 * toast, copy and log line the mod made.
 */
type Beneath = {
  permission?: object;
  tool?: object;
  prompt?: (text: string) => PromptSubmitResult;
  turn?: TurnCompleteResult;
  start?: SessionStartResult;
};

function world(
  on: On,
  answer: (path: string) => Answer = guildUp(),
  {
    token = `${TOKEN}\n`,
    beneath = {},
    session = SESSION,
  }: { token?: string | null; beneath?: Beneath; session?: string } = {},
) {
  const clock = mock.clock(on);
  mock.env(on, { HOME: '/home/hero' });
  const fetches: Fetch[] = [];
  const statuses: (string | undefined)[] = [];
  const toasts: string[] = [];
  const copies: string[] = [];
  const logs: string[] = [];
  const reads: string[] = [];
  on('fs.read', (_$, e) => {
    reads.push(e.path);
    if (token === null) throw new Error('ENOENT');
    return { value: token };
  });
  on('session.id', () => ({ value: session }));
  on('http.fetch', async (_$, e) => {
    const url = new URL(e.url);
    fetches.push({
      url: e.url,
      method: e.init?.method ?? 'GET',
      headers: { ...e.init?.headers },
      ...(e.init?.body === undefined ? {} : { body: e.init.body }),
    });
    const a = answer(url.pathname);
    if (a === 'reject') throw new Error('ECONNREFUSED');
    if (a === 'hang') await clock.sleep(10 * 60_000);
    if (typeof a === 'string') throw new Error('unreachable');
    return { value: { status: a.status, ok: a.status < 300, headers: {}, text: a.text ?? '' } };
  });
  on('ui.status', (_$, e) => {
    statuses.push(e.text);
    return { value: undefined };
  });
  on('ui.toast', (_$, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on('ui.copy', (_$, e) => {
    copies.push(e.text);
    return { value: { isCopied: true } };
  });
  on('ui.log', (_$, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  // What sits beneath the mod on each event it hooks: the engine's own answers.
  on('session.start', (_$, e) => beneath.start ?? { cwd: e.cwd });
  on('classic.PermissionRequest', () => beneath.permission ?? {});
  on('tool.call', () => (beneath.tool ?? { result: { ok: true }, text: 'read 3 lines' }) as never);
  on('prompt.submit', (_$, e) => beneath.prompt?.(e.text) ?? { text: e.text });
  on('turn.complete', () => beneath.turn ?? { text: 'done' });
  on('command.register', (_$, e) => ({ value: { command: e.name } }));
  const signals = () => fetches.filter((f) => f.url.endsWith('/api/signal'));
  const heroAsks = () => fetches.filter((f) => f.url.includes('/api/hero/'));
  return { clock, fetches, statuses, toasts, copies, logs, reads, signals, heroAsks };
}

/** A guild that is up and knows this session's hero, `hero()` read at each ask. */
function guildUp(hero: () => object = () => KNIGHT): (path: string) => Answer {
  return (path) => {
    if (path === '/api/health') return { status: 200, text: '{"ok":true}' };
    if (path === '/api/signal') return { status: 204 };
    if (path === `/api/hero/${SESSION}`) return { status: 200, text: JSON.stringify(hero()) };
    return { status: 404, text: '{"error":"No such hero."}' };
  };
}

const permission = ($: Engine) =>
  $.classic.PermissionRequest({
    session_id: SESSION,
    tool_name: 'Read',
    tool_input: { file_path: '/home/hero/quest/README.md' },
  });

const readFile = ($: Engine) => $.tool.call({ tool: 'Read', file_path: '/home/hero/quest/README.md' });

const finishTurn = ($: Engine) =>
  $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' });

const submit = ($: Engine, text: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } });

const runGuild = ($: Engine) =>
  $.command.run({
    command: 'guild',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  });

test('a permission prompt sends exactly one POST, with only the session and the kind', async ($, on) => {
  const w = world(on);
  await permission($);
  await w.clock.settle();
  expect(w.signals()).toHaveLength(1);
  const [sent] = w.signals();
  expect(sent?.url).toBe('http://127.0.0.1:4747/api/signal');
  expect(sent?.method).toBe('POST');
  expect(JSON.parse(sent?.body ?? 'null')).toEqual({ session: SESSION, kind: 'permission' });
  expect(Object.keys(JSON.parse(sent?.body ?? '{}')).sort()).toEqual(['kind', 'session']);
  expect(sent?.headers).toEqual({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' });
  // Nothing of the tool call it waits on goes along.
  expect(JSON.stringify(w.fetches)).not.toContain('README');
  expect(w.reads).toEqual(['/home/hero/.agent-guild/token']);
});

test('cleared is sent once, after the call the prompt held comes back', async ($, on) => {
  const w = world(on);
  await permission($);
  await readFile($);
  await readFile($);
  await w.clock.settle();
  expect(w.signals().map((s) => JSON.parse(s.body ?? '{}').kind)).toEqual(['permission', 'cleared']);
  expect(JSON.parse(w.signals()[1]?.body ?? '{}')).toEqual({ session: SESSION, kind: 'cleared' });
});

test('cleared is sent once on the next prompt or turn end, too', async ($, on) => {
  const w = world(on);
  await permission($);
  await submit($, 'carry on');
  await finishTurn($);
  await permission($);
  await finishTurn($);
  await submit($, 'and again');
  await w.clock.settle();
  const kinds = w.signals().map((s) => JSON.parse(s.body ?? '{}').kind);
  expect(kinds).toEqual(['permission', 'cleared', 'permission', 'cleared']);
});

test('cleared is never sent without a permission before it', async ($, on) => {
  const w = world(on);
  await readFile($);
  await submit($, 'hello');
  await finishTurn($);
  await w.clock.settle();
  expect(w.signals()).toEqual([]);
});

test('every hook calls next and returns its result unchanged', async ($, on) => {
  const decision = { decision: { behavior: 'deny' as const, message: 'not here' } };
  const toolResult = { result: { lines: 3 }, text: 'exactly this' };
  const w = world(on, guildUp(), {
    beneath: {
      permission: decision,
      tool: toolResult,
      prompt: (text) => ({ text: `${text}!`, context: ['kept'] }),
      turn: { text: 'the end' },
      start: { cwd: '/beneath' },
    },
  });

  expect(await $.session.start(SURFACE)).toEqual({ cwd: '/beneath' });
  expect(await permission($)).toEqual(decision);
  expect(await readFile($)).toMatchObject(toolResult);
  expect(await submit($, 'go')).toMatchObject({ text: 'go!', context: ['kept'] });
  expect(await finishTurn($)).toEqual({ text: 'the end' });
  await w.clock.settle();
});

for (const [down, answer] of [
  ['refuses the connection', () => 'reject' as const],
  ['answers 500', () => ({ status: 500, text: 'boom' })],
  ['never answers', () => 'hang' as const],
] as const) {
  test(`a guild that ${down} changes nothing and throws nothing`, async ($, on) => {
    const w = world(on, answer);
    expect(await $.session.start(SURFACE)).toEqual({ cwd: SURFACE.cwd });
    expect(await permission($)).toEqual({});
    expect(await readFile($)).toMatchObject({ text: 'read 3 lines' });
    expect(await submit($, 'go')).toMatchObject({ text: 'go' });
    expect(await finishTurn($)).toEqual({ text: 'done' });
    // The guild's silence is bounded: past the timeout, the status line is cleared.
    await w.clock.advance(5_000);
    expect(w.statuses.at(-1)).toBeUndefined();
    expect(w.statuses.filter((s) => s !== undefined)).toEqual([]);
    expect(w.toasts).toEqual([]);
    // /guild waits on the guild no longer than the timeout, then says it is down.
    const running = runGuild($);
    await w.clock.advance(5_000);
    const run = await running;
    expect(run.text).toContain('not reachable');
    expect(w.copies).toEqual([]);
  });
}

for (const url of [
  'http://example.com:4747',
  'http://127.0.0.1.evil.example:4747',
  'http://192.168.1.20:4747',
  'http://user:pw@127.0.0.1:4747',
  'ftp://127.0.0.1:4747',
  'not a url',
]) {
  test(
    `a guild URL off loopback is refused and nothing is sent: ${url}`,
    { options: { guild_url: url } },
    async ($, on) => {
      const w = world(on);
      await $.session.start(SURFACE);
      await permission($);
      await readFile($);
      await finishTurn($);
      const run = await runGuild($);
      await w.clock.advance(60_000);
      expect(w.fetches).toEqual([]);
      expect(w.copies).toEqual([]);
      expect(run.text).toContain('only talks to a guild on this machine');
      expect(run.text).not.toContain('pw');
    },
  );
}

for (const url of ['http://localhost:4747', 'http://[::1]:4747/', 'http://127.0.0.1:9000/x']) {
  test(`a loopback guild URL is used: ${url}`, { options: { guild_url: url } }, async ($, on) => {
    const w = world(on);
    await permission($);
    await w.clock.settle();
    expect(w.signals()).toHaveLength(1);
    expect(w.signals()[0]?.url).toBe(`${new URL(url).origin}/api/signal`);
  });
}

test('the token never appears in any text, toast, status, log or command output', async ($, on) => {
  let level = 1;
  const w = world(
    on,
    guildUp(() => ({ ...KNIGHT, name: 'Ser Quill', level })),
  );
  await $.session.start(SURFACE);
  await permission($);
  await readFile($);
  level = 2;
  await finishTurn($);
  const run = await runGuild($);
  await w.clock.advance(60_000);
  const shown = [...w.statuses, ...w.toasts, ...w.logs, run.text ?? '', ...(run.context ?? [])];
  expect(shown.filter((s) => s?.includes(TOKEN))).toEqual([]);
  expect(w.toasts.length).toBeGreaterThan(0);
  // It travels only as the Authorization header (never in a URL or a body), and on /guild,
  // to the clipboard.
  for (const f of w.fetches) {
    expect(f.url).not.toContain(TOKEN);
    expect(f.body ?? '').not.toContain(TOKEN);
    expect(f.headers.authorization === undefined || f.headers.authorization === `Bearer ${TOKEN}`).toBe(true);
  }
  expect(w.copies).toEqual([`http://127.0.0.1:4747/?token=${TOKEN}`]);
});

test('the status line shows rank, level and XP, refreshed every 30 s', async ($, on) => {
  const w = world(on);
  await $.session.start(SURFACE);
  await w.clock.settle();
  expect(w.statuses.at(-1)).toBe('⚔ Knight · Lv 3 · 320 XP');
  expect(w.heroAsks()).toHaveLength(1);
  expect(w.heroAsks()[0]?.url).toBe(`http://127.0.0.1:4747/api/hero/${SESSION}`);
  await w.clock.advance(29_000);
  expect(w.heroAsks()).toHaveLength(1);
  await w.clock.advance(1_000);
  expect(w.heroAsks()).toHaveLength(2);
  await finishTurn($);
  await w.clock.settle();
  expect(w.heroAsks()).toHaveLength(3);
});

test('the status line is cleared when the guild goes away or forgets the hero', async ($, on) => {
  let up = true;
  const w = world(on, (path) => (up ? guildUp()(path) : 'reject'));
  await $.session.start(SURFACE);
  await w.clock.settle();
  expect(w.statuses.at(-1)).toBe('⚔ Knight · Lv 3 · 320 XP');
  up = false;
  await finishTurn($);
  await w.clock.settle();
  expect(w.statuses.at(-1)).toBeUndefined();
});

test('a level-up raises one toast', async ($, on) => {
  let level = 3;
  const w = world(
    on,
    guildUp(() => ({ ...KNIGHT, level })),
  );
  await $.session.start(SURFACE);
  await w.clock.settle();
  expect(w.toasts).toEqual([]);
  level = 4;
  await finishTurn($);
  await w.clock.settle();
  await finishTurn($);
  await w.clock.advance(30_000);
  expect(w.toasts).toEqual(['Ser Quill reached level 4!']);
  expect(w.statuses.at(-1)).toBe('⚔ Knight · Lv 4 · 320 XP');
});

test('/guild with the guild up shows the hero and copies the link', async ($, on) => {
  const w = world(on);
  await $.session.start(SURFACE);
  const run = await runGuild($);
  expect(run.text).toBe(
    'The guild is up at http://127.0.0.1:4747. Ser Quill: ⚔ Knight · Lv 3 · 320 XP. The village link is on your clipboard.',
  );
  expect(w.copies).toEqual([`http://127.0.0.1:4747/?token=${TOKEN}`]);
  expect(run.text).not.toContain(TOKEN);
});

test('/guild with the guild down says so and copies nothing', async ($, on) => {
  const w = world(on, () => 'reject');
  await $.session.start(SURFACE);
  const run = await runGuild($);
  expect(run.text).toBe(
    'The guild is not reachable at http://127.0.0.1:4747. Start it with npm start in agent-guild.',
  );
  expect(w.copies).toEqual([]);
});

test('/guild says when the guild refuses the token, without showing it', async ($, on) => {
  const w = world(on, (path) => (path === '/api/health' ? { status: 200 } : { status: 401 }));
  const run = await runGuild($);
  expect(run.text).toContain('refused the token');
  expect(run.text).not.toContain(TOKEN);
  await w.clock.settle();
});

test('no token, no requests: the Herald stays quiet', async ($, on) => {
  const w = world(on, guildUp(), { token: null });
  await $.session.start(SURFACE);
  await permission($);
  await readFile($);
  await w.clock.advance(60_000);
  expect(w.fetches).toEqual([]);
  expect(w.statuses.filter((s) => s !== undefined)).toEqual([]);
});

// mod-tester, round 1: the edges docs/MOD.md names, beyond the list in G4.

for (const [what, answer] of [
  ['answers garbage JSON', { status: 200, text: '{not json' }],
  ['answers JSON that is not a hero', { status: 200, text: '{"name":"x","level":"9"}' }],
  ['does not know the hero (404)', { status: 404, text: '{"error":"No such hero."}' }],
  ['refuses the token (401)', { status: 401, text: '{"error":"no"}' }],
] as const) {
  test(`a guild that ${what} leaves the status line empty and throws nothing`, async ($, on) => {
    const w = world(on, (path) => (path === '/api/health' ? { status: 200 } : answer));
    expect(await $.session.start(SURFACE)).toEqual({ cwd: SURFACE.cwd });
    await w.clock.settle();
    expect(w.heroAsks()).toHaveLength(1);
    expect(w.statuses.filter((s) => s !== undefined)).toEqual([]);
    expect(w.statuses.at(-1)).toBeUndefined();
    expect(await finishTurn($)).toEqual({ text: 'done' });
    await w.clock.advance(60_000);
    expect(w.statuses.filter((s) => s !== undefined)).toEqual([]);
    expect(w.toasts).toEqual([]);
    const run = await runGuild($);
    expect(run.text).not.toContain(TOKEN);
    expect(run.text).toContain('The guild is up');
  });
}

test('a repeated permission prompt sends one permission each, and one cleared after them', async ($, on) => {
  const w = world(on);
  await permission($);
  await permission($);
  await readFile($);
  await readFile($);
  await submit($, 'next');
  await w.clock.settle();
  const kinds = w.signals().map((s) => JSON.parse(s.body ?? '{}').kind);
  expect(kinds).toEqual(['permission', 'permission', 'cleared']);
});

for (const odd of ['../etc', 'a b', 'q'.repeat(101)]) {
  test(`a permission for an odd session id sends nothing, not even a cleared: ${JSON.stringify(odd).slice(0, 20)}`, async ($, on) => {
    const w = world(on);
    await $.classic.PermissionRequest({ session_id: odd, tool_name: 'Bash', tool_input: { command: 'ls' } });
    await readFile($);
    await finishTurn($);
    await w.clock.settle();
    expect(w.signals()).toEqual([]);
  });
}

test('a session id the engine reports oddly is never put in a URL', async ($, on) => {
  const w = world(on, guildUp(), { session: '../../api/signal' });
  await $.session.start(SURFACE);
  await finishTurn($);
  const run = await runGuild($);
  await w.clock.advance(60_000);
  expect(w.heroAsks()).toEqual([]);
  expect(w.fetches.filter((f) => f.url.includes('..'))).toEqual([]);
  expect(run.text).toContain('no hero');
});

for (const junk of ['', 'short', 'two words-0123456789abcdef', 'tok\n0123456789abcdef', 'x'.repeat(600)]) {
  test(`a token file that is not a token sends nothing: ${JSON.stringify(junk).slice(0, 20)}`, async ($, on) => {
    const w = world(on, guildUp(), { token: junk });
    await $.session.start(SURFACE);
    await permission($);
    await readFile($);
    await w.clock.advance(60_000);
    expect(w.signals()).toEqual([]);
    expect(w.heroAsks()).toEqual([]);
    expect(w.fetches.every((f) => f.headers.authorization === undefined)).toBe(true);
  });
}

test('a fresh load (as after a reload) never toasts the level it first sees', async ($, on) => {
  const w = world(
    on,
    guildUp(() => ({ ...KNIGHT, level: 9 })),
  );
  await $.session.start(SURFACE);
  await w.clock.settle();
  await finishTurn($);
  await w.clock.advance(90_000);
  expect(w.heroAsks().length).toBeGreaterThan(2);
  expect(w.toasts).toEqual([]);
  expect(w.statuses.at(-1)).toBe('⚔ Knight · Lv 9 · 320 XP');
});

test('a level-up toast is not repeated by later refreshes at the same level', async ($, on) => {
  let level = 1;
  const w = world(
    on,
    guildUp(() => ({ ...KNIGHT, level })),
  );
  await $.session.start(SURFACE);
  await w.clock.settle();
  level = 3;
  await w.clock.advance(30_000);
  await finishTurn($);
  await finishTurn($);
  await w.clock.advance(120_000);
  expect(w.toasts).toEqual(['Ser Quill reached level 3!']);
});

test('a hero with an over-long name or rank is cut short, and never carries the token', async ($, on) => {
  const w = world(
    on,
    guildUp(() => ({ ...KNIGHT, name: `N${'a'.repeat(200)}`, rank: `r${'b'.repeat(200)}`, level: 3 })),
  );
  await $.session.start(SURFACE);
  await w.clock.settle();
  const line = w.statuses.at(-1) ?? '';
  expect(line.length).toBeLessThan(60);
  expect(line).toMatch(/^⚔ Rb+ · Lv 3 · 320 XP$/);
});

test('a guild that hangs on /guild after health still answers within the timeout', async ($, on) => {
  const w = world(on, (path) => (path === '/api/health' ? { status: 200 } : 'hang'));
  const running = runGuild($);
  await w.clock.advance(10_000);
  const run = await running;
  expect(run.text).toContain('The guild is up');
  expect(run.text).toContain('no hero');
  expect(run.text).not.toContain(TOKEN);
});

// Round 2 (mod-tester): the fixes mod-dev made, held by tests.

test('cleared goes to the session the permission was sent for, not to $.session.id', async ($, on) => {
  const w = world(on, guildUp(), { session: 'sess-other' });
  await $.classic.PermissionRequest({ session_id: 'sess-perm', tool_name: 'Read', tool_input: {} });
  await readFile($);
  await w.clock.settle();
  expect(w.signals().map((s) => JSON.parse(s.body ?? '{}'))).toEqual([
    { session: 'sess-perm', kind: 'permission' },
    { session: 'sess-perm', kind: 'cleared' },
  ]);
});

test('an odd permission after a good one does not drop the pending cleared', async ($, on) => {
  const w = world(on);
  await permission($);
  await $.classic.PermissionRequest({ session_id: '../x', tool_name: 'Bash', tool_input: {} });
  await finishTurn($);
  await w.clock.settle();
  expect(w.signals().map((s) => JSON.parse(s.body ?? '{}'))).toEqual([
    { session: SESSION, kind: 'permission' },
    { session: SESSION, kind: 'cleared' },
  ]);
});

test(
  'a guild URL over https is refused and nothing is sent',
  { options: { guild_url: 'https://127.0.0.1:4747' } },
  async ($, on) => {
    const w = world(on);
    await $.session.start(SURFACE);
    await permission($);
    await finishTurn($);
    const run = await runGuild($);
    await w.clock.advance(60_000);
    expect(w.fetches).toEqual([]);
    expect(run.text).toContain('only talks to a guild on this machine');
  },
);

test('a tool call that fails beneath the mod runs once, and its failure is not swallowed', async ($, on) => {
  let runs = 0;
  const beneath: Beneath = {
    get tool(): object {
      runs += 1;
      throw new Error('tool failed');
    },
  };
  const w = world(on, guildUp(), { beneath });
  await permission($);
  let threw = false;
  try {
    await readFile($);
  } catch {
    threw = true;
  }
  await w.clock.settle();
  expect(runs).toBe(1);
  expect(threw).toBe(true);
  // The prompt was answered even though the call failed: the wait ends with it, once.
  expect(w.signals().map((s) => JSON.parse(s.body ?? '{}').kind)).toEqual(['permission', 'cleared']);
  await finishTurn($);
  await w.clock.settle();
  expect(w.signals().map((s) => JSON.parse(s.body ?? '{}').kind)).toEqual(['permission', 'cleared']);
});

test('a call of another tool coming back does not end the wait; the held tool or the turn does', async ($, on) => {
  const w = world(on);
  await $.classic.PermissionRequest({
    session_id: SESSION,
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  });
  await readFile($);
  await w.clock.settle();
  expect(w.signals().map((s) => JSON.parse(s.body ?? '{}').kind)).toEqual(['permission']);
  await $.tool.call({ tool: 'Bash', command: 'ls' });
  await w.clock.settle();
  expect(w.signals().map((s) => JSON.parse(s.body ?? '{}').kind)).toEqual(['permission', 'cleared']);

  await $.classic.PermissionRequest({
    session_id: SESSION,
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  });
  await readFile($);
  await finishTurn($);
  await w.clock.settle();
  expect(w.signals().map((s) => JSON.parse(s.body ?? '{}').kind)).toEqual([
    'permission',
    'cleared',
    'permission',
    'cleared',
  ]);
});

test('a permission with no tool name is ended by the next tool call of any tool (round 3 probe)', async ($, on) => {
  const w = world(on);
  await $.classic.PermissionRequest({ session_id: SESSION, tool_name: '', tool_input: {} });
  await readFile($);
  await readFile($);
  await w.clock.settle();
  expect(w.signals().map((s) => JSON.parse(s.body ?? '{}').kind)).toEqual(['permission', 'cleared']);
});

test('a prompt submitted while another tool’s wait is held ends it, once (round 3 probe)', async ($, on) => {
  const w = world(on);
  await $.classic.PermissionRequest({
    session_id: SESSION,
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  });
  await readFile($);
  const out = await submit($, 'go on');
  await $.tool.call({ tool: 'Bash', command: 'ls' });
  await finishTurn($);
  await w.clock.settle();
  expect(out).toEqual({ text: 'go on' });
  expect(w.signals().map((s) => JSON.parse(s.body ?? '{}').kind)).toEqual(['permission', 'cleared']);
});
