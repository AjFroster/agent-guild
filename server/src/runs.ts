import type { FastifyInstance } from 'fastify';

import { JsonStore, list } from './jsonStore.ts';
import { guard } from './routes.ts';

/**
 * Each utility's runs, kept so its page can say when it last ran, for how long, and
 * whether it worked, and so a failed run raises a notice instead of only a note.
 */

export type Utility = 'library' | 'forge';

export interface Run {
  utility: Utility;
  startedAt: number;
  endedAt: number;
  ok: boolean;
  /** What happened, in a line: what was done, or why it failed. */
  detail: string;
}

const MAX_RUNS = 100;

export class RunLog {
  private readonly store: JsonStore<{ runs: Run[] }>;

  constructor(file: string) {
    this.store = new JsonStore(file, (raw) => ({ runs: list<Run>(raw.runs) }));
  }

  async runs(): Promise<Run[]> {
    return (await this.store.read()).runs;
  }

  add(run: Run): Promise<void> {
    return this.store.change((data) => {
      data.runs = [{ ...run, detail: run.detail.slice(0, 300) }, ...data.runs].slice(0, MAX_RUNS);
    });
  }
}

/** How many runs failed, all told: the inbox's notice fires when this goes up. */
export const failedRuns = (runs: Run[]) => runs.filter((r) => !r.ok).length;

export async function registerRunRoutes(
  app: FastifyInstance,
  opts: { isToken: (given: unknown) => boolean; log: RunLog },
): Promise<void> {
  const guarded = guard(opts.isToken);
  app.get(
    '/api/runs',
    guarded(async () => {
      const runs = await opts.log.runs();
      return { runs, failed: failedRuns(runs) };
    }),
  );
}
