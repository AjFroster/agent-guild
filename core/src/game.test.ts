import { describe, expect, it } from 'vitest';

import type { GuildEvent } from './events.ts';
import { EventStream } from './events.ts';
import {
  RECENT_LIMIT,
  XP_PER_LEVEL,
  XP_PER_QUEST,
  XP_PER_TURN,
  applyEvent,
  currentQuest,
  depthOf,
  inAudience,
  emptyGuild,
  guildTokens,
  levelFor,
  looseEnds,
  partyTokens,
  rankOf,
  locationForTool,
  replay,
  roster,
  toolsFor,
  totalTokens,
} from './game.ts';

const start = (session: string, t = 0): GuildEvent => ({ t, session, type: 'session_start', name: session });

describe('locationForTool', () => {
  it('sends readers to the library, editors to the forge, shells to the arena', () => {
    expect(locationForTool('Read')).toBe('library');
    expect(locationForTool('Edit')).toBe('forge');
    expect(locationForTool('Bash')).toBe('arena');
    expect(locationForTool('WebSearch')).toBe('tower');
  });

  it('keeps unknown and MCP tools at the guildhall', () => {
    expect(locationForTool('mcp__github__create_issue')).toBe('guildhall');
    expect(locationForTool('TodoWrite')).toBe('guildhall');
  });
});

describe('applyEvent', () => {
  it('ignores events for a session that never started', () => {
    const state = applyEvent(emptyGuild(), { t: 1, session: 'ghost', type: 'tool', tool: 'Edit' });
    expect(state.order).toEqual([]);
  });

  it('moves a working hero to the building for its tool', () => {
    const state = replay([start('a'), { t: 1, session: 'a', type: 'tool', tool: 'Edit' }]);
    expect(state.heroes.a).toMatchObject({ location: 'forge', status: 'working' });
  });

  it('pays quest XP once, even when the same completed list is sent again', () => {
    const todos = [
      { id: '1', title: 'Write the reducer', status: 'completed' as const },
      { id: '2', title: 'Write the tests', status: 'in_progress' as const },
    ];
    const state = replay([
      start('a'),
      { t: 1, session: 'a', type: 'todos', todos },
      { t: 2, session: 'a', type: 'todos', todos },
    ]);
    expect(state.heroes.a?.xp).toBe(XP_PER_QUEST);
  });

  it('pays again for a quest that is reopened and then redone', () => {
    const done = [{ id: '1', title: 'Ship it', status: 'completed' as const }];
    const reopened = [{ id: '1', title: 'Ship it', status: 'in_progress' as const }];
    const state = replay([
      start('a'),
      { t: 1, session: 'a', type: 'todos', todos: done },
      { t: 2, session: 'a', type: 'todos', todos: reopened },
      { t: 3, session: 'a', type: 'todos', todos: done },
    ]);
    // Only the latest list is remembered, so reopening clears the completion and a
    // genuine redo pays out. Pinned here so a change to that rule is deliberate.
    expect(state.heroes.a?.xp).toBe(2 * XP_PER_QUEST);
  });

  it('flags a hero that needs the user until it works again', () => {
    const waiting = replay([start('a'), { t: 1, session: 'a', type: 'needs_input' }]);
    expect(waiting.heroes.a?.status).toBe('needs_you');
    const resumed = applyEvent(waiting, { t: 2, session: 'a', type: 'tool', tool: 'Read' });
    expect(resumed.heroes.a?.status).toBe('working');
  });

  it('pays turn XP and sends the hero home on stop', () => {
    const state = replay([
      start('a'),
      { t: 1, session: 'a', type: 'tool', tool: 'Bash' },
      { t: 2, session: 'a', type: 'stop' },
    ]);
    expect(state.heroes.a).toMatchObject({ location: 'guildhall', status: 'idle', xp: XP_PER_TURN });
  });

  it('ignores events after a hero has left', () => {
    const state = replay([
      start('a'),
      { t: 1, session: 'a', type: 'session_end' },
      { t: 2, session: 'a', type: 'stop' },
    ]);
    expect(state.heroes.a).toMatchObject({ status: 'gone', xp: 0 });
  });

  it('brings a resumed hero back with the XP it had', () => {
    const state = replay([
      start('a'),
      { t: 1, session: 'a', type: 'stop' },
      { t: 2, session: 'a', type: 'session_end' },
      start('a', 3),
    ]);
    expect(state.heroes.a).toMatchObject({ status: 'idle', xp: XP_PER_TURN });
    expect(state.order).toEqual(['a']);
  });

  it('does not reset a live hero when session_start repeats', () => {
    const state = replay([start('a'), { t: 1, session: 'a', type: 'stop' }, start('a', 2)]);
    expect(state.heroes.a?.xp).toBe(XP_PER_TURN);
    expect(state.order).toEqual(['a']);
  });
});

describe('levelFor', () => {
  it('levels up every XP_PER_LEVEL', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(XP_PER_LEVEL - 1)).toBe(1);
    expect(levelFor(XP_PER_LEVEL)).toBe(2);
  });
});

describe('replay', () => {
  it('orders by time and stops at the requested moment', () => {
    const events: GuildEvent[] = [
      { t: 5, session: 'a', type: 'tool', tool: 'Bash' },
      start('a'),
      { t: 2, session: 'a', type: 'tool', tool: 'Read' },
    ];
    expect(replay(events, 3).heroes.a?.location).toBe('library');
    expect(replay(events).heroes.a?.location).toBe('arena');
  });
});

describe('roster', () => {
  const party = replay([
    start('lead'),
    { t: 1, session: 'scout', type: 'subagent_start', parent: 'lead', name: 'Scout' },
    { t: 2, session: 'other', type: 'session_start', name: 'Other' },
    { t: 3, session: 'squire', type: 'subagent_start', parent: 'scout', name: 'Squire' },
  ]);

  it('lists each leader followed by its whole party, nested members included', () => {
    expect(roster(party).map((h) => h.id)).toEqual(['lead', 'scout', 'squire', 'other']);
    expect(depthOf(party, party.heroes.squire!)).toBe(2);
  });

  it('promotes a member whose leader left instead of dropping it', () => {
    const leaderGone = applyEvent(party, { t: 4, session: 'lead', type: 'session_end' });
    expect(roster(leaderGone).map((h) => h.id)).toEqual(['scout', 'squire', 'other']);
  });
});

describe('EventStream schema', () => {
  it('rejects an event with an unknown type', () => {
    expect(EventStream.safeParse([{ t: 0, session: 'a', type: 'teleport' }]).success).toBe(false);
  });

  it('rejects a quest title long enough to be a pasted prompt', () => {
    const todos = [{ id: '1', title: 'x'.repeat(121), status: 'pending' }];
    expect(EventStream.safeParse([{ t: 0, session: 'a', type: 'todos', todos }]).success).toBe(false);
  });
});

describe('hero history', () => {
  const state = replay([
    start('a'),
    { t: 1, session: 'a', type: 'meta', model: 'claude-opus-5-5', branch: 'main' },
    { t: 2, session: 'a', type: 'tool', tool: 'Read' },
    { t: 3, session: 'a', type: 'tool', tool: 'Grep' },
    { t: 4, session: 'a', type: 'tool', tool: 'Edit' },
    { t: 5, session: 'a', type: 'stop' },
    { t: 6, session: 'a', type: 'meta', branch: 'feat/x' },
  ]);
  const hero = state.heroes.a!;

  it('counts tool calls per building and finished turns', () => {
    expect(hero.visits).toEqual({ library: 2, forge: 1, arena: 0, tower: 0, guildhall: 0 });
    expect(hero.turns).toBe(1);
  });

  it('keeps recent activity newest first', () => {
    expect(hero.recent.map((a) => a.tool)).toEqual(['Edit', 'Grep', 'Read']);
    expect(hero.recent[0]).toEqual({ t: 4, tool: 'Edit', location: 'forge' });
  });

  it('caps recent activity', () => {
    const many = replay([
      start('b'),
      ...Array.from({ length: RECENT_LIMIT + 10 }, (_, i) => ({
        t: i + 1,
        session: 'b',
        type: 'tool' as const,
        tool: 'Bash',
      })),
    ]);
    expect(many.heroes.b!.recent).toHaveLength(RECENT_LIMIT);
    expect(many.heroes.b!.visits.arena).toBe(RECENT_LIMIT + 10);
  });

  it('records model and branch, keeping the model when only the branch changes', () => {
    expect(hero.model).toBe('claude-opus-5-5');
    expect(hero.branch).toBe('feat/x');
  });

  it('tracks when the hero arrived and was last active', () => {
    expect(hero.startedAt).toBe(0);
    expect(hero.lastActiveAt).toBe(6);
  });

  it('lists which tools send a hero to each building', () => {
    expect(toolsFor('arena')).toEqual(['Bash']);
    expect(toolsFor('guildhall')).toEqual([]);
  });
});

describe('tokens', () => {
  const use = (session: string, t: number, input: number, output: number): GuildEvent => ({
    t,
    session,
    type: 'usage',
    input,
    output,
    cacheRead: 100,
    cacheWrite: 0,
  });
  const state = replay([
    start('lead'),
    { t: 1, session: 'scout', type: 'subagent_start', parent: 'lead', name: 'Scout' },
    { t: 1, session: 'deep', type: 'subagent_start', parent: 'scout', name: 'Deep' },
    use('lead', 2, 10, 20),
    use('lead', 3, 5, 5),
    use('scout', 4, 1, 2),
    use('deep', 5, 1, 1),
    { t: 6, session: 'scout', type: 'subagent_stop' },
    start('other', 7),
    use('other', 8, 1000, 1000),
  ]);

  it("adds up each hero's own replies", () => {
    expect(state.heroes.lead!.tokens).toEqual({ input: 15, output: 25, cacheRead: 200, cacheWrite: 0 });
    expect(totalTokens(state.heroes.lead!.tokens)).toBe(240);
  });

  it("counts a party, members who left included, and nobody else's", () => {
    expect(partyTokens(state, state.heroes.lead!)).toEqual({
      input: 17,
      output: 28,
      cacheRead: 400,
      cacheWrite: 0,
    });
  });

  it('totals the whole guild', () => {
    expect(guildTokens(state).output).toBe(1028);
  });

  it('rejects a negative or fractional count', () => {
    expect(EventStream.safeParse([{ ...use('a', 1, -1, 0) }]).success).toBe(false);
    expect(EventStream.safeParse([{ ...use('a', 1, 1.5, 0) }]).success).toBe(false);
  });
});

describe('git state', () => {
  const git = (session: string, t: number, unpushed: number, dirty: number): GuildEvent => ({
    t,
    session,
    type: 'git',
    unpushed,
    dirty,
    remote: true,
  });

  it('records the folder state without counting it as activity', () => {
    const state = replay([
      start('a'),
      { t: 5, session: 'a', type: 'tool', tool: 'Edit' },
      git('a', 900, 2, 1),
    ]);
    expect(state.heroes.a!.git).toEqual({ unpushed: 2, dirty: 1, remote: true });
    expect(state.heroes.a!.lastActiveAt).toBe(5);
  });

  it('keeps updating after the hero leaves, and lists loose ends newest first', () => {
    const state = replay([
      start('old'),
      { t: 1, session: 'old', type: 'session_end' },
      start('new', 2),
      { t: 3, session: 'sub', type: 'subagent_start', parent: 'new', name: 'Sub' },
      start('clean', 4),
      git('old', 10, 3, 0),
      git('new', 10, 0, 4),
      git('sub', 10, 9, 9),
      git('clean', 10, 0, 0),
      git('never-started', 10, 5, 5),
    ]);
    expect(state.heroes.old!.status).toBe('gone');
    expect(looseEnds(state).map((h) => h.id)).toEqual(['new', 'old']);
    // Pushing everything clears it.
    expect(looseEnds(replay([start('a'), git('a', 1, 2, 0), git('a', 2, 0, 0)]))).toEqual([]);
  });
});

describe('ranks', () => {
  const state = replay([
    start('knight'),
    start('king', 1),
    { t: 2, session: 'king', type: 'crown' },
    { t: 3, session: 'scout', type: 'subagent_start', parent: 'knight', name: 'Scout' },
    { t: 4, session: 'smith', type: 'subagent_start', parent: 'knight', name: 'Smith' },
    { t: 5, session: 'scout', type: 'tool', tool: 'Grep' },
    { t: 6, session: 'smith', type: 'tool', tool: 'Read' },
  ]);

  it('crowns the King, makes other sessions Knights and their sub-agents Workers', () => {
    expect(rankOf(state.heroes.king!)).toBe('king');
    expect(rankOf(state.heroes.knight!)).toBe('knight');
    expect(rankOf(state.heroes.scout!)).toBe('worker');
    expect(rankOf(state.heroes.smith!)).toBe('worker');
  });

  it('promotes a Worker to Footsoldier once it edits a file or runs a command', () => {
    const next = applyEvent(state, { t: 7, session: 'smith', type: 'tool', tool: 'Edit' });
    expect(rankOf(next.heroes.smith!)).toBe('footsoldier');
    const ran = applyEvent(state, { t: 7, session: 'scout', type: 'tool', tool: 'Bash' });
    expect(rankOf(ran.heroes.scout!)).toBe('footsoldier');
  });

  it('marks a Knight the King has given orders to', () => {
    const next = applyEvent(state, { t: 8, session: 'knight', type: 'commanded' });
    expect(next.heroes.knight!.commanded).toBe(true);
    expect(state.heroes.knight!.commanded).toBe(false);
  });

  it('puts the King at the head of the roster', () => {
    expect(roster(state).map((h) => h.id)).toEqual(['king', 'knight', 'scout', 'smith']);
  });
});

describe('currentQuest', () => {
  const at = (todos: { id: string; title: string; status: 'pending' | 'in_progress' | 'completed' }[]) =>
    replay([start('a'), { t: 1, session: 'a', type: 'todos', todos }]).heroes.a!;

  it('names the quest in progress, else the next one to do, else nothing', () => {
    expect(
      currentQuest(
        at([
          { id: '1', title: 'Read the model', status: 'completed' },
          { id: '2', title: 'Build the page', status: 'in_progress' },
          { id: '3', title: 'Add tests', status: 'pending' },
        ]),
      ),
    ).toBe('Build the page');
    expect(currentQuest(at([{ id: '3', title: 'Add tests', status: 'pending' }]))).toBe('Add tests');
    expect(currentQuest(at([{ id: '1', title: 'Done', status: 'completed' }]))).toBeNull();
    expect(currentQuest(at([]))).toBeNull();
  });
});

describe('orders and the Throne Room', () => {
  const asleep = replay([start('a'), { t: 1, session: 'a', type: 'stop' }]);

  it('wakes a resting Knight when it is given an order', () => {
    expect(asleep.heroes.a!.status).toBe('idle');
    const ordered = applyEvent(asleep, { t: 100, session: 'a', type: 'ordered' });
    expect(ordered.heroes.a).toMatchObject({ status: 'working', orderedAt: 100 });
    const commanded = applyEvent(asleep, { t: 100, session: 'a', type: 'commanded' });
    expect(commanded.heroes.a).toMatchObject({ status: 'working', orderedAt: 100, commanded: true });
  });

  it('keeps a Knight in audience for a few seconds after its order, then sends it to work', () => {
    const hero = applyEvent(asleep, { t: 100, session: 'a', type: 'ordered' }).heroes.a!;
    expect(inAudience(hero, 100)).toBe(true);
    expect(inAudience(hero, 105.9)).toBe(true);
    expect(inAudience(hero, 106)).toBe(false);
    expect(inAudience(hero, 99)).toBe(false); // a replay from before the order
    expect(inAudience(asleep.heroes.a!, 100)).toBe(false); // never ordered
  });
});
