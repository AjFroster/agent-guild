import { type GuildState, type Hero, librarianState, smithDoing } from '@agent-guild/core';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  type Api,
  ApiError,
  type ForgeOrder,
  type ForgeStatus,
  type OrderStatus,
  type PieceKind,
} from './api.ts';
import {
  type ForgePick,
  type ForgeView,
  describeForge,
  drawForgeScene,
  forgeModel,
  forgePick,
  samePick,
} from './forgeScene.ts';
import { ago } from './panels.tsx';
import { SceneCanvas } from './SceneCanvas.tsx';

/**
 * The Forge page, reached by clicking the Forge on the map (docs/FORGE.md). On top, the
 * Forge's grounds as a Tiny Swords scene (forgeScene.ts). Below: the smiths, a form to
 * commission a piece for a project, and every order with its piece's files and the
 * Library's review, for the user to approve and install, dismiss, or send back to the anvil.
 */

const STATUS_LABEL: Record<OrderStatus, string> = {
  requested: 'Waiting its turn',
  forging: 'On the anvil',
  forged: 'With the Library',
  reviewed: 'Ready for you',
  installed: 'Installed',
  dismissed: 'Dismissed',
  failed: 'Failed',
  exists: 'Already in the Library',
};

const VERDICT_LABEL = { ready: 'Ready to install', 'needs-work': 'Needs work', risky: 'Risky' } as const;
const KIND_LABEL: Record<PieceKind, string> = { skill: 'Skill (a sword)', command: 'Slash command (an axe)' };

export interface ForgeControl {
  api: Api;
  /** Ticks when the Forge changes. */
  version: number;
  onTalk: (id: string) => void;
}

const folderName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

/** Where an installed piece lives in its project. */
export const destination = (o: ForgeOrder) =>
  o.piece
    ? o.kind === 'skill'
      ? `${o.project}/.claude/skills/${o.piece.name}`
      : `${o.project}/.claude/commands/${o.piece.name}.md`
    : null;

function forgeView(status: ForgeStatus): ForgeView {
  const of = (s: OrderStatus) => status.orders.filter((o) => o.status === s);
  return {
    rack: of('reviewed').map((o) => ({
      id: o.id,
      name: o.piece?.name ?? '',
      kind: o.kind,
      verdict: o.review?.verdict ?? null,
    })),
    atLibrary: of('forged').length,
    forging: of('forging').length > 0,
    queued: of('requested').length,
  };
}

export function ForgePage({
  state,
  now,
  animate,
  control,
  onBack,
  onSelectHero,
}: {
  state: GuildState;
  now: number;
  animate: boolean;
  control?: ForgeControl | undefined;
  onBack: () => void;
  onSelectHero: (id: string) => void;
}) {
  const [status, setStatus] = useState<ForgeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = control?.api;
  const load = useCallback(() => {
    api?.forge().then(
      (s) => {
        setStatus(s);
        setError(null);
      },
      () => setError('Could not reach the Forge.'),
    );
  }, [api]);
  useEffect(load, [load, control?.version]);

  const model = useMemo(() => forgeModel(state, status ? forgeView(status) : null), [state, status]);
  const blacksmith = model.seats[0]!.hero;

  const onPick = (p: ForgePick) => {
    if (p.kind === 'smith') {
      if (control) control.onTalk(p.id);
      else onSelectHero(p.id);
      return;
    }
    const id = p.kind === 'piece' ? `order-${p.id}` : p.kind === 'anvil' ? 'forge-anvil' : 'forge-orders';
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <section className="library-page forge-page" data-testid="forge-page" aria-label="The Forge">
      <div className="library-head">
        <button type="button" className="ts-button" onClick={onBack} data-testid="forge-back">
          ← Back to the village
        </button>
        <h2 className="ts-ribbon ts-ribbon-red">The Forge</h2>
      </div>
      <SceneCanvas
        model={model}
        animate={animate}
        draw={drawForgeScene}
        pick={forgePick}
        same={samePick}
        onPick={onPick}
        label={describeForge(model)}
        testId="forge-scene"
      />
      <p className="muted small library-hint">
        Click the Blacksmith to {control ? 'open its chat' : 'see its session'}, or a weapon on the rack to
        see that piece. A sword is a skill, an axe a slash command.
      </p>
      <ul className="plain library-desks" aria-label="Smiths">
        <SmithDesk name="Blacksmith" hero={blacksmith} now={now} onTalk={control?.onTalk} />
        <li className="ts-card library-desk" data-testid="desk-Armorer" data-state="unhired">
          <h3 className="ts-ribbon ts-ribbon-blue">Armorer</h3>
          <p>
            <span className="desk-state">Coming next</span>
          </p>
          <p className="muted small">
            Will mend broken weapons at the Repair Bench: a failing build or test, a branch that no longer
            merges. In its own worktree, on its own branch, never pushing.
          </p>
        </li>
      </ul>
      {control && <Commission api={control.api} onDone={load} />}
      {control && <Orders api={control.api} status={status} error={error} now={now} onChanged={load} />}
    </section>
  );
}

function SmithDesk({
  name,
  hero,
  now,
  onTalk,
}: {
  name: string;
  hero: Hero | undefined;
  now: number;
  onTalk?: ((id: string) => void) | undefined;
}) {
  const state = hero ? librarianState(hero) : 'away';
  const doing = hero ? smithDoing(hero) : null;
  const label = { working: 'At the anvil', needs_you: 'Needs you', resting: 'Resting', away: 'Away' }[state];
  return (
    <li className={`ts-card library-desk desk-${state}`} data-testid={`desk-${name}`} data-state={state}>
      <h3 className={`ts-ribbon ${state === 'needs_you' ? 'ts-ribbon-red' : 'ts-ribbon-yellow'}`}>{name}</h3>
      <p>
        <span className={`desk-state state-${state}`}>{label}</span>
      </p>
      <p className="muted small">
        Forges equipment for a Knight&apos;s project: a skill or a slash command, from what the project
        already does. Reads the project; writes nothing.
      </p>
      {hero ? (
        <p className="small" data-testid={`desk-${name}-doing`}>
          {state === 'working'
            ? `${doing ?? 'Starting'}…`
            : state === 'needs_you'
              ? 'Waiting for your answer.'
              : `Finished ${ago(now - hero.lastActiveAt)}${doing ? `; last: ${doing.toLowerCase()}` : ''}.`}
        </p>
      ) : (
        <p className="small muted">Not at the Forge now. Comes in when there is an order.</p>
      )}
      {hero && onTalk && (
        <button
          type="button"
          className="ts-button"
          onClick={() => onTalk(hero.id)}
          data-testid={`desk-${name}-talk`}
        >
          Open chat
        </button>
      )}
    </li>
  );
}

/** Commission a piece for a project yourself. Knights and the King can ask too. */
function Commission({ api, onDone }: { api: Api; onDone: () => void }) {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState('');
  const [kind, setKind] = useState<PieceKind>('skill');
  const [need, setNeed] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.control().then(
      (c) => {
        setProjects(c.projects);
        setProject((p) => p || c.projects[0] || '');
      },
      () => {},
    );
  }, [api]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.commission({ project, kind, need });
      setNeed('');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not commission it.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="ts-card forge-commission"
      data-testid="forge-commission"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3 className="ts-ribbon ts-ribbon-yellow">Commission a piece</h3>
      <p className="muted small">
        Knights ask the Forge themselves when they keep needing something; you can too. Each run uses your
        Claude usage.
      </p>
      <label>
        For the project in{' '}
        <input
          list="forge-projects"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          placeholder="/home/you/project"
          data-testid="commission-project"
        />
        <datalist id="forge-projects">
          {projects.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label>
        Forge a{' '}
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as PieceKind)}
          data-testid="commission-kind"
        >
          <option value="skill">{KIND_LABEL.skill}</option>
          <option value="command">{KIND_LABEL.command}</option>
        </select>
      </label>
      <label className="forge-need">
        that…
        <textarea
          value={need}
          onChange={(e) => setNeed(e.target.value)}
          rows={2}
          placeholder="writes release notes the way this project does"
          data-testid="commission-need"
        />
      </label>
      <button
        type="submit"
        className="ts-button"
        disabled={busy || !project || need.trim().length < 10}
        data-testid="commission-submit"
      >
        {busy ? 'Commissioning…' : 'Commission'}
      </button>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function Orders({
  api,
  status,
  error,
  now,
  onChanged,
}: {
  api: Api;
  status: ForgeStatus | null;
  error: string | null;
  now: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  if (!status) return <p className="muted">{error ?? 'Opening the Forge…'}</p>;
  const act = async (id: string, what: string, call: () => Promise<unknown>) => {
    setBusy(id);
    setActError(null);
    try {
      await call();
      onChanged();
    } catch (err) {
      setActError(err instanceof ApiError ? err.message : `Could not ${what}.`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="forge-orders" id="forge-orders" data-testid="forge-orders">
      <h3 className="ts-ribbon ts-ribbon-red">The rack and the anvil ({status.orders.length})</h3>
      {actError && (
        <p className="error small" role="alert">
          {actError}
        </p>
      )}
      {status.orders.length === 0 && <p className="muted small">No orders yet.</p>}
      {status.orders.map((o) => (
        <article
          key={o.id}
          id={o.status === 'forging' ? 'forge-anvil' : `order-${o.id}`}
          className={`ts-card forge-order order-${o.status}`}
          data-testid={`order-${o.piece?.name ?? o.id}`}
          data-status={o.status}
        >
          <header className="forge-order-head">
            <strong>
              {o.piece?.name ??
                o.existing?.name ??
                (o.status === 'failed' ? 'Nothing forged' : 'Not forged yet')}
            </strong>
            <span className={`order-status status-${o.status}`}>{STATUS_LABEL[o.status]}</span>
          </header>
          <p className="muted small">
            {KIND_LABEL[o.kind]} for <strong>{folderName(o.project)}</strong>, asked by {o.requestedBy}{' '}
            {ago(now - o.createdAt)}
          </p>
          <p className="small">“{o.need}”</p>
          {o.piece?.description && <p className="small">{o.piece.description}</p>}
          {o.review && (
            <div className={`forge-review verdict-${o.review.verdict}`}>
              <strong>The Library: {VERDICT_LABEL[o.review.verdict]}.</strong> {o.review.reason}
              {o.review.risks.length > 0 && (
                <ul className="risks small">
                  {o.review.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {o.error && <p className="error small">{o.error}</p>}
          {o.existing && (
            <p className="small" data-testid={`existing-${o.id}`}>
              <strong>Already in the Library:</strong> {o.existing.name} ({o.existing.where}).{' '}
              {o.existing.reason}{' '}
              {o.existing.where === 'archive'
                ? 'It waits for you under Needs you: install that instead.'
                : 'Nothing was forged.'}
            </p>
          )}
          {o.piece && (
            <details className="forge-files">
              <summary>
                {o.piece.files.length} {o.piece.files.length === 1 ? 'file' : 'files'}
              </summary>
              {o.piece.files.map((f) => (
                <div key={f.path}>
                  <code className="small">{f.path}</code>
                  <pre>{f.content}</pre>
                </div>
              ))}
            </details>
          )}
          {o.status === 'installed' && (
            <p className="small" data-testid={`installed-${o.id}`}>
              Installed at <code>{destination(o)}</code>
            </p>
          )}
          <div className="skill-actions">
            {o.status === 'reviewed' && (
              <button
                type="button"
                className="ts-button"
                disabled={busy !== null}
                onClick={() => {
                  if (
                    o.review?.verdict !== 'ready' &&
                    !window.confirm(
                      `The Library marked ${o.piece?.name} "${o.review?.verdict}". Install it anyway?`,
                    )
                  )
                    return;
                  void act(o.id, 'install', () => api.installPiece(o.id));
                }}
                data-testid={`install-order-${o.id}`}
              >
                {busy === o.id ? 'Installing…' : 'Approve & install'}
              </button>
            )}
            {(o.status === 'reviewed' || o.status === 'failed' || o.status === 'dismissed') && (
              <button
                type="button"
                className="link"
                disabled={busy !== null}
                onClick={() => void act(o.id, 'forge again', () => api.reforge(o.id))}
                data-testid={`reforge-order-${o.id}`}
              >
                Forge again
              </button>
            )}
            {o.status === 'reviewed' && (
              <button
                type="button"
                className="link"
                disabled={busy !== null}
                onClick={() => void act(o.id, 'dismiss', () => api.dismissPiece(o.id))}
                data-testid={`dismiss-order-${o.id}`}
              >
                Dismiss
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
