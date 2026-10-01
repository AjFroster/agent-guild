import { get } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { GuildEvent } from '@agent-guild/core';
import { afterEach, describe, expect, it } from 'vitest';

import { compact, createServer } from './server.ts';

const TOKEN = 'test-token-0123456789abcdef';
const servers: { close: () => Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function make() {
  const server = createServer({ host: '127.0.0.1', token: TOKEN });
  servers.push(server.app);
  return server;
}

describe('binding', () => {
  it('refuses to listen on anything but loopback', () => {
    expect(() => createServer({ host: '0.0.0.0', token: TOKEN })).toThrow(/Refusing to listen/);
    expect(() => createServer({ host: '192.168.1.20', token: TOKEN })).toThrow(/Refusing to listen/);
  });

  it('refuses a short token', () => {
    expect(() => createServer({ host: '127.0.0.1', token: 'short' })).toThrow(/at least 16/);
  });
});

describe('requests', () => {
  it('answers health checks from localhost', async () => {
    const { app } = make();
    const res = await app.inject({ url: '/api/health', headers: { host: '127.0.0.1:4747' } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a foreign Host header, which is what DNS rebinding sends', async () => {
    const { app } = make();
    const res = await app.inject({ url: '/api/health', headers: { host: 'evil.example:4747' } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a request from another origin', async () => {
    const { app } = make();
    const res = await app.inject({
      url: '/api/health',
      headers: { host: '127.0.0.1:4747', origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects another app on localhost, which is a different origin', async () => {
    const { app } = make();
    const other = await app.inject({
      url: '/api/health',
      headers: { host: '127.0.0.1:4747', origin: 'http://localhost:3000' },
    });
    const same = await app.inject({
      url: '/api/health',
      headers: { host: '127.0.0.1:4747', origin: 'http://127.0.0.1:4747' },
    });
    expect(other.statusCode).toBe(403);
    expect(same.statusCode).toBe(200);
  });

  it('rejects the event stream without the token, or with a wrong one', async () => {
    const { app } = make();
    const none = await app.inject({ url: '/api/events', headers: { host: 'localhost:4747' } });
    const wrong = await app.inject({
      url: `/api/events?token=${'x'.repeat(TOKEN.length)}`,
      headers: { host: 'localhost:4747' },
    });
    expect(none.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
  });
});

describe('event stream', () => {
  it('sends a snapshot, then new events as they are published', async () => {
    const { app, publish } = make();
    publish([{ t: 1, session: 'a', type: 'session_start', name: 'guild' }]);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;

    const received = await new Promise<string>((resolve, reject) => {
      const req = get(`http://127.0.0.1:${port}/api/events?token=${TOKEN}`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.includes('event: snapshot') && !body.includes('event: events')) {
            publish([{ t: 2, session: 'a', type: 'tool', tool: 'Edit' }]);
          }
          if (body.includes('event: events')) {
            req.destroy();
            resolve(body);
          }
        });
      });
      req.on('error', reject);
    });

    expect(received).toContain('"name":"guild"');
    expect(received).toContain('"tool":"Edit"');
  });
});

describe('compact', () => {
  it('drops old tool events but keeps each session’s latest and every other event', () => {
    const history: GuildEvent[] = [
      { t: 0, session: 'a', type: 'session_start', name: 'a' },
      { t: 1, session: 'a', type: 'tool', tool: 'Read' },
      { t: 2, session: 'a', type: 'tool', tool: 'Bash' },
      { t: 3, session: 'a', type: 'stop' },
      { t: 4, session: 'a', type: 'tool', tool: 'Edit' },
    ];
    compact(history, 3);
    expect(history.map((e) => (e.type === 'tool' ? e.tool : e.type))).toEqual([
      'session_start',
      'stop',
      'Edit',
    ]);
  });
});
