import { type GuildEvent, type GuildState, SessionId, Signal, rankOf } from '@agent-guild/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { tokenCheck } from './routes.ts';

/**
 * The Herald's routes: what the guild's Claude Code mod (mod/) calls from inside a session.
 * Both sit behind the token and work in watch-only mode too, since they only change what
 * the village shows. A signal carries a session id and a kind, nothing else, and never
 * creates a hero: one for a session the guild does not know is dropped with a 204.
 */
export interface HeraldRouteOptions {
  isToken: (given: unknown) => boolean;
  publish: (events: GuildEvent[]) => void;
  state: () => GuildState;
  /** Epoch seconds; tests pin it. */
  now?: () => number;
}

/** Signals are tiny; anything bigger is not one. */
const BODY_LIMIT = 1024;

const bad = (message: string) => ({ error: message });

export async function registerHeraldRoutes(app: FastifyInstance, opts: HeraldRouteOptions): Promise<void> {
  // The token is checked as the request arrives, before its body is read: a caller
  // without it learns nothing, not even whether its JSON parsed.
  const authorized = tokenCheck(opts.isToken);
  const onRequest = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authorized(req, reply)) return reply;
  };
  const now = opts.now ?? (() => Date.now() / 1000);
  const known = (id: string) => {
    // Own keys only: `constructor` or `__proto__` are valid ids but never heroes.
    const heroes = opts.state().heroes;
    const hero = Object.hasOwn(heroes, id) ? heroes[id] : undefined;
    return hero && hero.status !== 'gone' ? hero : undefined;
  };

  app.post('/api/signal', { bodyLimit: BODY_LIMIT, onRequest }, async (req, reply) => {
    const parsed = Signal.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad('Expected { session, kind } and nothing else.'));
    const { session, kind } = parsed.data;
    if (known(session)) {
      const type = kind === 'permission' ? 'needs_input' : 'cleared';
      opts.publish([{ t: now(), session, type }]);
    }
    return reply.code(204).send();
  });

  app.get('/api/hero/:session', { onRequest }, async (req, reply) => {
    const id = SessionId.safeParse((req.params as { session?: unknown }).session);
    if (!id.success) return reply.code(400).send(bad('Not a session id.'));
    const hero = known(id.data);
    if (!hero) return reply.code(404).send(bad('No such hero.'));
    // Only what the status line shows: nothing about the hero's work or folder.
    return { name: hero.name, rank: rankOf(hero), level: hero.level, xp: hero.xp, status: hero.status };
  });
}
