import type { GuildEvent, Todo } from './events.ts';

export type Location = 'guildhall' | 'library' | 'forge' | 'arena' | 'tower';
export type HeroStatus = 'working' | 'idle' | 'needs_you' | 'gone';

/**
 * Where an agent sits in the kingdom. The King is the session the user talks to and
 * that commands the rest; every other session is a Knight; a Knight's sub-agents are
 * Footsoldiers when they change things (edit files, run commands) and Workers while
 * they only read and search.
 */
export type Rank = 'king' | 'knight' | 'footsoldier' | 'worker' | 'librarian' | 'smith';

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
  /** Tokens the hero's own replies used; a party member's count separately. */
  tokens: Tokens;
  /** Its folder's git state, once the server has looked; null outside a repository. */
  git: GitState | null;
  /** The user's King: talks to the user and commands the Knights. */
  crowned: boolean;
  /** The King has given this Knight orders. */
  commanded: boolean;
  /** One of the librarians, who find and review skills for the Archive. */
  librarian: boolean;
  /** One of the smiths, who forge and mend equipment at the Forge. */
  smith: boolean;
  /** When it was last given an order (epoch seconds), or null. */
  orderedAt: number | null;
  /** When a raven last brought it news from one of the guild's utilities, or null. */
  ravenAt: number | null;
  /** Battles it fought that were won (docs/WARS.md). */
  victories: number;
}

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface GitState {
  /** Commits on no remote branch: lost if this machine is. */
  unpushed: number;
  /** Changed or untracked files. */
  dirty: number;
  /** The repository has a remote at all. */
  remote: boolean;
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
export const XP_PER_VICTORY = 100;
export const XP_PER_LEVEL = 150;
export const RECENT_LIMIT = 25;

export const LOCATIONS: readonly Location[] = ['library', 'forge', 'arena', 'tower', 'guildhall'];

export const noTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/** Every token the model read or wrote, cached or not. */
export function totalTokens(t: Tokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

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
  // A Knight asking for equipment walks to the Forge to ask.
  if (tool === 'mcp__guild__request_equipment') return 'forge';
  return TOOL_LOCATIONS[tool] ?? 'guildhall';
}

/** Which tools send a hero to each building, for explaining a building to the user. */
export function toolsFor(location: Location): string[] {
  return Object.entries(TOOL_LOCATIONS)
    .filter(([tool, l]) => l === location && !tool.startsWith('mcp__'))
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
    tokens: noTokens(),
    git: null,
    crowned: false,
    commanded: false,
    librarian: false,
    smith: false,
    orderedAt: null,
    ravenAt: null,
    victories: 0,
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
  // Own keys only, so an id like `constructor` never finds Object's prototype.
  const existing = Object.hasOwn(state.heroes, event.session) ? state.heroes[event.session] : undefined;

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

  // Git state is the folder's, polled on the server's clock, and it matters most after a
  // session has left: it updates a departed hero too, and is not activity.
  if (event.type === 'git') {
    if (!existing) return state;
    const git = { unpushed: event.unpushed, dirty: event.dirty, remote: event.remote };
    return { ...state, heroes: { ...state.heroes, [existing.id]: { ...existing, git } } };
  }

  // A victory comes when a branch merges, often after its Knight has left: it counts anyway.
  if (event.type === 'victory') {
    if (!existing) return state;
    const hero = withXp({ ...existing, victories: existing.victories + 1 }, XP_PER_VICTORY);
    return { ...state, heroes: { ...state.heroes, [hero.id]: hero } };
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
    case 'crown':
      hero = { ...hero, crowned: true };
      break;
    case 'commanded':
      hero = { ...hero, commanded: true, orderedAt: event.t, status: 'working' };
      break;
    case 'librarian':
      hero = { ...hero, librarian: true };
      break;
    case 'smith':
      hero = { ...hero, smith: true };
      break;
    case 'ordered':
      // Given an order: up, even out of bed, and off to hear it. A message a raven just
      // brought is news from a utility, read where the Knight stands.
      hero = fromRaven(hero.ravenAt, event.t)
        ? { ...hero, status: 'working' }
        : { ...hero, orderedAt: event.t, status: 'working' };
      break;
    case 'raven':
      // The raven's own event may arrive after the message it brought.
      hero = {
        ...hero,
        ravenAt: event.t,
        orderedAt: fromRaven(event.t, hero.orderedAt ?? -Infinity) ? null : hero.orderedAt,
      };
      break;
    case 'usage':
      hero = { ...hero, tokens: addTokens(hero.tokens, event) };
      break;
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
    case 'cleared':
      // Only a wait ends here: a hero that was already working, idle or away stays so.
      if (hero.status === 'needs_you') hero = { ...hero, status: 'working' };
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
  const leaders = present.filter((h) => h.parentId === null || !presentIds.has(h.parentId));
  // The King heads the roster; everyone else keeps arrival order (sort is stable).
  leaders.sort((a, b) => Number(b.crowned) - Number(a.crowned));
  return leaders.flatMap(withParty);
}

/**
 * Tokens a hero and its whole party used, members who have left included: their work
 * was done for this hero.
 */
export function partyTokens(state: GuildState, hero: Hero): Tokens {
  let sum = hero.tokens;
  const seen = new Set([hero.id]);
  const visit = (id: string) => {
    for (const member of Object.values(state.heroes)) {
      if (member.parentId !== id || seen.has(member.id)) continue;
      seen.add(member.id);
      sum = addTokens(sum, member.tokens);
      visit(member.id);
    }
  };
  visit(hero.id);
  return sum;
}

/**
 * What a hero is working on, in its own words: the quest it has marked in progress, or
 * failing that its next one still to do. Null when it has no quests open.
 */
export function currentQuest(hero: Hero): string | null {
  const open =
    hero.quests.find((q) => q.status === 'in_progress') ?? hero.quests.find((q) => q.status === 'pending');
  return open?.title ?? null;
}

/** How long a Knight stands before the throne after an order before going to work. */
export const AUDIENCE_SECONDS = 6;
/** A message this close to a raven is the raven's, not an order. */
const RAVEN_WINDOW_SECONDS = 30;
/** How long the raven's letter shows over a Knight. */
export const RAVEN_SECONDS = 10;

const fromRaven = (ravenAt: number | null, t: number) =>
  ravenAt !== null && Math.abs(t - ravenAt) < RAVEN_WINDOW_SECONDS;

/** Whether a raven has just brought this hero news, at time `now`. */
export function hasRaven(hero: Hero, now: number): boolean {
  return hero.ravenAt !== null && now >= hero.ravenAt && now - hero.ravenAt < RAVEN_SECONDS;
}

/** Whether a Knight is in the Throne Room hearing its latest order at time `now`. */
export function inAudience(hero: Hero, now: number): boolean {
  return (
    hero.parentId === null &&
    !hero.crowned &&
    // A librarian's work comes from the guild's schedule, not from the throne.
    !hero.librarian &&
    !hero.smith &&
    hero.orderedAt !== null &&
    now >= hero.orderedAt &&
    now - hero.orderedAt < AUDIENCE_SECONDS
  );
}

/** A worker's role from its session name: "Reviewer 2" is still the Reviewer. */
export const roleName = (name: string) => name.replace(/ \d+$/, '');

/** Only the newest worker of each role: an earlier run's session is not a second one. */
function newestPerRole(heroes: Hero[]): Hero[] {
  const newest = new Map<string, Hero>();
  for (const h of heroes) {
    const prev = newest.get(roleName(h.name));
    if (!prev || h.startedAt >= prev.startedAt) newest.set(roleName(h.name), h);
  }
  return heroes.filter((h) => newest.get(roleName(h.name)) === h);
}

/** The librarians in the guild now, newest of each role, in arrival order. They live inside the Library. */
export function librariansIn(state: GuildState): Hero[] {
  return newestPerRole(roster(state).filter((h) => h.librarian));
}

/** What a librarian is doing, shown as its icon on the Library and on the Library page. */
export type LibrarianState = 'working' | 'needs_you' | 'resting';

export function librarianState(hero: Hero): LibrarianState {
  if (hero.status === 'needs_you') return 'needs_you';
  return hero.status === 'working' ? 'working' : 'resting';
}

const LIBRARIAN_TOOLS: Record<string, string> = {
  WebSearch: 'Searching the web',
  WebFetch: 'Reading a page',
  Bash: 'Searching GitHub',
  list_installed_skills: 'Looking over your skills',
  list_archive: 'Checking the Archive',
  list_candidates: 'Fetching skills to review',
  add_candidate: 'Filing a skill in the Archive',
  record_review: 'Writing a review',
  write_note: 'Writing a note',
  list_forged: 'Fetching pieces from the Forge',
  review_piece: 'Testing a forged piece',
};

const SMITH_TOOLS: Record<string, string> = {
  Read: 'Reading the project',
  Grep: 'Searching the code',
  Glob: 'Looking through the files',
  Bash: 'Reading the history',
  read_order: 'Reading the order',
  submit_piece: 'Hanging the piece on the rack',
};

/** The smiths in the guild now, in the order they arrived. They work inside the Forge. */
export function smithsIn(state: GuildState): Hero[] {
  return newestPerRole(roster(state).filter((h) => h.smith));
}

/** A smith's latest tool call in words, or null before its first one. */
export function smithDoing(hero: Hero): string | null {
  const tool = hero.recent[0]?.tool;
  if (!tool) return null;
  return SMITH_TOOLS[tool.replace(/^mcp__guild__/, '')] ?? `Using ${tool}`;
}

/** A librarian's latest tool call in words, or null before its first one. */
export function librarianDoing(hero: Hero): string | null {
  const tool = hero.recent[0]?.tool;
  if (!tool) return null;
  return LIBRARIAN_TOOLS[tool.replace(/^mcp__guild__/, '')] ?? `Using ${tool}`;
}

export function rankOf(hero: Hero): Rank {
  if (hero.crowned) return 'king';
  if (hero.librarian) return 'librarian';
  if (hero.smith) return 'smith';
  if (hero.parentId === null) return 'knight';
  return hero.visits.forge + hero.visits.arena > 0 ? 'footsoldier' : 'worker';
}

/** Work that exists only on this machine: unpushed commits or uncommitted files. */
export function hasLooseEnds(hero: Hero): boolean {
  return hero.git !== null && (hero.git.unpushed > 0 || hero.git.dirty > 0);
}

/**
 * Sessions, present or gone, whose folder holds work not on any remote, most recently
 * active first. Sub-agents share their leader's folder, so only leaders are listed.
 */
export function looseEnds(state: GuildState): Hero[] {
  return Object.values(state.heroes)
    .filter((h) => h.parentId === null && hasLooseEnds(h))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

/** Tokens across every hero the guild has seen, present or gone. */
export function guildTokens(state: GuildState): Tokens {
  return Object.values(state.heroes).reduce((sum, h) => addTokens(sum, h.tokens), noTokens());
}

/** Who spent the tokens: the Knights (and the King), or one of the guild's utilities. */
export type Spender = 'knights' | 'library' | 'forge';

/**
 * Tokens by who spent them: each session, and its sub-agents, counts for the utility its
 * root session works for (librarians for the Library, smiths for the Forge), else for the
 * Knights. Only sessions started at or after `since` (epoch seconds) count: helpers start
 * a session per run, so this is "the runs since then".
 */
export function tokensByUtility(state: GuildState, since = -Infinity): Record<Spender, number> {
  const out: Record<Spender, number> = { knights: 0, library: 0, forge: 0 };
  for (const hero of Object.values(state.heroes)) {
    if (hero.startedAt < since) continue;
    let root = hero;
    for (let i = 0; i < 10 && root.parentId && state.heroes[root.parentId]; i++)
      root = state.heroes[root.parentId]!;
    const who: Spender = root.librarian ? 'library' : root.smith ? 'forge' : 'knights';
    out[who] += totalTokens(hero.tokens);
  }
  return out;
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
