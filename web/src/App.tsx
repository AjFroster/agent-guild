import { type GuildState, type Hero, XP_PER_LEVEL, depthOf, replay, roster } from '@agent-guild/core';
import { useEffect, useMemo, useRef, useState } from 'react';

import { fixtures, readDemoRequest } from './demo.ts';
import { type LiveStatus, useLiveEvents } from './live.ts';
import {
  BUILDINGS,
  type Sprites,
  VILLAGE_HEIGHT,
  VILLAGE_WIDTH,
  type Walker,
  drawVillage,
  heroPositions,
  loadSprites,
  walkerPosition,
} from './village.ts';

const STATUS_LABEL: Record<Hero['status'], string> = {
  working: 'Working',
  idle: 'Resting',
  needs_you: 'Needs you',
  gone: 'Left',
};

export function App() {
  const demo = useMemo(() => readDemoRequest(window.location.search), []);

  if (demo === null) {
    const token = new URLSearchParams(window.location.search).get('token');
    return token ? <Live token={token} /> : <Landing />;
  }
  if ('error' in demo) {
    return (
      <main className="page">
        <h1>Agent Guild</h1>
        <p role="alert">{demo.error}</p>
        <DemoLinks />
      </main>
    );
  }
  return <Guild state={replay(demo.events, demo.t)} />;
}

function Landing() {
  return (
    <main className="page">
      <h1>Agent Guild</h1>
      <p>
        To watch your own Claude Code sessions, run <code>npm start</code> in the agent-guild folder and open
        the link it prints. The link carries a token that only your machine knows.
      </p>
      <p className="muted">Or try a recorded guild:</p>
      <DemoLinks />
    </main>
  );
}

function DemoLinks() {
  return (
    <ul className="demo-links">
      {Object.keys(fixtures)
        .sort()
        .map((name) => (
          <li key={name}>
            <a href={`?demo=${name}`}>{name}</a>
          </li>
        ))}
    </ul>
  );
}

const LIVE_LABEL: Record<LiveStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  unauthorized: 'Token rejected',
};

function Live({ token }: { token: string }) {
  const { events, status } = useLiveEvents(token);
  const state = useMemo(() => replay(events), [events]);
  if (status === 'unauthorized') {
    return (
      <main className="page">
        <h1>Agent Guild</h1>
        <p role="alert">
          The server did not accept this link's token. It changes every time <code>npm start</code> runs, so
          open the newest link it printed.
        </p>
      </main>
    );
  }
  return <Guild state={state} live={LIVE_LABEL[status]} />;
}

function Guild({ state, live }: { state: GuildState; live?: string }) {
  const heroes = roster(state);
  const waiting = heroes.filter((h) => h.status === 'needs_you');

  return (
    <main className="guild" data-testid="guild">
      <header className="topbar">
        <h1>Agent Guild</h1>
        {live && (
          <span className="live" data-testid="live-status">
            {live}
          </span>
        )}
        {waiting.length > 0 && (
          <p className="beacon" role="status" data-testid="beacon">
            {waiting.map((h) => h.name).join(', ')} {waiting.length === 1 ? 'needs' : 'need'} you
          </p>
        )}
      </header>
      <Village state={state} heroes={heroes} animate={live !== undefined} />
      <aside className="panel" aria-label="Party and quests">
        {heroes.length === 0 ? (
          <p className="muted" data-testid="empty-guild">
            The guild is quiet. Start a Claude Code session and a hero will walk in.
          </p>
        ) : (
          <ol className="roster">
            {heroes.map((hero) => (
              <HeroCard key={hero.id} hero={hero} depth={depthOf(state, hero)} />
            ))}
          </ol>
        )}
      </aside>
    </main>
  );
}

/** Loaded once per page; every Village shares the same images. */
let spritesPromise: Promise<Sprites> | null = null;
const getSprites = () => (spritesPromise ??= loadSprites());

function Village({ state, heroes, animate }: { state: GuildState; heroes: Hero[]; animate: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sprites, setSprites] = useState<Sprites | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  /** Heroes walking to a new building, keyed by hero id (live mode only). */
  const walkers = useRef(new Map<string, Walker>());
  /** Where each hero was last drawn, so a walk starts from there. */
  const shown = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    let cancelled = false;
    getSprites().then(
      (s) => !cancelled && setSprites(s),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // When a hero's target moves, start a walk from wherever it is drawn now.
  useEffect(() => {
    if (!animate) return;
    const now = performance.now();
    for (const [id, to] of heroPositions(state)) {
      const from = shown.current.get(id);
      const current = walkers.current.get(id);
      if (!from) {
        shown.current.set(id, to);
        continue;
      }
      if (current && current.toX === to.x && current.toY === to.y) continue;
      if (!current && from.x === to.x && from.y === to.y) continue;
      walkers.current.set(id, { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, startMs: now });
    }
  }, [state, animate]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || !sprites) return;
    const scale = window.devicePixelRatio || 1;
    el.width = VILLAGE_WIDTH * scale;
    el.height = VILLAGE_HEIGHT * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    if (!animate) {
      // Demo mode: one frozen frame, the same on every run.
      drawVillage(ctx, stateRef.current, sprites, 0, new Map());
      el.dataset.ready = 'true';
      return;
    }

    let frame = 0;
    const tick = (now: number) => {
      for (const [id, w] of walkers.current) {
        const pos = walkerPosition(w, now);
        shown.current.set(id, { x: pos.x, y: pos.y });
        if (!pos.moving) walkers.current.delete(id);
      }
      drawVillage(ctx, stateRef.current, sprites, now, walkers.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    el.dataset.ready = 'true';
    return () => cancelAnimationFrame(frame);
  }, [sprites, animate]);

  // The canvas is decoration for sighted users; this sentence carries the same facts.
  const summary =
    heroes.length === 0
      ? 'The village is empty.'
      : heroes.map((h) => `${h.name} at the ${BUILDINGS[h.location].label}`).join('; ') + '.';

  if (error) return <p role="alert">The village art did not load: {error}</p>;

  return (
    <canvas
      ref={canvas}
      className="village"
      width={VILLAGE_WIDTH}
      height={VILLAGE_HEIGHT}
      style={{ width: VILLAGE_WIDTH, height: VILLAGE_HEIGHT }}
      role="img"
      aria-label={summary}
      data-testid="village"
    />
  );
}

function HeroCard({ hero, depth }: { hero: Hero; depth: number }) {
  const intoLevel = hero.xp % XP_PER_LEVEL;
  const done = hero.quests.filter((q) => q.status === 'completed').length;

  return (
    <li className="hero" style={{ marginLeft: depth * 20 }} data-testid={`hero-${hero.id}`}>
      <div className="hero-head">
        <strong>{hero.name}</strong>
        <span className="level">Lv {hero.level}</span>
        <span className={`status status-${hero.status}`}>{STATUS_LABEL[hero.status]}</span>
      </div>
      <div
        className="xp"
        role="progressbar"
        aria-label={`${hero.name} XP toward next level`}
        aria-valuemin={0}
        aria-valuemax={XP_PER_LEVEL}
        aria-valuenow={intoLevel}
      >
        <div className="xp-fill" style={{ width: `${(intoLevel / XP_PER_LEVEL) * 100}%` }} />
      </div>
      {hero.quests.length > 0 && (
        <>
          <p className="muted small">
            Quests {done}/{hero.quests.length}
          </p>
          <ul className="quests">
            {hero.quests.map((q) => (
              <li key={q.id} className={`quest quest-${q.status}`}>
                {q.title}
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}
