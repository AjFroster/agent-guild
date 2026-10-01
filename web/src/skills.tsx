import { useCallback, useEffect, useState } from 'react';

import { type Api, ApiError, type ArchiveEntry, type SkillsStatus, type Verdict } from './api.ts';
import { ago } from './panels.tsx';

/**
 * The Skills tab: the librarians' Archive, for the user to review. Reviewed skills wait
 * here for a decision (install, dismiss, review again); below them are the librarians'
 * schedule, what is still to be reviewed, the skills already installed, the librarians'
 * notes and the whole history.
 */

const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  gap: { label: 'Fills a gap', tone: 'good' },
  better: { label: 'Better than what you have', tone: 'good' },
  duplicate: { label: 'Duplicate', tone: 'plain' },
  risky: { label: 'Risky', tone: 'bad' },
};

const STATUS_LABEL: Record<ArchiveEntry['status'], string> = {
  candidate: 'Waiting for review',
  reviewed: 'Waiting for you',
  installed: 'Installed',
  dismissed: 'Dismissed',
};

/** The skill's folder on GitHub at the commit that was reviewed. */
const sourceUrl = (e: ArchiveEntry) =>
  `https://github.com/${e.repo}/tree/${e.commit}${e.path ? `/${e.path}` : ''}`;

export function SkillsPanel({ api, version, now }: { api: Api; version: number; now: number }) {
  const [status, setStatus] = useState<SkillsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.skills().then(
      (s) => {
        setStatus(s);
        setError(null);
      },
      () => setError('Could not load the Archive.'),
    );
  }, [api]);
  useEffect(load, [load, version]);

  const act = async (id: string, what: string, call: () => Promise<unknown>) => {
    setBusy(`${what}:${id}`);
    setError(null);
    try {
      await call();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${what}.`);
    } finally {
      setBusy(null);
    }
  };

  if (!status) return <p className="muted">{error ?? 'Opening the Archive…'}</p>;
  const waiting = status.entries.filter((e) => e.status === 'reviewed');
  const candidates = status.entries.filter((e) => e.status === 'candidate');

  return (
    <section data-testid="skills-panel" aria-label="Skills">
      <h2 className="section">Skills to review</h2>
      <p className="muted small">
        The librarians find new skills and review them against the ones you have. Nothing is installed until
        you approve it, and then only the exact commit they reviewed.
      </p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {waiting.length === 0 ? (
        <p className="muted small" data-testid="nothing-to-review">
          Nothing waiting for you.
        </p>
      ) : (
        <ul className="plain skill-cards">
          {waiting.map((e) => (
            <li key={e.id} className="skill-card" data-testid={`skill-${e.name}`}>
              <SkillHead entry={e} />
              {e.review && (
                <>
                  <p className={`verdict verdict-${VERDICT[e.review.verdict].tone}`}>
                    {VERDICT[e.review.verdict].label}
                  </p>
                  <p className="small">{e.review.reason}</p>
                  {e.review.overlaps.length > 0 && (
                    <p className="muted small">Overlaps: {e.review.overlaps.join(', ')}</p>
                  )}
                  {e.review.risks.length > 0 && (
                    <ul className="risks small" aria-label="Risks">
                      {e.review.risks.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  <p className="muted small">Reviewed {ago(now - e.review.reviewedAt)}</p>
                </>
              )}
              <div className="skill-actions">
                <button
                  type="button"
                  className="send"
                  disabled={busy !== null}
                  onClick={() => {
                    const risky = e.review?.verdict === 'risky' || (e.review?.risks.length ?? 0) > 0;
                    if (
                      risky &&
                      !window.confirm(`The librarians flagged risks in ${e.name}. Install it anyway?`)
                    )
                      return;
                    void act(e.id, 'install', () => api.installSkill(e.id));
                  }}
                  data-testid={`install-${e.name}`}
                >
                  {busy === `install:${e.id}` ? 'Installing…' : 'Approve & install'}
                </button>
                <button
                  type="button"
                  className="chip"
                  disabled={busy !== null}
                  onClick={() => void act(e.id, 'dismiss', () => api.dismissSkill(e.id))}
                  data-testid={`dismiss-${e.name}`}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  className="chip"
                  disabled={busy !== null}
                  onClick={() => void act(e.id, 're-review', () => api.rereviewSkill(e.id))}
                >
                  Review again
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {status.library && <LibrariansCard api={api} library={status.library} onChange={load} />}

      {candidates.length > 0 && (
        <>
          <h3>Waiting for the Reviewer ({candidates.length})</h3>
          <ul className="plain">
            {candidates.map((e) => (
              <li key={e.id} className="small">
                <SkillHead entry={e} compact />
              </li>
            ))}
          </ul>
        </>
      )}

      <details className="skills-installed">
        <summary>
          <h3>Installed skills ({status.installed.length})</h3>
        </summary>
        <ul className="plain small">
          {status.installed.map((s) => (
            <li key={`${s.source}:${s.path}`}>
              <strong>{s.name}</strong> <span className="muted">· {s.source}</span>
              {s.description && <div className="muted">{s.description}</div>}
            </li>
          ))}
        </ul>
      </details>

      {status.notes.length > 0 && (
        <>
          <h3>Librarians&apos; notes</h3>
          <ul className="plain small notes">
            {status.notes.slice(0, 5).map((n) => (
              <li key={`${n.at}-${n.by}`}>
                <strong>{n.by}</strong> <span className="muted">· {ago(now - n.at)}</span>
                <div>{n.text}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Archive</h3>
      {status.entries.length === 0 ? (
        <p className="muted small">The Archive is empty: the librarians have not reviewed anything yet.</p>
      ) : (
        <ul className="plain small archive" data-testid="archive">
          {status.entries.map((e) => (
            <li key={e.id}>
              <SkillHead entry={e} compact />
              <span className={`archive-status status-${e.status}`}>{STATUS_LABEL[e.status]}</span>
              {e.review && <span className="muted"> · {VERDICT[e.review.verdict].label}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SkillHead({ entry: e, compact = false }: { entry: ArchiveEntry; compact?: boolean }) {
  return (
    <div className="skill-head">
      <strong>{e.name}</strong>{' '}
      <a href={sourceUrl(e)} target="_blank" rel="noreferrer noopener" className="muted">
        {e.repo}
        {e.path ? `/${e.path}` : ''}
      </a>{' '}
      <span className="muted">
        ★ {e.stars.toLocaleString()} · <code>{e.commit.slice(0, 7)}</code>
      </span>
      {!compact && e.description && <div className="small">{e.description}</div>}
    </div>
  );
}

function LibrariansCard({
  api,
  library,
  onChange,
}: {
  api: Api;
  library: NonNullable<SkillsStatus['library']>;
  onChange: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const { config } = library;
  const update = async (patch: Partial<typeof config>) => {
    try {
      await api.updateLibrary(patch);
      setError(null);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  };
  return (
    <div className="crier librarians" data-testid="librarians">
      <h3>The librarians</h3>
      <p className="muted small">
        Each day the Scout searches GitHub for new, well-starred skills and the Reviewer reads each one
        against yours. Each run uses your Claude usage.{' '}
        {library.running
          ? 'Working now.'
          : config.enabled && library.nextRunAt
            ? `Next: ${new Date(library.nextRunAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.`
            : 'Paused.'}
      </p>
      <div className="crier-controls">
        <label>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => void update({ enabled: e.target.checked })}
            data-testid="librarians-enabled"
          />{' '}
          Daily at
        </label>
        <input type="time" value={config.time} onChange={(e) => void update({ time: e.target.value })} />
        <label>
          up to{' '}
          <input
            type="number"
            min={1}
            max={10}
            defaultValue={config.maxCandidates}
            onBlur={(e) => void update({ maxCandidates: Number(e.target.value) })}
          />{' '}
          skills
        </label>
      </div>
      <button
        type="button"
        className="chip"
        disabled={library.running}
        onClick={() =>
          void api
            .runLibrary()
            .then(onChange, (err: unknown) =>
              setError(err instanceof ApiError ? err.message : 'Could not start the librarians.'),
            )
        }
        data-testid="librarians-run"
      >
        Run now
      </button>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
