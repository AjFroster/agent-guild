import type { FastifyReply, FastifyRequest } from 'fastify';

import { ChatError } from './chats.ts';

/**
 * What every control route does first: check the per-run token, then run the handler and
 * turn a ChatError into its status and message. One copy for every route file.
 */

export type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** Whether the request carries the token as `Authorization: Bearer …`; a 401 if not. */
export function tokenCheck(isToken: (given: unknown) => boolean) {
  return (req: FastifyRequest, reply: FastifyReply): boolean => {
    const header = req.headers.authorization ?? '';
    if (isToken(header.startsWith('Bearer ') ? header.slice(7) : undefined)) return true;
    void reply.code(401).send({ error: 'Missing or wrong token.' });
    return false;
  };
}

/**
 * Wraps handlers behind the token. A ChatError becomes its status and message; any other
 * error is thrown on (a 500), unless `otherErrors` is 400, for routes whose only failures
 * are bad input.
 */
export function guard(isToken: (given: unknown) => boolean, { otherErrors }: { otherErrors?: 400 } = {}) {
  const authorized = tokenCheck(isToken);
  return (handler: Handler) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authorized(req, reply)) return reply;
    try {
      return await handler(req, reply);
    } catch (err) {
      if (err instanceof ChatError) return reply.code(err.status).send({ error: err.message });
      if (otherErrors === 400) return reply.code(400).send({ error: (err as Error).message });
      throw err;
    }
  };
}
