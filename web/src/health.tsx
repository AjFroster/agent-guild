import { type GuildState, tokensByUtility } from '@agent-guild/core';
import { useEffect, useState } from 'react';

import type { Api, UtilityRun } from './api.ts';
import { compact } from './format.ts';
import { ago } from './panels.tsx';

/**
 * What a utility costs and how it is doing, on its building's page: the tokens its helpers
 * spent this week, and its last run (when, how long, and whether it worked).
 */

const WEEK = 7 * 24 * 3600;

const duration = (seconds: number) =>
  seconds < 90 ? `${Math.max(1, Math.round(seconds))} s` : `${Math.round(seconds / 60)} min`;

export function UtilityHealth({
  utility,
  state,
  now,
  api,
  version,
}: {
  utility: 'library' | 'forge';
  state: GuildState;
  now: number;
  /** Live only: where the run log comes from. */
  api?: Api | undefined;
  /** Ticks when a run ends. */
  version?: number | undefined;
}) {
  const [runs, setRuns] = useState<UtilityRun[] | null>(null);
  useEffect(() => {
    api?.runs().then(
      (r) => setRuns(r.runs.filter((x) => x.utility === utility)),
      () => setRuns(null),
    );
  }, [api, version, utility]);

  const week = tokensByUtility(state, now - WEEK)[utility];
  const weekRuns = runs?.filter((r) => r.startedAt >= now - WEEK) ?? [];
  const last = runs?.[0];
  return (
    <div className="ts-card" data-testid={`${utility}-health`}>
      <h3 className="ts-ribbon ts-ribbon-blue">Cost and health</h3>
      <p data-testid={`${utility}-cost`}>
        <strong>{compact(week)}</strong> tokens this week
        {weekRuns.length > 0 &&
          week > 0 &&
          ` over ${weekRuns.length} ${weekRuns.length === 1 ? 'run' : 'runs'}, about ${compact(week / weekRuns.length)} a run`}
        .
      </p>
      {api &&
        (last ? (
          <p data-testid={`${utility}-last-run`} data-ok={last.ok}>
            Last run {ago(now - last.endedAt)}, took {duration(last.endedAt - last.startedAt)}:{' '}
            <span className={last.ok ? 'verdict verdict-good' : 'verdict verdict-bad'}>
              {last.ok ? 'worked' : 'failed'}
            </span>{' '}
            <span className="small">{last.detail}</span>
          </p>
        ) : (
          <p className="muted small">No runs yet.</p>
        ))}
    </div>
  );
}
