import type { GuildState } from '@agent-guild/core';
import { useCallback, useEffect, useState } from 'react';

import { type Api, ApiError, type ArchiveEntry, type ForgeOrder } from './api.ts';
import { type Decision, decisions } from './decisions.ts';
import { ago } from './panels.tsx';
import { SkillHead, VERDICT } from './skills.tsx';

/**
 * The Needs-you tab (docs/SHARPEN.md, phase B): every decision waiting on the user in one
 * list, newest first, each handled in place. A Knight's question opens its chat; a reviewed
 * skill and a forged piece can be approved and installed, or dismissed, from here. The
 * Skills tab and the Forge page stay, for browsing.
 */

const PIECE_VERDICT = { ready: 'Ready to install', 'needs-work': 'Needs work', risky: 'Risky' } as const;
const folderName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

export interface InboxControl {
  api: Api;
  /** Tick when the Archive or the Forge changes. */
  skillsVersion: number;
  forgeVersion: number;
  /** Answer a Knight: its chat when it has one, else its panel. */
  onAnswer: (heroId: string) => void;
  onOpenSkills: () => void;
  onOpenForge: () => void;
}

export function InboxPanel({
  state,
  now,
  control,
}: {
  state: GuildState;
  now: number;
  control: InboxControl;
}) {
  const { api, skillsVersion, forgeVersion } = control;
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [orders, setOrders] = useState<ForgeOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadSkills = useCallback(
    () =>
      api.skills().then(
        (s) => setEntries(s.entries),
        () => setError('Could not load the Archive.'),
      ),
    [api],
  );
  const loadForge = useCallback(
    () =>
      api.forge().then(
        (s) => setOrders(s.orders),
        () => setError('Could not reach the Forge.'),
      ),
    [api],
  );
  useEffect(() => void loadSkills(), [loadSkills, skillsVersion]);
  useEffect(() => void loadForge(), [loadForge, forgeVersion]);

  const act = async (
    key: string,
    what: string,
    call: () => Promise<unknown>,
    reload: () => Promise<void>,
  ) => {
    setBusy(key);
    setError(null);
    try {
      await call();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${what}.`);
    } finally {
      setBusy(null);
    }
  };

  const list = decisions(state, entries, orders);
  return (
    <section data-testid="inbox" aria-label="Needs you">
      <h2 className="section">Needs you</h2>
      <p className="muted small">
        Everything waiting on your decision: Knights with a question, skills the librarians reviewed, and
        pieces the Forge made. Nothing is installed until you approve it here.
      </p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {list.length === 0 ? (
        <p className="muted small" data-testid="inbox-empty">
          Nothing waits on you.
        </p>
      ) : (
        <ul className="plain skill-cards">
          {list.map((d) => (
            <li key={d.key} className={`skill-card inbox-${d.kind}`} data-testid={d.key}>
              <Row
                d={d}
                now={now}
                busy={busy}
                control={control}
                act={(what, call, reload) =>
                  void act(d.key, what, call, reload === 'skills' ? loadSkills : loadForge)
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({
  d,
  now,
  busy,
  control,
  act,
}: {
  d: Decision;
  now: number;
  busy: string | null;
  control: InboxControl;
  act: (what: string, call: () => Promise<unknown>, reload: 'skills' | 'forge') => void;
}) {
  const { api } = control;
  const working = busy === d.key;
  if (d.kind === 'question')
    return (
      <>
        <p className="inbox-kind">Question</p>
        <p>
          <strong>{d.name}</strong> {d.leader ? 'is waiting for your answer' : 'is waiting (a party member)'}
        </p>
        <p className="muted small">Since {ago(now - d.at)}</p>
        <div className="skill-actions">
          <button
            type="button"
            className="send"
            onClick={() => control.onAnswer(d.heroId)}
            data-testid={`answer-${d.heroId}`}
          >
            Answer
          </button>
        </div>
      </>
    );

  if (d.kind === 'skill') {
    const e = d.entry;
    return (
      <>
        <p className="inbox-kind">Skill from the Library</p>
        <SkillHead entry={e} />
        {e.review && (
          <>
            <p className={`verdict verdict-${VERDICT[e.review.verdict].tone}`}>
              {VERDICT[e.review.verdict].label}
            </p>
            <p className="small">{e.review.reason}</p>
            {e.review.risks.length > 0 && (
              <ul className="risks small" aria-label="Risks">
                {e.review.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="skill-actions">
          <button
            type="button"
            className="send"
            disabled={busy !== null}
            onClick={() => {
              const risky = e.review?.verdict === 'risky' || (e.review?.risks.length ?? 0) > 0;
              if (risky && !window.confirm(`The librarians flagged risks in ${e.name}. Install it anyway?`))
                return;
              act('install', () => api.installSkill(e.id), 'skills');
            }}
            data-testid={`inbox-install-${e.name}`}
          >
            {working ? 'Working…' : 'Approve & install'}
          </button>
          <button
            type="button"
            className="chip"
            disabled={busy !== null}
            onClick={() => act('dismiss', () => api.dismissSkill(e.id), 'skills')}
            data-testid={`inbox-dismiss-${e.name}`}
          >
            Dismiss
          </button>
          <button type="button" className="link" onClick={control.onOpenSkills}>
            Details
          </button>
        </div>
      </>
    );
  }

  const o = d.order;
  return (
    <>
      <p className="inbox-kind">
        {o.kind === 'skill' ? 'Skill from the Forge' : 'Slash command from the Forge'}
      </p>
      <div className="skill-head">
        <strong>{o.piece?.name}</strong>{' '}
        <span className="muted">
          for {folderName(o.project)}, asked by {o.requestedBy}
        </span>
        {o.piece?.description && <div className="small">{o.piece.description}</div>}
      </div>
      {o.review && (
        <>
          <p className={`verdict verdict-${o.review.verdict === 'ready' ? 'good' : 'bad'}`}>
            {PIECE_VERDICT[o.review.verdict]}
          </p>
          <p className="small">{o.review.reason}</p>
        </>
      )}
      <div className="skill-actions">
        <button
          type="button"
          className="send"
          disabled={busy !== null}
          onClick={() => {
            if (
              o.review?.verdict !== 'ready' &&
              !window.confirm(
                `The Library marked ${o.piece?.name} "${o.review?.verdict}". Install it anyway?`,
              )
            )
              return;
            act('install', () => api.installPiece(o.id), 'forge');
          }}
          data-testid={`inbox-install-order-${o.id}`}
        >
          {working ? 'Working…' : 'Approve & install'}
        </button>
        <button
          type="button"
          className="chip"
          disabled={busy !== null}
          onClick={() => act('dismiss', () => api.dismissPiece(o.id), 'forge')}
          data-testid={`inbox-dismiss-order-${o.id}`}
        >
          Dismiss
        </button>
        <button type="button" className="link" onClick={control.onOpenForge}>
          See its files
        </button>
      </div>
    </>
  );
}
