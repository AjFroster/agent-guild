import {
  type Activity,
  type GuildState,
  type Hero,
  LOCATIONS,
  type Location,
  XP_PER_LEVEL,
  depthOf,
  roster,
  toolsFor,
} from '@agent-guild/core';

import { BUILDINGS, type Selection } from './village.ts';

/** Side panels: the guild overview, one hero, or one building. */

export const STATUS_LABEL: Record<Hero['status'], string> = {
  working: 'Working',
  idle: 'Resting',
  needs_you: 'Needs you',
  gone: 'Left',
};

const DOING: Record<Location, string> = {
  library: 'Reading code at the Library',
  forge: 'Editing files at the Forge',
  arena: 'Running commands in the Arena',
  tower: 'Searching the web from the Tower',
  guildhall: 'At the Guildhall',
};

const ABOUT: Record<Location, string> = {
  library: 'Heroes come here to read: opening files and searching the code.',
  forge: 'Heroes come here to make things: editing and writing files.',
  arena: 'Heroes come here to run commands in the shell: builds, tests, git.',
  tower: 'Heroes climb the tower to look things up on the web.',
  guildhall: 'Home base. Heroes rest here between turns and use their other tools here.',
};

/** "just now", "42s ago", "5 min ago", "3 h ago". */
export function ago(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

type Select = (s: Selection | null) => void;

function HeroButton({ hero, onSelect }: { hero: Hero; onSelect: Select }) {
  return (
    <button type="button" className="link" onClick={() => onSelect({ kind: 'hero', id: hero.id })}>
      {hero.name}
    </button>
  );
}

function XpBar({ hero }: { hero: Hero }) {
  const into = hero.xp % XP_PER_LEVEL;
  return (
    <div
      className="xp"
      role="progressbar"
      aria-label={`${hero.name} XP toward next level`}
      aria-valuemin={0}
      aria-valuemax={XP_PER_LEVEL}
      aria-valuenow={into}
    >
      <div className="xp-fill" style={{ width: `${(into / XP_PER_LEVEL) * 100}%` }} />
    </div>
  );
}

function Quests({ hero }: { hero: Hero }) {
  if (hero.quests.length === 0) return null;
  const done = hero.quests.filter((q) => q.status === 'completed').length;
  return (
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
  );
}

// ---------------------------------------------------------------------------- guild

export function GuildPanel({ state, onSelect }: { state: GuildState; onSelect: Select }) {
  const heroes = roster(state);
  return (
    <>
      {heroes.length === 0 ? (
        <p className="muted" data-testid="empty-guild">
          The guild is quiet. Start a Claude Code session and a hero will walk in.
        </p>
      ) : (
        <ol className="roster">
          {heroes.map((hero) => (
            <li
              key={hero.id}
              className="hero"
              style={{ marginLeft: depthOf(state, hero) * 20 }}
              data-testid={`hero-${hero.id}`}
            >
              <button
                type="button"
                className="hero-open"
                onClick={() => onSelect({ kind: 'hero', id: hero.id })}
                aria-label={`Open ${hero.name}`}
              >
                <span className="hero-head">
                  <strong>{hero.name}</strong>
                  <span className="level">Lv {hero.level}</span>
                  <span className={`status status-${hero.status}`}>{STATUS_LABEL[hero.status]}</span>
                </span>
              </button>
              <XpBar hero={hero} />
              <Quests hero={hero} />
            </li>
          ))}
        </ol>
      )}
      <h2 className="section">Buildings</h2>
      <ul className="buildings">
        {LOCATIONS.map((loc) => {
          const here = heroes.filter((h) => h.location === loc).length;
          return (
            <li key={loc}>
              <button
                type="button"
                className="chip"
                onClick={() => onSelect({ kind: 'building', id: loc })}
                data-testid={`open-${loc}`}
              >
                {BUILDINGS[loc].label}
                {here > 0 && <span className="count">{here}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted small hint">Click a hero or a building on the map for details.</p>
    </>
  );
}

// ---------------------------------------------------------------------------- hero

export function HeroPanel({
  state,
  hero,
  now,
  onSelect,
}: {
  state: GuildState;
  hero: Hero;
  now: number;
  onSelect: Select;
}) {
  const leader = hero.parentId ? state.heroes[hero.parentId] : undefined;
  const party = roster(state).filter((h) => h.parentId === hero.id);
  const calls = LOCATIONS.reduce((n, l) => n + hero.visits[l], 0);
  const most = Math.max(1, ...LOCATIONS.map((l) => hero.visits[l]));

  return (
    <section data-testid="panel-hero" aria-label={`${hero.name} details`}>
      <BackButton onSelect={onSelect} />
      <header className="detail-head">
        <h2>{hero.name}</h2>
        <span className="level">Lv {hero.level}</span>
        <span className={`status status-${hero.status}`}>{STATUS_LABEL[hero.status]}</span>
      </header>
      <p className="doing">
        {hero.status === 'needs_you' ? 'Waiting for your answer' : DOING[hero.location]}
      </p>
      <XpBar hero={hero} />
      <p className="muted small">
        {hero.xp % XP_PER_LEVEL} / {XP_PER_LEVEL} XP to level {hero.level + 1}
      </p>

      <dl className="facts">
        {leader && (
          <>
            <dt>Party of</dt>
            <dd>
              <HeroButton hero={leader} onSelect={onSelect} />
            </dd>
          </>
        )}
        {hero.branch && (
          <>
            <dt>Branch</dt>
            <dd>
              <code>{hero.branch}</code>
            </dd>
          </>
        )}
        {hero.model && (
          <>
            <dt>Model</dt>
            <dd>{hero.model}</dd>
          </>
        )}
        <dt>Arrived</dt>
        <dd>{ago(now - hero.startedAt)}</dd>
        <dt>Last active</dt>
        <dd>{ago(now - hero.lastActiveAt)}</dd>
        <dt>Turns</dt>
        <dd>{hero.turns}</dd>
        <dt>Tool calls</dt>
        <dd>{calls}</dd>
      </dl>

      {party.length > 0 && (
        <>
          <h3>Party</h3>
          <ul className="plain">
            {party.map((m) => (
              <li key={m.id}>
                <HeroButton hero={m} onSelect={onSelect} />{' '}
                <span className="muted small">{STATUS_LABEL[m.status]}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <Quests hero={hero} />

      {calls > 0 && (
        <>
          <h3>Where the time went</h3>
          <ul className="bars">
            {LOCATIONS.filter((l) => hero.visits[l] > 0).map((l) => (
              <li key={l}>
                <button type="button" className="link" onClick={() => onSelect({ kind: 'building', id: l })}>
                  {BUILDINGS[l].label}
                </button>
                <span className="bar">
                  <span style={{ width: `${(hero.visits[l] / most) * 100}%` }} />
                </span>
                <span className="muted small">{hero.visits[l]}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <ActivityList
        title="Recent activity"
        items={hero.recent.map((a) => ({ a, hero }))}
        now={now}
        onSelect={onSelect}
        showHero={false}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------- building

export function BuildingPanel({
  state,
  location,
  now,
  onSelect,
}: {
  state: GuildState;
  location: Location;
  now: number;
  onSelect: Select;
}) {
  const heroes = roster(state);
  const here = heroes.filter((h) => h.location === location);
  const visits = heroes.reduce((n, h) => n + h.visits[location], 0);
  const tools = toolsFor(location);
  const recent = heroes
    .flatMap((hero) => hero.recent.filter((a) => a.location === location).map((a) => ({ a, hero })))
    .sort((x, y) => y.a.t - x.a.t)
    .slice(0, 12);

  return (
    <section data-testid="panel-building" aria-label={`${BUILDINGS[location].label} details`}>
      <BackButton onSelect={onSelect} />
      <header className="detail-head">
        <h2>{BUILDINGS[location].label}</h2>
      </header>
      <p className="doing">{ABOUT[location]}</p>
      {tools.length > 0 && <p className="muted small">Tools: {tools.join(', ')}</p>}

      <h3>Here now</h3>
      {here.length === 0 ? (
        <p className="muted small" data-testid="nobody-here">
          Nobody.
        </p>
      ) : (
        <ul className="plain">
          {here.map((h) => (
            <li key={h.id}>
              <HeroButton hero={h} onSelect={onSelect} />{' '}
              <span className="muted small">
                Lv {h.level} · {STATUS_LABEL[h.status]}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="muted small">
        {visits} {visits === 1 ? 'visit' : 'visits'} from heroes in the guild.
      </p>

      <ActivityList title="Recent activity here" items={recent} now={now} onSelect={onSelect} showHero />
    </section>
  );
}

// ---------------------------------------------------------------------------- shared

function BackButton({ onSelect }: { onSelect: Select }) {
  return (
    <button type="button" className="back" onClick={() => onSelect(null)} data-testid="back">
      ← Guild
    </button>
  );
}

function ActivityList({
  title,
  items,
  now,
  onSelect,
  showHero,
}: {
  title: string;
  items: { a: Activity; hero: Hero }[];
  now: number;
  onSelect: Select;
  showHero: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <h3>{title}</h3>
      <ol className="activity" data-testid="activity">
        {items.slice(0, 12).map(({ a, hero }, i) => (
          <li key={`${hero.id}-${a.t}-${i}`}>
            {showHero && (
              <>
                <HeroButton hero={hero} onSelect={onSelect} />{' '}
              </>
            )}
            <code>{a.tool}</code>
            {!showHero && <span className="muted small"> · {BUILDINGS[a.location].label}</span>}
            <span className="muted small when">{ago(now - a.t)}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
