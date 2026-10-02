import {
  type Activity,
  type GuildState,
  type Hero,
  LOCATIONS,
  type Location,
  XP_PER_LEVEL,
  currentQuest,
  depthOf,
  guildTokens,
  hasLooseEnds,
  looseEnds,
  partyTokens,
  rankOf,
  roster,
  toolsFor,
  tokensByUtility,
  totalTokens,
} from '@agent-guild/core';
import type { ReactNode } from 'react';

import { compact, duration, gitSummary } from './format.ts';
import { BUILDINGS, RANK_LABEL, type Selection, TEAM_CSS, heroTeams } from './village.ts';

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

/** What each rank means, for the hero panel. */
const RANK_ABOUT: Record<ReturnType<typeof rankOf>, string> = {
  king: 'Talks to you and commands the Knights. Does no work with its own hands.',
  knight: 'A Claude Code session: takes a task and leads a party to finish it.',
  footsoldier: 'A sub-agent that changes things: it has edited files or run commands.',
  worker: 'A sub-agent that so far only reads and searches, gathering what its leader needs.',
  librarian: 'Keeps the Archive: finds new skills on GitHub or reviews them for you. Installs nothing.',
  smith: 'Works at the Forge: forges equipment for a Knight or mends what is broken. Installs nothing.',
};

/** A dot in the hero's team colour, matching its unit on the map. */
function TeamDot({ state, hero }: { state: GuildState; hero: Hero }) {
  const team = heroTeams(state).get(hero.id);
  if (!team) return null;
  return (
    <span className="team-dot" style={{ background: TEAM_CSS[team] }} title={`${team} team`} aria-hidden />
  );
}

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

export function GuildPanel({
  state,
  onSelect,
  children,
}: {
  state: GuildState;
  onSelect: Select;
  /** Extra sections below the buildings, such as the Town Crier in live mode. */
  children?: ReactNode;
}) {
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
                  <TeamDot state={state} hero={hero} />
                  <strong>{hero.name}</strong>
                  {rankOf(hero) !== 'knight' && hero.name !== RANK_LABEL[rankOf(hero)] && (
                    <span className="rank">{RANK_LABEL[rankOf(hero)]}</span>
                  )}
                  <span className="level">Lv {hero.level}</span>
                  <span className={`status status-${hero.status}`}>{STATUS_LABEL[hero.status]}</span>
                </span>
                {hasLooseEnds(hero) && (
                  <span className="loose" data-testid={`loose-${hero.id}`}>
                    {gitSummary(hero.git!)}
                  </span>
                )}
              </button>
              <XpBar hero={hero} />
              <Quests hero={hero} />
            </li>
          ))}
        </ol>
      )}
      <GuildTotal state={state} />
      <LooseEnds state={state} onSelect={onSelect} />
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
      {children}
    </>
  );
}

/** Work only this machine has, including from sessions that have left the guild. */
function LooseEnds({ state, onSelect }: { state: GuildState; onSelect: Select }) {
  const heroes = looseEnds(state);
  if (heroes.length === 0) return null;
  return (
    <section className="loose-ends" data-testid="loose-ends" aria-label="Loose ends">
      <h2 className="section">Loose ends</h2>
      <p className="muted small">Work that is only on this machine. Push it before you walk away.</p>
      <ul className="plain">
        {heroes.map((h) => (
          <li key={h.id}>
            {h.status === 'gone' ? <strong>{h.name}</strong> : <HeroButton hero={h} onSelect={onSelect} />}
            {h.branch && (
              <>
                {' '}
                <code className="small">{h.branch}</code>
              </>
            )}
            <span className="loose-line small">
              {gitSummary(h.git!)}
              {h.status === 'gone' && ' · left the guild'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GuildTotal({ state }: { state: GuildState }) {
  const total = totalTokens(guildTokens(state));
  if (total === 0) return null;
  const by = tokensByUtility(state);
  const helpers = [
    by.library > 0 && `the Library ${compact(by.library)}`,
    by.forge > 0 && `the Forge ${compact(by.forge)}`,
  ].filter(Boolean);
  return (
    <p className="muted small" data-testid="guild-tokens">
      The guild has used {compact(total)} tokens
      {helpers.length > 0 ? `: the Knights ${compact(by.knights)}, ${helpers.join(', ')}.` : '.'}
    </p>
  );
}

// ---------------------------------------------------------------------------- hero

export function HeroPanel({
  state,
  hero,
  now,
  onSelect,
  onOpenChat,
}: {
  state: GuildState;
  hero: Hero;
  now: number;
  onSelect: Select;
  /** Present when this session can be chatted with from the guild. */
  onOpenChat?: (() => void) | undefined;
}) {
  const leader = hero.parentId ? state.heroes[hero.parentId] : undefined;
  const party = roster(state).filter((h) => h.parentId === hero.id);
  const calls = LOCATIONS.reduce((n, l) => n + hero.visits[l], 0);
  const most = Math.max(1, ...LOCATIONS.map((l) => hero.visits[l]));

  return (
    <section data-testid="panel-hero" aria-label={`${hero.name} details`}>
      <BackButton onSelect={onSelect} />
      <header className="detail-head">
        <TeamDot state={state} hero={hero} />
        <h2>{hero.name}</h2>
        <span className="level">Lv {hero.level}</span>
        <span className={`status status-${hero.status}`}>{STATUS_LABEL[hero.status]}</span>
      </header>
      <p className="rank-line" data-testid="hero-rank">
        <strong>{RANK_LABEL[rankOf(hero)]}</strong> · {RANK_ABOUT[rankOf(hero)]}
      </p>
      {currentQuest(hero) && (
        <p className="working-on" data-testid="working-on">
          Working on: <strong>{currentQuest(hero)}</strong>
        </p>
      )}
      <p className="doing">
        {hero.status === 'needs_you' ? 'Waiting for your answer' : DOING[hero.location]}
      </p>
      {onOpenChat && (
        <button type="button" className="send open-chat" onClick={onOpenChat} data-testid="open-chat">
          Open chat
        </button>
      )}
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
        {hero.git && hero.parentId === null && (
          <>
            <dt>Git</dt>
            <dd className={hasLooseEnds(hero) ? 'loose-text' : undefined} data-testid="hero-git">
              {gitSummary(hero.git)}
            </dd>
          </>
        )}
        <dt>Arrived</dt>
        <dd>{ago(now - hero.startedAt)}</dd>
        <dt>Last active</dt>
        <dd>{ago(now - hero.lastActiveAt)}</dd>
      </dl>

      <ReportCard state={state} hero={hero} calls={calls} />

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

/** How the session went, in numbers: time, turns, tools, quests, tokens. */
function ReportCard({ state, hero, calls }: { state: GuildState; hero: Hero; calls: number }) {
  const own = hero.tokens;
  const tokens = totalTokens(own);
  const withParty = totalTokens(partyTokens(state, hero));
  const done = hero.quests.filter((q) => q.status === 'completed').length;
  const tiles: [string, string][] = [
    ['Time on task', duration(hero.lastActiveAt - hero.startedAt)],
    ['Turns', String(hero.turns)],
    ['Tool calls', String(calls)],
    ['Quests done', hero.quests.length ? `${done}/${hero.quests.length}` : '–'],
    ['Tokens', tokens ? compact(tokens) : '–'],
    ['Per turn', tokens && hero.turns ? compact(tokens / hero.turns) : '–'],
  ];
  return (
    <section className="report-card" data-testid="report-card" aria-label="Report card">
      <h3>Report card</h3>
      <dl className="tiles">
        {tiles.map(([label, value]) => (
          <div key={label} className="tile">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {tokens > 0 && (
        <p className="muted small" data-testid="token-split">
          {compact(own.input)} in · {compact(own.output)} out · {compact(own.cacheRead)} cache read ·{' '}
          {compact(own.cacheWrite)} cache write
          {withParty > tokens && <> · {compact(withParty)} with party</>}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------- building

export function BuildingPanel({
  state,
  location,
  now,
  onSelect,
  onOpenArchive,
}: {
  state: GuildState;
  location: Location;
  now: number;
  onSelect: Select;
  /** The Library keeps the Archive of reviewed skills: open it in the Skills tab. */
  onOpenArchive?: (() => void) | undefined;
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
      {onOpenArchive && (
        <button type="button" className="send open-chat" onClick={onOpenArchive} data-testid="open-archive">
          Open the Archive
        </button>
      )}

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
