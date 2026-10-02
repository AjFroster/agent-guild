import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { type PortWatcher, pagePortal } from './ports.ts';

/**
 * The Portal Keeper's routes, behind the token: the portals (what is listening on a local
 * port), and the user's settings for them (check for websites, names, pins, hidden ports).
 */
export interface PortalRouteOptions {
  isToken: (given: unknown) => boolean;
  ports: PortWatcher;
}

/** What the page and the live announcements carry. */
export const portalStatus = (ports: PortWatcher) => ({
  portals: ports.list().map(pagePortal),
  hidden: ports.hidden(),
  probe: ports.settings.probe,
});

export async function registerPortalRoutes(app: FastifyInstance, opts: PortalRouteOptions): Promise<void> {
  const { ports } = opts;
  const guarded =
    (handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const header = req.headers.authorization ?? '';
      if (!opts.isToken(header.startsWith('Bearer ') ? header.slice(7) : undefined)) {
        return reply.code(401).send({ error: 'Missing or wrong token.' });
      }
      try {
        return await handler(req, reply);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    };

  app.get(
    '/api/portals',
    guarded(async () => portalStatus(ports)),
  );

  app.put(
    '/api/portals',
    guarded(async (req) => {
      const body = (req.body ?? {}) as { probe?: unknown };
      await ports.update({ probe: body.probe });
      return portalStatus(ports);
    }),
  );

  app.post(
    '/api/portals/:port',
    guarded(async (req) => {
      const body = (req.body ?? {}) as { name?: unknown; hidden?: unknown; pinned?: unknown };
      await ports.update({ port: (req.params as { port: string }).port, ...body });
      return portalStatus(ports);
    }),
  );
}
