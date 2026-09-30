import { describe, expect, it } from 'vitest';

import type { GuildEvent } from './events.ts';
import { EventStream } from './events.ts';
import {
  XP_PER_LEVEL,
  XP_PER_QUEST,
  XP_PER_TURN,
  applyEvent,
  depthOf,
  emptyGuild,
  levelFor,
  locationForTool,
  replay,
  roster,
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
