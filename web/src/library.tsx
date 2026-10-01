import {
  type GuildState,
  type Hero,
  type LibrarianState,
  librarianDoing,
  librarianState,
  librariansIn,
  roster,
} from '@agent-guild/core';
import { useCallback, useEffect, useState } from 'react';

import { type Api, ApiError, type SkillsStatus } from './api.ts';
import { ago } from './panels.tsx';

/**
 * The Library page, reached by clicking the Library on the map: the librarians at their
 * desks (what each is doing, or that it is away), today's schedule and star threshold, how
 * many skills wait for the user, and the librarians' latest notes. The Skills tab is where
 * the user decides on skills and changes the settings; this page is about the librarians.
 */

const ROLES = [
  {
    name: 'Scout',
    about: 'Searches GitHub for new, well-starred skills and files each, pinned to a commit, in the Archive.',
  },
  {
    name: 'Reviewer',
    about: 'Reads every file of each new skill at that commit and compares it with yours.',
  },
] as const;

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

export function LibraryPage({
  state,
  now,
  control,
  onBack,
  onSelectHero,
}: {
  state: GuildState;
  now: number;
  control?: LibraryControl | undefined;
  onBack: () => void;
  /** Back to the village with that hero's panel open. */
  onSelectHero: (id: string) => void;
}) {
  const present = librariansIn(state);
  // Knights reading files (Read, Grep, Glob) stand at the Library's door.
  const readers = roster(state).filter(
    (h) => !h.librarian && h.location === 'library' && h.status !== 'idle',
  );
  // The newest librarian of each role takes its desk; anyone else gets a desk of their own.
  const seats: { name: string; about: string; hero: Hero | undefined }[] = ROLES.map((r) => ({
    ...r,
    hero: present.filter((h) => h.name === r.name).at(-1),
  }));
  for (const hero of present) {
    if (!seats.some((s) => s.hero?.id === hero.id))
      seats.push({ name: hero.name, about: 'A librarian.', hero });
  }

  return (
    <section className="library-page" data-testid="library-page" aria-label="The Library">
      <div className="library-head">
        <button type="button" className="chip" onClick={onBack} data-testid="library-back">
          ← Back to the village
        </button>
        <div>
          <h2>The Library</h2>
          <p className="muted small">
            The librarians keep the Archive: skills found on GitHub, reviewed, and waiting for your decision.
          </p>
        </div>
      </div>
      <ul className="plain library-desks" aria-label="Librarians">
        {seats.map((seat) => (
          <Desk key={seat.hero?.id ?? seat.name} {...seat} now={now} onTalk={control?.onTalk} />
        ))}
      </ul>
      {control && <LibraryDesk control={control} now={now} />}
      <div className="library-card" data-testid="library-readers">
        <h3>Reading at the Library</h3>
        <p className="muted small">Heroes reading files (Read, Grep, Glob, LS) stand at its door.</p>
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
  about,
  hero,
  now,
  onTalk,
}: {
  name: string;
  about: string;
  hero: Hero | undefined;
  now: number;
  onTalk?: ((id: string) => void) | undefined;
}) {
  const state = hero ? librarianState(hero) : 'away';
  const doing = hero ? librarianDoing(hero) : null;
  return (
    <li className={`library-desk desk-${state}`} data-testid={`desk-${name}`} data-state={state}>
      <div className="desk-portrait" aria-hidden="true">
        <span className={`librarian-sprite${state === 'working' ? ' sprite-working' : ''}`} />
        {state !== 'away' && <StateIcon state={state} />}
      </div>
      <div className="desk-body">
        <h3>
          {name} <span className={`desk-state state-${state}`}>{STATE_LABEL[state]}</span>
        </h3>
        <p className="muted small">{about}</p>
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
            className={state === 'needs_you' ? 'send' : 'chip'}
            onClick={() => onTalk(hero.id)}
            data-testid={`desk-${name}-talk`}
          >
            {state === 'needs_you' ? 'Answer' : 'Open chat'}
          </button>
        )}
      </div>
    </li>
  );
}

/** The same icons the Library shows on the map: a book, "zzz", or a red "!". */
function StateIcon({ state }: { state: LibrarianState }) {
  if (state === 'needs_you') return <span className="desk-icon icon-alert">!</span>;
  if (state === 'resting') return <span className="desk-icon icon-sleep">zzz</span>;
  return (
    <span className="desk-icon icon-work">
      <svg viewBox="0 0 28 18" width="24" height="16">
        <path d="M14 16 L1 13 L1 2 L14 5 Z" fill="#f4ecd2" stroke="#3a2410" strokeWidth="1.5" />
        <path d="M14 16 L27 13 L27 2 L14 5 Z" fill="#f4ecd2" stroke="#3a2410" strokeWidth="1.5" />
        <rect x="12.5" y="4" width="3" height="12" fill="#7b3fa0" />
      </svg>
    </span>
  );
}

/** The live half of the page: the schedule, what waits for the user, and the notes. */
function LibraryDesk({ control, now }: { control: LibraryControl; now: number }) {
  const { api, version } = control;
  const [status, setStatus] = useState<SkillsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  if (!status) return <p className="muted">{error ?? 'Opening the Archive…'}</p>;

  const count = (s: string) => status.entries.filter((e) => e.status === s).length;
  const library = status.library;
  return (
    <div className="library-cards">
      <div className="library-card" data-testid="library-schedule">
        <h3>Their orders</h3>
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
                className="send"
                disabled={library.running}
                onClick={() =>
                  void api
                    .runLibrary()
                    .then(load, (err: unknown) =>
                      setError(err instanceof ApiError ? err.message : 'Could not start the librarians.'),
                    )
                }
                data-testid="library-run"
              >
                Run now
              </button>
              <button type="button" className="chip" onClick={control.onOpenSkills}>
                Change in the Skills tab
              </button>
            </div>
          </>
        ) : (
          <p className="muted small">The librarians are off while chats are off.</p>
        )}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="library-card" data-testid="library-archive">
        <h3>The Archive</h3>
        <p className="library-waiting">
          <strong>{status.waiting}</strong> {status.waiting === 1 ? 'skill waits' : 'skills wait'} for you
        </p>
        <p className="muted small">
          {count('candidate')} waiting for the Reviewer · {count('installed')} installed ·{' '}
          {count('dismissed')} dismissed
        </p>
        <button
          type="button"
          className={status.waiting > 0 ? 'send' : 'chip'}
          onClick={control.onOpenSkills}
          data-testid="library-review"
        >
          {status.waiting > 0 ? 'Review them' : 'Open the Skills tab'}
        </button>
      </div>
      <div className="library-card library-notes">
        <h3>Their notes</h3>
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
