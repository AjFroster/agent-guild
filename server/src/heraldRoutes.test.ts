import { XP_PER_TURN, replay } from '@agent-guild/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createServer } from './server.ts';

const TOKEN = 'test-token-0123456789abcdef';
const HOST = '127.0.0.1:4747';
const auth = { host: HOST, authorization: `Bearer ${TOKEN}` };
const servers: { close: () => Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/** A guild that knows one Knight, "Ser Quill", who has finished one turn. */
function make() {
  const server = createServer({ host: '127.0.0.1', token: TOKEN });
  servers.push(server.app);
  server.publish([
    { t: 1, session: 'quill', type: 'session_start', name: 'Ser Quill' },
    { t: 2, session: 'quill', type: 'tool', tool: 'Read' },
    { t: 3, session: 'quill', type: 'stop' },
  ]);
  const status = () => replay(server.events()).heroes.quill?.status;
  return { ...server, status };
}

const signal = (app: ReturnType<typeof make>['app'], body: unknown, headers: Record<string, string> = auth) =>
  app.inject({ method: 'POST', url: '/api/signal', headers, payload: body as object });

describe('POST /api/signal', () => {
  it('marks a known hero as waiting on a permission, then back at work when cleared', async () => {
    const guild = make();
    const sent = await signal(guild.app, { session: 'quill', kind: 'permission' });
    expect(sent.statusCode).toBe(204);
    expect(guild.events().at(-1)).toMatchObject({ session: 'quill', type: 'needs_input' });
    expect(guild.status()).toBe('needs_you');

    const cleared = await signal(guild.app, { session: 'quill', kind: 'cleared' });
    expect(cleared.statusCode).toBe(204);
    expect(guild.events().at(-1)).toMatchObject({ session: 'quill', type: 'cleared' });
    expect(guild.status()).toBe('working');
  });

  it('publishes nothing but the session and the event type', async () => {
    const guild = make();
    await signal(guild.app, { session: 'quill', kind: 'permission' });
    expect(Object.keys(guild.events().at(-1)!).sort()).toEqual(['session', 't', 'type']);
  });

  it('ignores a session the guild does not know, and never makes a hero of it', async () => {
    const guild = make();
    const before = guild.events().length;
    const res = await signal(guild.app, { session: 'stranger', kind: 'permission' });
    expect(res.statusCode).toBe(204);
    expect(guild.events()).toHaveLength(before);
    expect(replay(guild.events()).heroes.stranger).toBeUndefined();
  });

  it('ignores a hero that has left', async () => {
    const guild = make();
    guild.publish([{ t: 4, session: 'quill', type: 'session_end' }]);
    const before = guild.events().length;
    expect((await signal(guild.app, { session: 'quill', kind: 'permission' })).statusCode).toBe(204);
    expect(guild.events()).toHaveLength(before);
  });

  it('refuses a bad kind, a bad id, extra fields or no body with a 400', async () => {
    const guild = make();
    const before = guild.events().length;
    const bodies = [
      { session: 'quill', kind: 'allow' },
      { session: 'quill', kind: 'PERMISSION' },
      { session: '../quill', kind: 'permission' },
      { session: 'quill quill', kind: 'permission' },
      { session: '', kind: 'permission' },
      { session: 'q'.repeat(101), kind: 'permission' },
      { session: 7, kind: 'permission' },
      { session: 'quill', kind: 'permission', tool: 'Bash' },
      { session: 'quill', kind: 'permission', prompt: 'rm -rf /' },
      { session: 'quill' },
      [],
    ];
    for (const body of bodies) {
      const res = await signal(guild.app, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    const empty = await guild.app.inject({ method: 'POST', url: '/api/signal', headers: auth });
    expect(empty.statusCode).toBe(400);
    expect(guild.events()).toHaveLength(before);
  });

  it('refuses a body over 1 KB', async () => {
    const guild = make();
    const res = await guild.app.inject({
      method: 'POST',
      url: '/api/signal',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: JSON.stringify({ session: 'quill', kind: 'permission', pad: 'x'.repeat(2000) }),
    });
    expect(res.statusCode).toBe(413);
  });

  it('needs the token, checked before the body is read', async () => {
    const guild = make();
    const before = guild.events().length;
    const none = await signal(guild.app, { session: 'quill', kind: 'permission' }, { host: HOST });
    const wrong = await signal(
      guild.app,
      { session: 'quill', kind: 'permission' },
      { host: HOST, authorization: `Bearer ${'x'.repeat(TOKEN.length)}` },
    );
    const notJson = await guild.app.inject({
      method: 'POST',
      url: '/api/signal',
      headers: { host: HOST, 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect([none.statusCode, wrong.statusCode, notJson.statusCode]).toEqual([401, 401, 401]);
    expect(guild.events()).toHaveLength(before);
  });

  it('works in watch-only mode, with no control routes', async () => {
    // createServer without `control` is exactly what AGENT_GUILD_NO_CONTROL=1 runs.
    const guild = make();
    expect((await signal(guild.app, { session: 'quill', kind: 'permission' })).statusCode).toBe(204);
    expect(guild.status()).toBe('needs_you');
  });

  it('is refused from a foreign Host, like every route', async () => {
    const guild = make();
    const res = await signal(
      guild.app,
      { session: 'quill', kind: 'permission' },
      { ...auth, host: 'evil.example:4747' },
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/hero/:session', () => {
  it("answers the hero's name, rank, level, XP and status, and nothing else", async () => {
    const guild = make();
    const res = await guild.app.inject({ url: '/api/hero/quill', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: 'Ser Quill',
      rank: 'knight',
      level: 1,
      xp: XP_PER_TURN,
      status: 'idle',
    });
  });

  it('answers 404 for a session the guild does not know, or one that has left', async () => {
    const guild = make();
    expect((await guild.app.inject({ url: '/api/hero/stranger', headers: auth })).statusCode).toBe(404);
    guild.publish([{ t: 4, session: 'quill', type: 'session_end' }]);
    expect((await guild.app.inject({ url: '/api/hero/quill', headers: auth })).statusCode).toBe(404);
  });

  it('answers 400 for an id that is not one', async () => {
    const guild = make();
    for (const id of ['a%20b', 'q'.repeat(101), 'a.b', '%2E%2Ex', 'a%2Fb']) {
      const res = await guild.app.inject({ url: `/api/hero/${id}`, headers: auth });
      expect(res.statusCode, id).toBe(400);
    }
  });

  it('needs the token', async () => {
    const guild = make();
    const none = await guild.app.inject({ url: '/api/hero/quill', headers: { host: HOST } });
    const wrong = await guild.app.inject({
      url: '/api/hero/quill',
      headers: { host: HOST, authorization: 'Bearer nope' },
    });
    expect([none.statusCode, wrong.statusCode]).toEqual([401, 401]);
  });
});

// mod-tester, round 1: the edges docs/MOD.md names, beyond the G1/G2 lists.
describe('Herald routes, at the edges', () => {
  it('takes a repeated permission signal and one cleared ends the wait', async () => {
    const guild = make();
    for (let i = 0; i < 3; i++) {
      expect((await signal(guild.app, { session: 'quill', kind: 'permission' })).statusCode).toBe(204);
    }
    expect(guild.status()).toBe('needs_you');
    expect((await signal(guild.app, { session: 'quill', kind: 'cleared' })).statusCode).toBe(204);
    expect(guild.status()).toBe('working');
  });

  it('leaves the hero as it was on a cleared without a permission, and on a repeated cleared', async () => {
    const guild = make();
    expect((await signal(guild.app, { session: 'quill', kind: 'cleared' })).statusCode).toBe(204);
    expect(guild.status()).toBe('idle');
    await signal(guild.app, { session: 'quill', kind: 'permission' });
    await signal(guild.app, { session: 'quill', kind: 'cleared' });
    await signal(guild.app, { session: 'quill', kind: 'cleared' });
    expect(guild.status()).toBe('working');
  });

  it('refuses odd ids on the signal with a 400', async () => {
    const guild = make();
    for (const session of [
      'séance',
      'quill\n',
      'quill\u0000',
      'a/b',
      'a.b',
      ' quill',
      '<script>',
      null,
      {},
    ]) {
      const res = await signal(guild.app, { session, kind: 'permission' });
      expect(res.statusCode, JSON.stringify(session)).toBe(400);
    }
  });

  it('takes a 100-character id and refuses a 101-character one', async () => {
    const guild = make();
    const at = await signal(guild.app, { session: 'q'.repeat(100), kind: 'permission' });
    const over = await signal(guild.app, { session: 'q'.repeat(101), kind: 'permission' });
    expect([at.statusCode, over.statusCode]).toEqual([204, 400]);
    const hero = await guild.app.inject({ url: `/api/hero/${'q'.repeat(100)}`, headers: auth });
    expect(hero.statusCode).toBe(404);
    const long = await guild.app.inject({ url: `/api/hero/${'q'.repeat(5000)}`, headers: auth });
    expect(long.statusCode).toBeGreaterThanOrEqual(400);
    expect(long.statusCode).toBeLessThan(500);
  });

  it('does not take a body that is not JSON', async () => {
    const guild = make();
    for (const [type, payload] of [
      ['text/plain', '{"session":"quill","kind":"permission"}'],
      ['application/json', '{nope'],
      ['application/json', 'null'],
      ['application/json', '"permission"'],
    ] as const) {
      const res = await guild.app.inject({
        method: 'POST',
        url: '/api/signal',
        headers: { ...auth, 'content-type': type },
        payload,
      });
      expect(res.statusCode, `${type} ${payload}`).toBeGreaterThanOrEqual(400);
      expect(res.statusCode, `${type} ${payload}`).toBeLessThan(500);
    }
    expect(guild.status()).toBe('idle');
  });

  it('checks the token before the id: no token and a bad id is still a 401', async () => {
    const guild = make();
    const res = await guild.app.inject({ url: '/api/hero/a%20b', headers: { host: HOST } });
    expect(res.statusCode).toBe(401);
    const sig = await signal(guild.app, { session: '../x', kind: 'nope' }, { host: HOST });
    expect(sig.statusCode).toBe(401);
  });

  it('refuses a token that is only a prefix, a suffix, or sent in the query', async () => {
    const guild = make();
    for (const headers of [
      { host: HOST, authorization: `Bearer ${TOKEN.slice(0, -1)}` },
      { host: HOST, authorization: `Bearer ${TOKEN}x` },
      { host: HOST, authorization: TOKEN },
      { host: HOST, authorization: `Basic ${TOKEN}` },
    ]) {
      const res = await signal(guild.app, { session: 'quill', kind: 'permission' }, headers);
      expect(res.statusCode, headers.authorization).toBe(401);
    }
    const query = await guild.app.inject({ url: `/api/hero/quill?token=${TOKEN}`, headers: { host: HOST } });
    expect(query.statusCode).toBe(401);
    expect(guild.status()).toBe('idle');
  });

  it('answers the hero route with the status the signals set', async () => {
    const guild = make();
    await signal(guild.app, { session: 'quill', kind: 'permission' });
    const res = await guild.app.inject({ url: '/api/hero/quill', headers: auth });
    expect(res.json()).toMatchObject({ status: 'needs_you' });
    expect(Object.keys(res.json()).sort()).toEqual(['level', 'name', 'rank', 'status', 'xp']);
  });
});

describe('Herald routes, inherited names', () => {
  const names = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];

  it('treats an id like constructor or __proto__ as unknown on the signal: 204, nothing published', async () => {
    const guild = make();
    const before = guild.events().length;
    for (const session of names) {
      for (const kind of ['permission', 'cleared']) {
        const res = await signal(guild.app, { session, kind });
        expect(res.statusCode, `${session} ${kind}`).toBe(204);
      }
    }
    expect(guild.events()).toHaveLength(before);
    expect(Object.keys(replay(guild.events()).heroes)).toEqual(['quill']);
  });

  it('answers 404 for an id like constructor or __proto__ on the hero route', async () => {
    const guild = make();
    for (const session of names) {
      const res = await guild.app.inject({ method: 'GET', url: `/api/hero/${session}`, headers: auth });
      expect(res.statusCode, session).toBe(404);
    }
  });

  it('sees a new hero right after the cached state is dropped by a publish', async () => {
    const guild = make();
    expect((await guild.app.inject({ method: 'GET', url: '/api/hero/wren', headers: auth })).statusCode).toBe(
      404,
    );
    guild.publish([{ t: 5, session: 'wren', type: 'session_start', name: 'Wren' }]);
    expect((await guild.app.inject({ method: 'GET', url: '/api/hero/wren', headers: auth })).statusCode).toBe(
      200,
    );
  });

  it('answers what a full replay would, whether publishes come in time order or not', async () => {
    const guild = make();
    const hero = async () =>
      (await guild.app.inject({ method: 'GET', url: '/api/hero/quill', headers: auth })).json();
    const expected = () => {
      const h = replay(guild.events()).heroes.quill!;
      return { level: h.level, xp: h.xp, status: h.status };
    };
    await hero();
    guild.publish([{ t: 4, session: 'quill', type: 'stop' }]);
    expect(await hero()).toMatchObject(expected());
    // An older event, folded out of order, must not be applied on top: the state is rebuilt.
    guild.publish([{ t: 3.5, session: 'quill', type: 'needs_input' }]);
    expect(await hero()).toMatchObject(expected());
  });
});

describe('createServer', () => {
  it('starts without a deprecation warning (FSTDEP022: maxParamLength belongs in routerOptions)', async () => {
    const warnings: string[] = [];
    const listen = (w: Error & { code?: string }) => warnings.push(`${w.code ?? ''} ${w.message}`);
    process.on('warning', listen);
    try {
      const server = createServer({ host: '127.0.0.1', token: TOKEN });
      servers.push(server.app);
      await server.app.ready();
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('warning', listen);
    }
    expect(warnings.filter((w) => w.includes('FSTDEP'))).toEqual([]);
  });
});

describe('URLs the router cannot take', () => {
  it('answers 400 for a hero id past the router limit, never 414 and never echoing it', async () => {
    const guild = make();
    const long = 'a'.repeat(2000);
    const res = await guild.app.inject({ method: 'GET', url: `/api/hero/${long}`, headers: auth });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain(long.slice(0, 200));
  });
});

describe('round 3 probes', () => {
  it('answers 400 for a hero URL with broken percent-encoding, without echoing it', async () => {
    const guild = make();
    const res = await guild.app.inject({ method: 'GET', url: '/api/hero/%E0%A4%Aqq-marker', headers: auth });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('marker');
  });

  it('answers the same rank whether the cached state survives or is rebuilt after compaction', async () => {
    const server = createServer({ host: '127.0.0.1', token: TOKEN, maxEvents: 10 });
    servers.push(server.app);
    const rank = async () =>
      (await server.app.inject({ method: 'GET', url: '/api/hero/squire', headers: auth })).json().rank;
    server.publish([
      { t: 1, session: 'lord', type: 'session_start', name: 'Lord' },
      { t: 2, session: 'squire', type: 'subagent_start', name: 'Squire', parent: 'lord' },
      { t: 3, session: 'squire', type: 'tool', tool: 'Edit' },
    ]);
    await rank(); // builds the cache
    for (let t = 4; t < 30; t++) server.publish([{ t, session: 'squire', type: 'tool', tool: 'Read' }]);
    const cached = await rank();
    // An out-of-order publish drops the cache; the rebuild replays the compacted history.
    server.publish([{ t: 0.5, session: 'nobody', type: 'stop' }]);
    expect(await rank()).toBe(cached);
  });
});
