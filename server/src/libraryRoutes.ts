import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  type Archive,
  type ArchiveEntry,
  type Candidate,
  type ReviewInput,
  waitingForUser,
} from './archive.ts';
import { ChatError } from './chats.ts';
import type { Library, LibraryConfig } from './library.ts';
import type { InstalledSkill } from './skills.ts';

/**
 * The Library's routes, all behind the token. `/api/skills...` serve the user's Skills
 * tab; `/api/library...` are what the librarians' MCP tools call. Installing is its own
 * route (install.ts) because it is the one that writes outside the guild's data folder.
 */
export interface LibraryRouteOptions {
  isToken: (given: unknown) => boolean;
  archive: Archive;
  installed: () => Promise<InstalledSkill[]>;
  /** Something in the Archive changed: tell the page (the Skills tab badge). */
  onChange: () => void;
  /** The librarians' schedule, when the guild runs them. */
  library?: Library;
  /** Install a reviewed skill at its pinned commit (install.ts); the user's call only. */
  install?: (entry: ArchiveEntry) => Promise<string>;
}

export async function registerLibraryRoutes(app: FastifyInstance, opts: LibraryRouteOptions): Promise<void> {
  const { archive } = opts;

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

  // ------------------------------------------------------------------ the Skills tab

  app.get(
    '/api/skills',
    guarded(async () => {
      const { entries, notes } = await archive.read();
      return {
        installed: await opts.installed(),
        entries,
        notes,
        waiting: waitingForUser(entries).length,
        ...(opts.library ? { library: opts.library.status() } : {}),
      };
    }),
  );

  app.post(
    '/api/skills/:id/dismiss',
    guarded(async (req) => changed(await archive.setStatus(id(req), 'dismissed'))),
  );

  // The user's decision, and the only route that installs anything.
  const install = opts.install;
  if (install) {
    app.post(
      '/api/skills/:id/install',
      guarded(async (req) => {
        const entry = await archive.get(id(req));
        if (!entry) throw new ChatError(404, 'No such entry in the Archive.');
        if (entry.status !== 'reviewed') {
          throw new ChatError(409, 'Only a reviewed skill waiting for you can be installed.');
        }
        await install(entry);
        return changed(await archive.setStatus(entry.id, 'installed', { installedAt: Date.now() / 1000 }));
      }),
    );
  }

  app.post(
    '/api/skills/:id/rereview',
    guarded(async (req) => changed(await archive.setStatus(id(req), 'candidate', { review: null }))),
  );

  // ------------------------------------------------------------------ the librarians' schedule

  const library = opts.library;
  if (library) {
    app.get(
      '/api/library',
      guarded(async () => library.status()),
    );
    app.put(
      '/api/library',
      guarded(async (req, reply) => {
        try {
          await library.update((req.body ?? {}) as Partial<LibraryConfig>);
        } catch (err) {
          return reply.code(400).send({ error: (err as Error).message });
        }
        return library.status();
      }),
    );
    // Starts the run and answers at once: the librarians take minutes.
    app.post(
      '/api/library/run',
      guarded(async (_req, reply) => {
        if (library.running) throw new ChatError(409, 'The librarians are already at work.');
        void library.run().catch(() => {});
        return reply.code(202).send({ ok: true });
      }),
    );
  }

  // ------------------------------------------------------------------ the librarians' tools

  app.get(
    '/api/library/installed',
    guarded(async () => ({ installed: await opts.installed() })),
  );

  app.get(
    '/api/library/archive',
    guarded(async () => {
      const { entries } = await archive.read();
      // Enough to avoid finding the same skill twice, without every review's text.
      return {
        known: entries.map((e) => ({
          id: e.id,
          name: e.name,
          repo: e.repo,
          path: e.path,
          commit: e.commit,
          status: e.status,
        })),
      };
    }),
  );

  app.get(
    '/api/library/candidates',
    guarded(async () => ({
      candidates: (await archive.read()).entries.filter((e) => e.status === 'candidate'),
    })),
  );

  app.post(
    '/api/library/candidates',
    guarded(async (req) => changed(await archive.addCandidate((req.body ?? {}) as Candidate))),
  );

  app.post(
    '/api/library/reviews',
    guarded(async (req) => changed(await archive.recordReview((req.body ?? {}) as ReviewInput))),
  );

  app.post(
    '/api/library/notes',
    guarded(async (req) => {
      const body = (req.body ?? {}) as { by?: unknown; text?: unknown };
      return changed(await archive.addNote(String(body.by ?? 'Librarian'), String(body.text ?? '')));
    }),
  );
}
