import type { FastifyInstance, FastifyRequest } from 'fastify';

import { type ChatMode, ChatError } from './chats.ts';
import type { Court } from './king.ts';
import { guard } from './routes.ts';
import type { WarRoom } from './wars.ts';

/**
 * The War Room's routes (docs/WARS.md), every one behind the token. `/api/wars...` are for
 * the page; `/api/king/wars...` are what the King's tools call (list_wars, declare_battle,
 * send_knight).
 */
export interface WarRouteOptions {
  isToken: (given: unknown) => boolean;
  wars: WarRoom;
  /** Start a Knight from the War Room: the user's own, not the King's. */
  startKnight: (o: {
    cwd: string;
    name: string;
    message: string;
    mode?: ChatMode;
  }) => Promise<{ id: string }>;
  court: Court;
}

export async function registerWarRoutes(app: FastifyInstance, opts: WarRouteOptions): Promise<void> {
  const { wars, court } = opts;
  const guarded = guard(opts.isToken);
  const param = (req: FastifyRequest, name: 'war' | 'branch' | 'aim' | 'date') =>
    decodeURIComponent((req.params as Record<string, string>)[name] ?? '');
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;

  app.get(
    '/api/wars',
    guarded(async () => wars.statusNow()),
  );

  app.post(
    '/api/wars',
    guarded(async (req, reply) => reply.code(201).send(await wars.declare(body(req)))),
  );

  app.put(
    '/api/wars/settings',
    guarded(async (req) => wars.updateSettings(body(req))),
  );

  app.post(
    '/api/wars/reports',
    guarded(async (req, reply) => reply.code(201).send(await wars.report())),
  );

  app.get(
    '/api/wars/reports',
    guarded(async () => ({ reports: await wars.reports() })),
  );

  app.get(
    '/api/wars/reports/:date',
    guarded(async (req) => wars.readReport(param(req, 'date'))),
  );

  app.post(
    '/api/wars/:war',
    guarded(async (req) => wars.update(param(req, 'war'), body(req))),
  );

  app.post(
    '/api/wars/:war/battles',
    guarded(async (req, reply) =>
      reply.code(201).send(await wars.declareBattle(param(req, 'war'), body(req))),
    ),
  );

  app.post(
    '/api/wars/:war/aims/:aim/withdraw',
    guarded(async (req) => wars.withdrawAim(param(req, 'war'), param(req, 'aim'))),
  );

  // Branch names hold slashes, so they travel in the body rather than the path.
  app.post(
    '/api/wars/:war/mark',
    guarded(async (req) => {
      const b = body(req);
      return wars.mark(param(req, 'war'), String(b.branch ?? ''), b.outcome ?? null);
    }),
  );

  app.post(
    '/api/wars/:war/clear',
    guarded(async (req) => wars.clearField(param(req, 'war'), String(body(req).branch ?? ''))),
  );

  app.post(
    '/api/wars/:war/knights',
    guarded(async (req, reply) => {
      const b = body(req);
      const order = checkOrder(b.order);
      const branch = String(b.branch ?? '');
      const { cwd, brief, war } = await wars.prepareBattle(param(req, 'war'), branch);
      const name =
        String(b.name ?? '')
          .trim()
          .slice(0, 40) || knightName(branch);
      const info = await opts.startKnight({
        cwd,
        name,
        message: `${brief}\n\n${order}`,
        ...(typeof b.mode === 'string' ? { mode: b.mode as ChatMode } : {}),
      });
      await wars.sent();
      return reply.code(201).send({ id: info.id, war: war.name, branch });
    }),
  );

  // ------------------------------------------------------------------ the King's

  app.get(
    '/api/king/wars',
    guarded(async () => wars.kingView()),
  );

  app.post(
    '/api/king/wars/:war/battles',
    guarded(async (req, reply) =>
      reply.code(201).send(await wars.declareBattle(param(req, 'war'), body(req))),
    ),
  );

  app.post(
    '/api/king/wars/:war/knights',
    guarded(async (req, reply) => {
      const b = body(req);
      const order = checkOrder(b.order);
      const branch = String(b.branch ?? '');
      const { cwd, brief } = await wars.prepareBattle(param(req, 'war'), branch);
      const result = await court.raise({
        folder: cwd,
        name:
          String(b.name ?? '')
            .trim()
            .slice(0, 40) || knightName(branch),
        order: `${brief}\n\n${order}`,
        waitSeconds: b.waitSeconds,
        ...(typeof b.mode === 'string' ? { mode: b.mode as ChatMode } : {}),
      });
      await wars.sent();
      return reply.code(201).send(result);
    }),
  );
}

function checkOrder(order: unknown): string {
  if (typeof order !== 'string' || !order.trim()) throw new ChatError(400, 'Write the order for the Knight.');
  if (order.length > 20_000) throw new ChatError(413, 'That order is too long.');
  return order;
}

/** "feat/activity-feed" sends a Knight called "activity-feed". */
export const knightName = (branch: string) => (branch.split('/').at(-1) || branch).slice(0, 40);
