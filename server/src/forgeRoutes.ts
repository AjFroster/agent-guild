import { basename } from 'node:path';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { type ChatManager, ChatError } from './chats.ts';
import { type Forge, type ForgeStore, type Order, installPiece, pieceDestination } from './forge.ts';

/**
 * The Forge's routes, all behind the token. `/api/forge` and `/api/forge/orders...` serve
 * the Forge page; the rest are what each role's MCP tools call: the Knight asks
 * (`requests`), the Blacksmith forges (`anvil`, `pieces`), the Reviewer tests (`forged`,
 * `reviews`), and the King commissions for a Knight (`commission`). Installing is the
 * user's click only.
 */
export interface ForgeRouteOptions {
  isToken: (given: unknown) => boolean;
  store: ForgeStore;
  forge: Forge;
  chats: ChatManager;
  onChange: () => void;
  /** A Knight by name or id, for the King's commissions: its session and folder. */
  resolveKnight?: (knight: string) => { id: string; name: string; cwd: string | null };
}

/** What waits on the user: reviewed pieces. */
export const forgeWaiting = (orders: Order[]) => orders.filter((o) => o.status === 'reviewed').length;

export async function registerForgeRoutes(app: FastifyInstance, opts: ForgeRouteOptions): Promise<void> {
  const { store, forge, chats } = opts;

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
        if (err instanceof ChatError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    };
  const changed = <T>(value: T): T => {
    opts.onChange();
    return value;
  };
  const id = (req: FastifyRequest) => (req.params as { id: string }).id;
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;

  /** Take an order and set the Forge to work; the work goes on after the answer. */
  const take = async (order: Order) => {
    changed(order);
    void forge.kick();
    return { id: order.id, status: order.status };
  };

  // ------------------------------------------------------------------ the Forge page

  app.get(
    '/api/forge',
    guarded(async () => {
      const { orders } = await store.read();
      return { orders, current: forge.current, waiting: forgeWaiting(orders) };
    }),
  );

  app.post(
    '/api/forge/orders',
    guarded(async (req) => {
      const b = body(req);
      const project = await chats.checkFolder(b.project);
      return take(await store.addOrder({ project, kind: b.kind, need: b.need, requestedBy: 'You' }));
    }),
  );

  app.post(
    '/api/forge/orders/:id/install',
    guarded(async (req) => {
      const order = await store.get(id(req));
      if (!order) throw new ChatError(404, 'No such order at the Forge.');
      if (order.status !== 'reviewed') throw new ChatError(409, 'Only a reviewed piece can be installed.');
      const dest = await installPiece(order);
      const done = await store.update(order.id, (o) => {
        o.status = 'installed';
        o.installedAt = Date.now() / 1000;
      });
      tellKnight(done, dest);
      return changed({ order: done, installedAt: dest });
    }),
  );

  app.post(
    '/api/forge/orders/:id/dismiss',
    guarded(async (req) =>
      changed(
        await store.update(id(req), (o) => {
          o.status = 'dismissed';
        }),
      ),
    ),
  );

  // Back on the anvil, with what the Reviewer said, for another try.
  app.post(
    '/api/forge/orders/:id/reforge',
    guarded(async (req) => {
      const order = await store.update(id(req), (o) => {
        if (o.status === 'installed') throw new ChatError(409, 'That piece is already installed.');
        if (o.review)
          o.need = `${o.need}\n\nThe Reviewer said of the last piece: ${o.review.reason}`.slice(0, 2000);
        o.status = 'requested';
        o.piece = null;
        o.review = null;
        o.error = null;
      });
      return take(order);
    }),
  );

  /** Tell the Knight who asked that its piece is in place, if it is a guild chat at rest. */
  const tellKnight = (order: Order, dest: string) => {
    const knight = order.knightId ? chats.list().find((c) => c.id === order.knightId) : undefined;
    if (!knight || knight.busy || !order.piece) return;
    const how =
      order.kind === 'skill'
        ? `Read its SKILL.md there and use it whenever it fits.`
        : `Run it as /${order.piece.name}.`;
    chats.send(
      knight.id,
      `The Forge: the ${order.kind} you asked for, "${order.piece.name}", was reviewed and the user installed it at ${dest}. ${how}`,
    );
  };

  /** Nothing was forged: the Knight is told what it already has. */
  const tellKnightExisting = (order: Order) => {
    const knight = order.knightId ? chats.list().find((c) => c.id === order.knightId) : undefined;
    if (!knight || knight.busy || !order.existing) return;
    const { name, where, reason } = order.existing;
    chats.send(
      knight.id,
      where === 'archive'
        ? `The Forge: nothing was forged. The Library already has "${name}" (${reason}); it waits for the user to install it.`
        : `The Forge: nothing was forged. You already have the skill "${name}" (${where}): ${reason}`,
    );
  };

  // ------------------------------------------------------------------ a Knight asks

  /** The Knight is told apart by its folder: the guild chat running there. */
  const knightIn = (cwd: string) => {
    const here = chats.list().filter((c) => c.cwd === cwd);
    return here.length === 1 ? here[0]! : null;
  };

  app.post(
    '/api/forge/requests',
    guarded(async (req) => {
      const b = body(req);
      const project = await chats.checkFolder(b.cwd);
      const knight = knightIn(project);
      const order = await store.addOrder({
        project,
        kind: b.kind,
        need: b.need,
        requestedBy: knight?.name ?? basename(project),
        knightId: knight?.id ?? null,
      });
      await take(order);
      return {
        id: order.id,
        status: order.status,
        message:
          'The Forge has your order. The Blacksmith will forge it and the Library will review it; then the user decides. You will be told when it is installed. Carry on with your quest meanwhile.',
      };
    }),
  );

  app.get(
    '/api/forge/requests',
    guarded(async (req) => {
      const cwd = String((req.query as { cwd?: string }).cwd ?? '');
      const project = await chats.checkFolder(cwd);
      return {
        orders: (await store.read()).orders
          .filter((o) => o.project === project)
          .map((o) => ({
            id: o.id,
            kind: o.kind,
            need: o.need,
            status: o.status,
            piece: o.piece?.name ?? null,
            verdict: o.review?.verdict ?? null,
            installedAt: o.status === 'installed' && o.piece ? pieceDestination(o, o.piece.name) : null,
          })),
      };
    }),
  );

  // ------------------------------------------------------------------ the King commissions

  const resolveKnight = opts.resolveKnight;
  if (resolveKnight) {
    app.post(
      '/api/forge/commission',
      guarded(async (req) => {
        const b = body(req);
        const knight = resolveKnight(String(b.knight ?? ''));
        if (!knight.cwd) throw new ChatError(409, `The guild does not know ${knight.name}'s folder.`);
        const project = await chats.checkFolder(knight.cwd);
        const order = await store.addOrder({
          project,
          kind: b.kind,
          need: b.need,
          requestedBy: 'King',
          knightId: knight.id,
        });
        return { ...(await take(order)), for: knight.name };
      }),
    );
  }

  // ------------------------------------------------------------------ the Blacksmith

  app.get(
    '/api/forge/anvil',
    guarded(async () => {
      const order = forge.current ? await store.get(forge.current) : null;
      if (!order || order.status !== 'forging') throw new ChatError(404, 'Nothing is on the anvil.');
      return {
        id: order.id,
        kind: order.kind,
        need: order.need,
        requestedBy: order.requestedBy,
        project: basename(order.project),
      };
    }),
  );

  app.post(
    '/api/forge/pieces',
    guarded(async (req) => {
      const order = await store.submitPiece(body(req) as never);
      return changed({ id: order.id, status: order.status, name: order.piece?.name });
    }),
  );

  app.post(
    '/api/forge/existing',
    guarded(async (req) => {
      const order = await store.alreadyExists(body(req) as never);
      tellKnightExisting(order);
      return changed({ id: order.id, status: order.status });
    }),
  );

  // ------------------------------------------------------------------ the Reviewer

  app.get(
    '/api/forge/forged',
    guarded(async () => ({
      pieces: (await store.read()).orders
        .filter((o) => o.status === 'forged')
        .map((o) => ({ id: o.id, kind: o.kind, need: o.need, requestedBy: o.requestedBy, piece: o.piece })),
    })),
  );

  app.post(
    '/api/forge/reviews',
    guarded(async (req) => {
      const order = await store.recordReview(body(req) as never);
      return changed({ id: order.id, status: order.status, verdict: order.review?.verdict });
    }),
  );
}
