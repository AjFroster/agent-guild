import {
  type GuildState,
  type Hero,
  type LibrarianState,
  librarianDoing,
  librarianState,
  librariansIn,
  roster,
} from '@agent-guild/core';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { type Api, ApiError, type SkillsStatus } from './api.ts';
import {
  type ArchiveView,
  type ScenePick,
  describeScene,
  drawLibraryScene,
  libraryModel,
  libraryPick,
  samePick,
} from './libraryScene.ts';
import { ago } from './panels.tsx';
import { SceneCanvas } from './SceneCanvas.tsx';

/**
 * The Library page, reached by clicking the Library on the map. On top, the Library's
 * grounds as a Tiny Swords scene (libraryScene.ts): the librarians at their stations, the
 * Archive board, gold for installed skills. Below it, parchment cards: each librarian
 * (what it is doing, or that it is away), their orders and star threshold, the Archive's
 * counts and the librarians' notes. The Skills tab is where the user decides on skills and
 * changes the settings; this page is about the librarians.
 */

const ABOUT: Record<string, string> = {
  Scout: 'Searches GitHub for new, well-starred skills and files each, pinned to a commit, in the Archive.',
  Reviewer: 'Reads every file of each new skill at that commit and compares it with yours.',
};

const STATE_LABEL: Record<LibrarianState | 'away', string> = {
  working: 'At work',
  needs_you: 'Needs you',
  resting: 'Resting',
  away: 'Away',
};

export interface LibraryControl {
  api: Api;
  /** Ticks when the Archive changes. */
  version: number;
  onTalk: (id: string) => void;
  onOpenSkills: () => void;
}

/** What the scene needs from the Archive. */
function archiveView(status: SkillsStatus): ArchiveView {
  return {
    waiting: status.entries
      .filter((e) => e.status === 'reviewed')
      .map((e) => ({ id: e.id, name: e.name, verdict: e.review?.verdict ?? null })),
    installed: status.entries.filter((e) => e.status === 'installed').length,
  };
}

export function LibraryPage({
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
  control?: LibraryControl | undefined;
  onBack: () => void;
  /** Back to the village with that hero's panel open. */
  onSelectHero: (id: string) => void;
}) {
  const [status, setStatus] = useState<SkillsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = control?.api;
  const load = useCallback(() => {
    api?.skills().then(
      (s) => {
        setStatus(s);
        setError(null);
      },
      () => setError('Could not load the Archive.'),
    );
  }, [api]);
  useEffect(load, [load, control?.version]);

  const model = useMemo(() => libraryModel(state, status ? archiveView(status) : null), [state, status]);
  const present = librariansIn(state);
  // The Scout and the Reviewer have desks; any other librarian gets one of its own.
  const desks: { name: string; hero: Hero | undefined }[] = [
    ...model.seats.map((s) => ({ name: s.role as string, hero: s.hero })),
    ...present
      .filter((h) => !model.seats.some((s) => s.hero?.id === h.id))
      .map((h) => ({ name: h.name, hero: h })),
  ];
  // Knights reading files (Read, Grep, Glob) stand at the Library's door.
  const readers = roster(state).filter(
    (h) => !h.librarian && h.location === 'library' && h.status !== 'idle',
  );

  const onPick = (p: ScenePick) => {
    if (p.kind === 'librarian') {
      if (control) control.onTalk(p.id);
      else onSelectHero(p.id);
    } else control?.onOpenSkills();
  };

  return (
    <section className="library-page" data-testid="library-page" aria-label="The Library">
      <div className="library-head">
        <button type="button" className="ts-button" onClick={onBack} data-testid="library-back">
          ← Back to the village
        </button>
        <h2 className="ts-ribbon ts-ribbon-yellow">The Library</h2>
      </div>
      <SceneCanvas
        model={model}
        animate={animate}
        draw={drawLibraryScene}
        pick={libraryPick}
        same={samePick}
        onPick={onPick}
        label={describeScene(model)}
        testId="library-scene"
      />
      <p className="muted small library-hint">
        Click a librarian to {control ? 'open its chat' : 'see its session'}
        {control ? ', or the Archive board to review skills.' : '.'}
      </p>
      <ul className="plain library-desks" aria-label="Librarians">
        {desks.map((d) => (
          <Desk key={d.hero?.id ?? d.name} {...d} now={now} onTalk={control?.onTalk} />
        ))}
      </ul>
      {control && <LibraryCards control={control} status={status} error={error} now={now} onChanged={load} />}
      <div className="ts-card" data-testid="library-readers">
        <h3 className="ts-ribbon ts-ribbon-blue">Reading at the door</h3>
        <p className="muted small">
          Heroes reading files (Read, Grep, Glob, LS) stand at the Library&apos;s door.
        </p>
        {readers.length === 0 ? (
          <p className="muted small" data-testid="nobody-reading">
            Nobody.
          </p>
        ) : (
          <ul className="plain">
            {readers.map((h) => (
              <li key={h.id}>
                <button type="button" className="link" onClick={() => onSelectHero(h.id)}>
                  {h.name}
                </button>{' '}
                <span className="muted small">Lv {h.level}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Desk({
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
  const doing = hero ? librarianDoing(hero) : null;
  return (
    <li className={`ts-card library-desk desk-${state}`} data-testid={`desk-${name}`} data-state={state}>
      <h3 className={`ts-ribbon ${state === 'needs_you' ? 'ts-ribbon-red' : 'ts-ribbon-yellow'}`}>{name}</h3>
      <p>
        <span className={`desk-state state-${state}`}>{STATE_LABEL[state]}</span>
      </p>
      <p className="muted small">{ABOUT[name] ?? 'A librarian.'}</p>
      {hero ? (
        <p className="small" data-testid={`desk-${name}-doing`}>
          {state === 'working'
            ? `${doing ?? 'Starting'}…`
            : state === 'needs_you'
              ? 'Waiting for your answer.'
              : `Finished ${ago(now - hero.lastActiveAt)}${doing ? `; last: ${doing.toLowerCase()}` : ''}.`}
        </p>
      ) : (
        <p className="small muted">Not in the Library now. They come in when the librarians run.</p>
      )}
      {hero && onTalk && (
        <button
          type="button"
          className={state === 'needs_you' ? 'ts-button ts-button-red' : 'ts-button'}
          onClick={() => onTalk(hero.id)}
          data-testid={`desk-${name}-talk`}
        >
          {state === 'needs_you' ? 'Answer' : 'Open chat'}
        </button>
      )}
    </li>
  );
}

/** The live half of the page: the orders, what waits for the user, and the notes. */
function LibraryCards({
  control,
  status,
  error,
  now,
  onChanged,
}: {
  control: LibraryControl;
  status: SkillsStatus | null;
  error: string | null;
  now: number;
  onChanged: () => void;
}) {
  const [runError, setRunError] = useState<string | null>(null);
  if (!status) return <p className="muted">{error ?? 'Opening the Archive…'}</p>;
  const { api } = control;
  const count = (s: string) => status.entries.filter((e) => e.status === s).length;
  const library = status.library;
  return (
    <div className="library-cards">
      <div className="ts-card" data-testid="library-schedule">
        <h3 className="ts-ribbon ts-ribbon-blue">Their orders</h3>
        {library ? (
          <>
            <p className="small">
              {library.running
                ? 'At work now.'
                : library.config.enabled
                  ? `Daily at ${library.config.time}.`
                  : 'Paused: they only work when you press Run now.'}{' '}
              Only skills from repositories with at least{' '}
              <strong data-testid="library-min-stars">★ {library.config.minStars.toLocaleString()}</strong>,
              up to {library.config.maxCandidates} a day.
            </p>
            <div className="skill-actions">
              <button
                type="button"
                className="ts-button"
                disabled={library.running}
                onClick={() =>
                  void api
                    .runLibrary()
                    .then(onChanged, (err: unknown) =>
                      setRunError(err instanceof ApiError ? err.message : 'Could not start the librarians.'),
                    )
                }
                data-testid="library-run"
              >
                Run now
              </button>
              <button type="button" className="link" onClick={control.onOpenSkills}>
                Change in the Skills tab
              </button>
            </div>
          </>
        ) : (
          <p className="muted small">The librarians are off while chats are off.</p>
        )}
        {(runError ?? error) && (
          <p className="error small" role="alert">
            {runError ?? error}
          </p>
        )}
      </div>
      <div className="ts-card" data-testid="library-archive">
        <h3 className="ts-ribbon ts-ribbon-red">The Archive</h3>
        <p className="library-waiting">
          <strong>{status.waiting}</strong> {status.waiting === 1 ? 'skill waits' : 'skills wait'} for you
        </p>
        <p className="muted small">
          {count('candidate')} waiting for the Reviewer · {count('installed')} installed ·{' '}
          {count('dismissed')} dismissed
        </p>
        <button
          type="button"
          className={status.waiting > 0 ? 'ts-button ts-button-red' : 'ts-button'}
          onClick={control.onOpenSkills}
          data-testid="library-review"
        >
          {status.waiting > 0 ? 'Review them' : 'Open the Skills tab'}
        </button>
      </div>
      <div className="ts-card library-notes">
        <h3 className="ts-ribbon ts-ribbon-blue">Their notes</h3>
        {status.notes.length === 0 ? (
          <p className="muted small">No notes yet.</p>
        ) : (
          <ul className="plain small notes">
            {status.notes.slice(0, 6).map((n) => (
              <li key={`${n.at}-${n.by}`}>
                <strong>{n.by}</strong> <span className="muted">· {ago(now - n.at)}</span>
                <div>{n.text}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
