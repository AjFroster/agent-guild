import { type GuildState, type Hero, XP_PER_LEVEL, depthOf, replay, roster } from '@agent-guild/core';
import { useEffect, useMemo, useRef } from 'react';

import { fixtures, readDemoRequest } from './demo.ts';
import { BUILDINGS, VILLAGE_HEIGHT, VILLAGE_WIDTH, drawVillage } from './village.ts';

const STATUS_LABEL: Record<Hero['status'], string> = {
  working: 'Working',
  idle: 'Resting',
  needs_you: 'Needs you',
  gone: 'Left',
};

export function App() {
  const demo = useMemo(() => readDemoRequest(window.location.search), []);

  if (demo === null) return <Landing />;
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
      <p className="muted">
        Live sessions arrive with the local server in the next milestone. Until then, try a recorded guild:
      </p>
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

function Guild({ state }: { state: GuildState }) {
  const heroes = roster(state);
  const waiting = heroes.filter((h) => h.status === 'needs_you');

  return (
    <main className="guild" data-testid="guild">
      <header className="topbar">
        <h1>Agent Guild</h1>
        {waiting.length > 0 && (
          <p className="beacon" role="status" data-testid="beacon">
            {waiting.map((h) => h.name).join(', ')} {waiting.length === 1 ? 'needs' : 'need'} you
          </p>
        )}
      </header>
      <Village state={state} heroes={heroes} />
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

function Village({ state, heroes }: { state: GuildState; heroes: Hero[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const scale = window.devicePixelRatio || 1;
    el.width = VILLAGE_WIDTH * scale;
    el.height = VILLAGE_HEIGHT * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawVillage(ctx, state);
  }, [state]);

  // The canvas is decoration for sighted users; this sentence carries the same facts.
  const summary =
    heroes.length === 0
      ? 'The village is empty.'
      : heroes.map((h) => `${h.name} at the ${BUILDINGS[h.location].label}`).join('; ') + '.';

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
