import type { FastifyInstance } from 'fastify';

import { type PortWatcher, pagePortal } from './ports.ts';
import { guard } from './routes.ts';

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
  const guarded = guard(opts.isToken, { otherErrors: 400 });

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
