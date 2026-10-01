import type { GuildEvent, Todo } from './events.ts';

export type Location = 'guildhall' | 'library' | 'forge' | 'arena' | 'tower';
export type HeroStatus = 'working' | 'idle' | 'needs_you' | 'gone';

export interface Hero {
  id: string;
  name: string;
  /** Set for sub-agents: the hero whose party this member belongs to. */
  parentId: string | null;
  location: Location;
  status: HeroStatus;
  xp: number;
  level: number;
  quests: Todo[];
  /** Epoch seconds: when the hero arrived, and when it last did anything. */
  startedAt: number;
  lastActiveAt: number;
  /** Finished turns. */
  turns: number;
  /** Tool calls per building, over the hero's whole life. */
  visits: Record<Location, number>;
  /** The latest tool calls, newest first, capped at RECENT_LIMIT. */
  recent: Activity[];
  model: string | null;
  branch: string | null;
}

export interface Activity {
  t: number;
  tool: string;
  location: Location;
}

export interface GuildState {
  /** Insertion-ordered, so the UI lists heroes in the order they arrived. */
  heroes: Record<string, Hero>;
  order: string[];
}

export const XP_PER_QUEST = 50;
export const XP_PER_TURN = 10;
export const XP_PER_LEVEL = 150;
export const RECENT_LIMIT = 25;

export const LOCATIONS: readonly Location[] = ['library', 'forge', 'arena', 'tower', 'guildhall'];

const noVisits = (): Record<Location, number> => ({ library: 0, forge: 0, arena: 0, tower: 0, guildhall: 0 });

export const emptyGuild = (): GuildState => ({ heroes: {}, order: [] });

export function levelFor(xp: number): number {
  return 1 + Math.floor(xp / XP_PER_LEVEL);
}

const TOOL_LOCATIONS: Record<string, Location> = {
  Read: 'library',
  Grep: 'library',
  Glob: 'library',
  LS: 'library',
  Edit: 'forge',
  MultiEdit: 'forge',
  Write: 'forge',
  NotebookEdit: 'forge',
  Bash: 'arena',
  WebFetch: 'tower',
  WebSearch: 'tower',
};

/** Unknown tools (MCP tools, Task, TodoWrite...) keep the hero at the guildhall. */
export function locationForTool(tool: string): Location {
  return TOOL_LOCATIONS[tool] ?? 'guildhall';
}

/** Which tools send a hero to each building, for explaining a building to the user. */
export function toolsFor(location: Location): string[] {
  return Object.entries(TOOL_LOCATIONS)
    .filter(([, l]) => l === location)
    .map(([tool]) => tool);
}

function newHero(id: string, name: string, parentId: string | null, t: number): Hero {
  return {
    id,
    name,
    parentId,
    location: 'guildhall',
    status: 'idle',
    xp: 0,
    level: 1,
    quests: [],
    startedAt: t,
    lastActiveAt: t,
    turns: 0,
    visits: noVisits(),
    recent: [],
    model: null,
    branch: null,
  };
}

function withXp(hero: Hero, gained: number): Hero {
  const xp = hero.xp + gained;
  return { ...hero, xp, level: levelFor(xp) };
}

/**
 * Pure reducer: the whole game is this function folded over the event stream.
 *
 * Events for a session the guild has not seen start are ignored rather than inventing a
 * hero, because a hook can fire for a session that began before the server did and the
 * name would be a guess.
 */
export function applyEvent(state: GuildState, event: GuildEvent): GuildState {
  const existing = state.heroes[event.session];

  if (event.type === 'session_start' || event.type === 'subagent_start') {
    if (existing && existing.status !== 'gone') return state;
    const parentId = event.type === 'subagent_start' ? event.parent : null;
    // A resumed session comes back with the XP it earned before it went quiet.
    const hero = existing
      ? { ...existing, status: 'idle' as const, location: 'guildhall' as const, lastActiveAt: event.t }
      : newHero(event.session, event.name, parentId, event.t);
    return {
      heroes: { ...state.heroes, [hero.id]: hero },
      order: existing ? state.order : [...state.order, hero.id],
    };
  }

  if (!existing || existing.status === 'gone') return state;

  let hero: Hero = { ...existing, lastActiveAt: Math.max(existing.lastActiveAt, event.t) };
  switch (event.type) {
    case 'tool': {
      const location = locationForTool(event.tool);
      hero = {
        ...hero,
        location,
        status: 'working',
        visits: { ...hero.visits, [location]: hero.visits[location] + 1 },
        recent: [{ t: event.t, tool: event.tool, location }, ...hero.recent].slice(0, RECENT_LIMIT),
      };
      break;
    }
    case 'meta':
      hero = { ...hero, model: event.model ?? hero.model, branch: event.branch ?? hero.branch };
      break;
    case 'todos': {
      // XP only for quests that newly reached completed, so re-sending the same list
      // (Claude rewrites the whole todo list each time) never pays out twice.
      const wasDone = new Set(hero.quests.filter((q) => q.status === 'completed').map((q) => q.id));
      const newlyDone = event.todos.filter((q) => q.status === 'completed' && !wasDone.has(q.id));
      hero = withXp({ ...hero, quests: event.todos }, newlyDone.length * XP_PER_QUEST);
      break;
    }
    case 'needs_input':
      hero = { ...hero, status: 'needs_you' };
      break;
    case 'stop':
      hero = withXp({ ...hero, status: 'idle', location: 'guildhall', turns: hero.turns + 1 }, XP_PER_TURN);
      break;
    case 'session_end':
    case 'subagent_stop':
      hero = { ...hero, status: 'gone' };
      break;
  }
  return { ...state, heroes: { ...state.heroes, [hero.id]: hero } };
}

/** Replay a stream up to and including time `until` (all of it when omitted). */
export function replay(events: readonly GuildEvent[], until = Infinity): GuildState {
  return [...events]
    .filter((e) => e.t <= until)
    .sort((a, b) => a.t - b.t)
    .reduce(applyEvent, emptyGuild());
}

/**
 * Heroes still in the guild, each leader followed by its party (depth-first, so a
 * sub-agent's own sub-agents follow it). A member whose leader has left is promoted to
 * leader rather than disappearing.
 */
export function roster(state: GuildState): Hero[] {
  const present = state.order
    .map((id) => state.heroes[id])
    .filter((h): h is Hero => h !== undefined && h.status !== 'gone');
  const presentIds = new Set(present.map((h) => h.id));
  const membersOf = (id: string) => present.filter((h) => h.parentId === id);
  const withParty = (hero: Hero): Hero[] => [hero, ...membersOf(hero.id).flatMap(withParty)];
  return present.filter((h) => h.parentId === null || !presentIds.has(h.parentId)).flatMap(withParty);
}

/** How deep a hero sits in its party tree: 0 for a leader. */
export function depthOf(state: GuildState, hero: Hero): number {
  let depth = 0;
  let parent = hero.parentId ? state.heroes[hero.parentId] : undefined;
  while (parent && parent.status !== 'gone' && depth < 10) {
    depth += 1;
    parent = parent.parentId ? state.heroes[parent.parentId] : undefined;
  }
  return depth;
}
