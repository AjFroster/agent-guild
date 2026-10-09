import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';

import fastifyStatic from '@fastify/static';
import { type GuildEvent, type GuildState, applyEvent, replay } from '@agent-guild/core';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';

import { registerHeraldRoutes } from './heraldRoutes.ts';

/**
 * The local guild server. It exists on your machine only and says so in code:
 *
 * - It refuses to bind anything but a loopback address.
 * - The event stream needs a token, printed once in the URL at startup.
 * - Requests whose Host or Origin is not loopback are rejected, which stops a web page
 *   you visit from reaching it through DNS rebinding or a cross-site fetch.
 *
 * The stream carries only guild events (tool names, todo titles, turn ends), never
 * prompts or file contents; see core/src/transcript.ts for where those are dropped.
 */

export interface ServerOptions {
  host: string;
  token: string;
  /** Built web app to serve at `/`. Skipped when the directory does not exist. */
  webDir?: string;
  /** Upper bound on events kept for the snapshot a new browser tab receives. */
  maxEvents?: number;
  /**
   * Routes that act on sessions (chats, the Town Crier). They get the token check to
   * enforce themselves. Omitted, the server is watch-only.
   */
  control?: (scope: FastifyInstance, isToken: (given: unknown) => boolean) => Promise<void>;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/** Hostname part of a Host header, lowercased; null if unparseable. */
function hostnameOf(value: string): string | null {
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** "host:port" of an Origin, as a Host header would carry it; null if unparseable. */
function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface GuildServer {
  app: FastifyInstance;
  publish: (events: GuildEvent[]) => void;
  /** Send a named message to every open tab, and to tabs that open later. */
  announce: (event: string, data: unknown) => void;
  /** Every event kept so far, for replaying the guild's state on the server. */
  events: () => readonly GuildEvent[];
}

export function createServer(opts: ServerOptions): GuildServer {
  if (!isLoopback(opts.host)) {
    throw new Error(`Refusing to listen on ${opts.host}: agent-guild only binds 127.0.0.1 or ::1.`);
  }
  if (opts.token.length < 16) throw new Error('The token must be at least 16 characters.');

  const maxEvents = opts.maxEvents ?? 20_000;
  const history: GuildEvent[] = [];
  /**
   * The history folded once, for the Herald's routes. A publish in time order folds its
   * events in (what replay would give); one out of order drops it for a full replay.
   */
  let state: GuildState | null = null;
  let lastT = -Infinity;
  const clients = new Set<FastifyReply>();
  /** Latest value of each announced message, replayed to a tab when it connects. */
  const announced = new Map<string, unknown>();
  // Long enough that an over-long id reaches its route's own check (a 400), not Fastify's 414.
  const app = Fastify({
    logger: false,
    routerOptions: { maxParamLength: 1000 },
    // A URL the router cannot take (bad encoding, a param past maxParamLength) is a plain
    // 400 that never echoes the URL back.
    frameworkErrors: (_error, _req, reply) =>
      void (reply as FastifyReply).code(400).send({ error: 'Bad request.' }),
  });

  app.addHook('onRequest', async (req, reply) => {
    const host = hostnameOf(req.headers.host ?? '');
    if (!host || !LOOPBACK_NAMES.has(host)) {
      return reply.code(403).send({ error: 'Host must be 127.0.0.1 or localhost.' });
    }
    // The Origin must be this server itself, port included: another app on localhost is
    // a different origin and has no business here.
    const origin = req.headers.origin;
    if (origin !== undefined && hostOf(origin) !== (req.headers.host ?? '').toLowerCase()) {
      return reply.code(403).send({ error: 'Cross-origin requests are not allowed.' });
    }
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/events', (req, reply) => {
    const { token } = req.query as { token?: unknown };
    if (!sameToken(token, opts.token)) {
      void reply.code(401).send({ error: 'Missing or wrong token. Use the URL printed at startup.' });
      return;
    }
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(`event: snapshot\ndata: ${JSON.stringify(history)}\n\n`);
    for (const [event, data] of announced) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    clients.add(reply);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      clients.delete(reply);
    });
  });

  // The Herald (mod/) reports permission waits and asks for its hero, in watch-only mode too.
  void app.register(async (scope) =>
    registerHeraldRoutes(scope, {
      isToken: (given) => sameToken(given, opts.token),
      publish: (events) => publish(events),
      state: () => {
        if (!state) {
          state = replay(history);
          lastT = history.reduce((max, e) => Math.max(max, e.t), -Infinity);
        }
        return state;
      },
    }),
  );

  if (opts.control) {
    const control = opts.control;
    void app.register(async (scope) => control(scope, (given) => sameToken(given, opts.token)));
  }

  if (opts.webDir && existsSync(opts.webDir)) {
    void app.register(fastifyStatic, { root: opts.webDir });
  }

  const publish = (events: GuildEvent[]) => {
    if (events.length === 0) return;
    if (state) {
      if (events.every((e, i) => e.t >= (i === 0 ? lastT : events[i - 1]!.t))) {
        state = events.reduce(applyEvent, state);
        lastT = events[events.length - 1]!.t;
      } else {
        state = null;
      }
    }
    history.push(...events);
    if (history.length > maxEvents) {
      compact(history, maxEvents);
      // Fold the compacted history afresh, as a tab that connects now would.
      state = null;
    }
    const frame = `event: events\ndata: ${JSON.stringify(events)}\n\n`;
    for (const client of clients) client.raw.write(frame);
  };

  const announce = (event: string, data: unknown) => {
    announced.set(event, data);
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) client.raw.write(frame);
  };

  return { app, publish, announce, events: () => history };
}

/**
 * Keep the snapshot bounded without changing what it replays to. Only `tool` events are
 * dropped, oldest first: a hero's location depends on its latest tool alone, while every
 * other event type carries XP, quests or presence that must survive.
 */
export function compact(history: GuildEvent[], max: number): void {
  let excess = history.length - max;
  const latestTool = new Map<string, number>();
  history.forEach((e, i) => {
    if (e.type === 'tool') latestTool.set(e.session, i);
  });
  for (let i = 0; i < history.length && excess > 0;) {
    const e = history[i]!;
    if (e.type === 'tool' && latestTool.get(e.session) !== i) {
      history.splice(i, 1);
      excess -= 1;
      for (const [s, idx] of latestTool) if (idx > i) latestTool.set(s, idx - 1);
    } else {
      i += 1;
    }
  }
}
