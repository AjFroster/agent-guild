import { type GuildEvent, replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import type { ArchiveEntry, ForgeOrder } from './api.ts';
import { decisions, waitingCount } from './decisions.ts';

const state = replay([
  { t: 0, session: 'a', type: 'session_start', name: 'Ada' },
  { t: 1, session: 'a1', type: 'subagent_start', parent: 'a', name: 'Scout' },
  { t: 2, session: 'b', type: 'session_start', name: 'Bo' },
  { t: 30, session: 'a', type: 'needs_input' },
  { t: 40, session: 'a1', type: 'needs_input' },
] satisfies GuildEvent[]);

const entry = (id: string, status: ArchiveEntry['status'], reviewedAt: number): ArchiveEntry => ({
  id,
  name: `skill-${id}`,
  repo: 'acme-labs/agent-skills',
  path: id,
  commit: 'abc1234',
  stars: 6000,
  description: '',
  foundAt: 1,
  review: { verdict: 'gap', reason: 'Fills a gap.', overlaps: [], risks: [], reviewedAt },
  status,
  installedAt: null,
});

const order = (id: string, status: ForgeOrder['status'], reviewedAt: number): ForgeOrder => ({
  id,
  project: '/work/bakery',
  requestedBy: 'Ada',
  knightId: 'a',
  kind: 'command',
  need: 'say hello',
  status,
  piece: { name: 'hello', description: '', files: [], forgedAt: reviewedAt - 1 },
  review: { verdict: 'ready', reason: 'Fine.', risks: [], reviewedAt },
  createdAt: 1,
  installedAt: null,
  error: null,
});

describe('decisions', () => {
  it('merges questions, reviewed skills and reviewed pieces, newest first', () => {
    const list = decisions(
      state,
      [entry('s1', 'reviewed', 35), entry('s2', 'candidate', 50), entry('s3', 'installed', 60)],
      [order('o1', 'reviewed', 45), order('o2', 'forging', 70)],
    );
    expect(list.map((d) => d.key)).toEqual(['piece:o1', 'question:a1', 'skill:s1', 'question:a']);
  });

  it('tells a leader from a party member', () => {
    const questions = decisions(state).filter((d) => d.kind === 'question');
    expect(questions.map((d) => [d.name, d.kind === 'question' && d.leader])).toEqual([
      ['Scout', false],
      ['Ada', true],
    ]);
  });

  it('counts the badge from the announced counts before anything loads', () => {
    expect(waitingCount(state, 2, 1)).toBe(5);
    expect(waitingCount(replay([]), 0, 0)).toBe(0);
  });
});
