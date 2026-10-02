import { readFile } from 'node:fs/promises';

import { itemsFromTranscript } from '@agent-guild/core';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { type ChatManager, type ChatMode, ChatError, type SessionExtras } from './chats.ts';
import { type TownCrier, nextRun } from './crier.ts';
import { tokenCheck } from './routes.ts';

/**
 * Routes that read conversations and act on sessions. On top of the loopback Host and
 * Origin checks in server.ts, every request must carry the token: as
 * `Authorization: Bearer` for HTTP calls, and in the query for the event stream, where
 * EventSource cannot set headers. Bodies are JSON, so a cross-site form cannot post here
 * without a CORS preflight, which the Origin check refuses.
 */

export interface ChatRouteOptions {
  isToken: (given: unknown) => boolean;
  chats: ChatManager;
  crier: TownCrier;
  /** Where a session runs and where its transcript is, from the watcher. */
  sessionOf: (id: string) => { cwd: string | null; file: string; name: string | null } | null;
  projects: () => string[];
  /** Options a special session (the King) keeps when it is opened again. */
  extrasFor?: (id: string) => SessionExtras | undefined;
  /** What every Knight the guild starts gets: the Forge's tools. */
  knightExtras?: () => Pick<SessionExtras, 'mcpConfig' | 'allowedTools'>;
}

export type SessionOf = ChatRouteOptions['sessionOf'];

/**
 * Make a session known to the chat manager, loading its history from its transcript.
 * Shared with the King's routes, which open Knights the same way.
 */
export function sessionOpener(
  chats: ChatManager,
  sessionOf: SessionOf,
  extrasFor: (id: string) => SessionExtras | undefined = () => undefined,
) {
  return async (id: string) => {
    const known = chats.get(id);
    if (known) return known;
    if (!UUID.test(id)) throw new ChatError(400, 'Not a session id.');
    const session = sessionOf(id);
    if (!session?.cwd)
      throw new ChatError(404, 'The guild does not know this session or the folder it ran in.');
    const lines = (await readFile(session.file, 'utf8'))
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as unknown;
        } catch {
          return null;
        }
      });
    await chats.adopt(id, session.cwd, session.name ?? 'Session', itemsFromTranscript(lines), extrasFor(id));
    return chats.get(id)!;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 100_000;

export async function registerChatRoutes(app: FastifyInstance, opts: ChatRouteOptions): Promise<void> {
  const { chats, crier } = opts;

  const authorized = tokenCheck(opts.isToken);

  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof ChatError) return reply.code(err.status).send({ error: err.message });
    throw err;
  };

  const open = sessionOpener(chats, opts.sessionOf, opts.extrasFor);

  const crierStatus = async () => ({
    config: crier.config,
    nextRunAt: nextRun(crier.config, new Date())?.getTime() ?? null,
    reports: await crier.reports(),
  });

  app.get('/api/control', async (req, reply) => {
    if (!authorized(req, reply)) return reply;
    return { chats: chats.list(), projects: opts.projects().slice(0, 30), crier: await crierStatus() };
  });

  app.post('/api/chats', async (req, reply) => {
    if (!authorized(req, reply)) return reply;
    const body = (req.body ?? {}) as { cwd?: string; name?: string; mode?: ChatMode; message?: string };
    if (typeof body.message === 'string' && body.message.length > MAX_TEXT) {
      return reply.code(413).send({ error: 'That message is too long.' });
    }
    try {
      const info = await chats.start({
        ...opts.knightExtras?.(),
        cwd: String(body.cwd ?? ''),
        message: String(body.message ?? ''),
        ...(body.name !== undefined ? { name: String(body.name) } : {}),
        ...(body.mode !== undefined ? { mode: body.mode } : {}),
      });
      return reply.code(201).send(info);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/chats/:id/messages', async (req, reply) => {
    if (!authorized(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { text?: string; mode?: ChatMode };
    if (typeof body.text !== 'string' || body.text.length > MAX_TEXT) {
      return reply.code(400).send({ error: 'Send a message of up to 100,000 characters.' });
    }
    try {
      await open(id);
      chats.send(id, body.text, body.mode);
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/chats/:id/stop', async (req, reply) => {
    if (!authorized(req, reply)) return reply;
    const { id } = req.params as { id: string };
    return chats.stop(id)
      ? { ok: true }
      : reply.code(404).send({ error: 'Nothing is running in that chat.' });
  });

  // Live view of one chat: its history, then each new or changed item.
  app.get('/api/chats/:id/stream', async (req, reply) => {
    const { token } = req.query as { token?: unknown };
    if (!opts.isToken(token)) return reply.code(401).send({ error: 'Missing or wrong token.' });
    const { id } = req.params as { id: string };
    let chat;
    try {
      chat = await open(id);
    } catch (err) {
      return fail(reply, err);
    }
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(`event: snapshot\ndata: ${JSON.stringify(chat)}\n\n`);
    const unsubscribe = chats.subscribe(id, (change) => {
      const data =
        change.type === 'item' ? change.item : change.type === 'info' ? change.info : { id: change.id };
      res.write(`event: ${change.type}\ndata: ${JSON.stringify(data)}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe?.();
    });
  });

  app.get('/api/crier', async (req, reply) => {
    if (!authorized(req, reply)) return reply;
    return crierStatus();
  });

  app.put('/api/crier', async (req, reply) => {
    if (!authorized(req, reply)) return reply;
    try {
      await crier.update((req.body ?? {}) as Record<string, never>);
      return crierStatus();
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/crier/run', async (req, reply) => {
    if (!authorized(req, reply)) return reply;
    try {
      return reply.code(201).send(await crier.run());
    } catch (err) {
      if (err instanceof ChatError) return fail(reply, err);
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.get('/api/crier/reports/:date', async (req, reply) => {
    if (!authorized(req, reply)) return reply;
    const { date } = req.params as { date: string };
    const text = await crier.report(date);
    return text === null ? reply.code(404).send({ error: 'No report for that day.' }) : { date, text };
  });
}
