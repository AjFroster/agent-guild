import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ChatError } from './chats.ts';
import type { Court, RaiseOrder } from './king.ts';

/**
 * The King's routes. `/api/king` and `/api/king/messages` are for the page (talking to
 * the King); `/api/king/knights...` are what the King's MCP tools call. All of them need
 * the token, like every control route.
 */
export async function registerKingRoutes(
  app: FastifyInstance,
  opts: {
    isToken: (given: unknown) => boolean;
    court: Court;
    /** What the Archive tells the King: the skills Knights can use, and the latest notes. */
    archive?: () => Promise<unknown>;
  },
): Promise<void> {
  const { court } = opts;

  const authorized = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const header = req.headers.authorization ?? '';
    if (opts.isToken(header.startsWith('Bearer ') ? header.slice(7) : undefined)) return true;
    void reply.code(401).send({ error: 'Missing or wrong token.' });
    return false;
  };

  /** Run a handler behind the token, turning a ChatError into its status and message. */
  const guarded =
    (handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!authorized(req, reply)) return reply;
      try {
        return await handler(req, reply);
      } catch (err) {
        if (err instanceof ChatError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    };

  const knightParam = (req: FastifyRequest) => (req.params as { knight: string }).knight;

  app.get(
    '/api/king',
    guarded(async () => ({ id: court.kingId, commanded: [...court.commanded] })),
  );

  app.post(
    '/api/king/messages',
    guarded(async (req) => {
      const { text } = (req.body ?? {}) as { text?: unknown };
      if (typeof text !== 'string' || text.length > 100_000) {
        throw new ChatError(400, 'Send the King a message of up to 100,000 characters.');
      }
      return court.speak(text);
    }),
  );

  const archive = opts.archive;
  if (archive) {
    app.get(
      '/api/king/archive',
      guarded(async () => archive()),
    );
  }

  app.get(
    '/api/king/knights',
    guarded(async () => ({ knights: court.knights() })),
  );

  app.get(
    '/api/king/knights/:knight',
    guarded(async (req) => {
      const { last } = req.query as { last?: string };
      return court.read(knightParam(req), Number(last ?? 10));
    }),
  );

  app.post(
    '/api/king/knights/:knight/orders',
    guarded(async (req) => {
      const body = (req.body ?? {}) as { order?: unknown; waitSeconds?: unknown };
      return court.command(knightParam(req), {
        order: String(body.order ?? ''),
        waitSeconds: body.waitSeconds,
      });
    }),
  );

  app.post(
    '/api/king/knights/:knight/halt',
    guarded(async (req) => court.halt(knightParam(req))),
  );

  app.post(
    '/api/king/knights',
    guarded(async (req, reply) => {
      const result = await court.raise((req.body ?? {}) as RaiseOrder);
      return reply.code(201).send(result);
    }),
  );
}
