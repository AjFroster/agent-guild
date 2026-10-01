import { type GuildEvent, replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import { diffNotices, diffWaiting } from './notices.ts';

const base: GuildEvent[] = [
  { t: 0, session: 'a', type: 'session_start', name: 'Ada' },
  { t: 1, session: 'a1', type: 'subagent_start', parent: 'a', name: 'Scout' },
  { t: 2, session: 'a', type: 'tool', tool: 'Edit' },
  { t: 2, session: 'a1', type: 'tool', tool: 'Read' },
];
const at = (extra: GuildEvent[]) => replay([...base, ...extra]);
const kinds = (prev: ReturnType<typeof replay> | null, next: ReturnType<typeof replay>) =>
  diffNotices(prev, next).map((n) => `${n.kind}:${n.heroId}`);

describe('diffNotices', () => {
  it('stays quiet on the first snapshot, which is history', () => {
    expect(diffNotices(null, at([{ t: 3, session: 'a', type: 'needs_input' }]))).toEqual([]);
  });

  it('raises needs-you once, for leaders and sub-agents alike', () => {
    const before = at([]);
    const waiting = at([
      { t: 3, session: 'a', type: 'needs_input' },
      { t: 3, session: 'a1', type: 'needs_input' },
    ]);
    expect(kinds(before, waiting)).toEqual(['needs_you:a', 'needs_you:a1']);
    expect(kinds(waiting, waiting)).toEqual([]);
  });

  it('raises finished when a leader completes a turn, but not for sub-agents', () => {
    const before = at([]);
    const after = at([
      { t: 3, session: 'a', type: 'stop' },
      { t: 3, session: 'a1', type: 'stop' },
    ]);
    expect(kinds(before, after)).toEqual(['finished:a']);
  });

  it('raises arrivals and departures of leaders only', () => {
    const before = at([]);
    const after = at([
      { t: 3, session: 'b', type: 'session_start', name: 'Grace' },
      { t: 3, session: 'a2', type: 'subagent_start', parent: 'a', name: 'Tester' },
      { t: 4, session: 'a', type: 'session_end' },
    ]);
    expect(kinds(before, after)).toEqual(['left:a', 'arrived:b']);
  });

  it('gives each occurrence a distinct key, so a second wait is a new notice', () => {
    const first = diffNotices(at([]), at([{ t: 3, session: 'a', type: 'needs_input' }]))[0]!;
    const resumed = at(resumedEvents());
    const second = diffNotices(
      resumed,
      at([...resumedEvents(), { t: 5, session: 'a', type: 'needs_input' }]),
    )[0]!;
    expect(first.key).not.toBe(second.key);
    expect(first.text).toBe('Ada needs you');
  });
});

function resumedEvents(): GuildEvent[] {
  return [
    { t: 3, session: 'a', type: 'needs_input' },
    { t: 4, session: 'a', type: 'tool', tool: 'Bash' },
  ];
}

describe('diffWaiting', () => {
  const w = (skills: number, sv: number, forge: number, fv: number) => ({
    skills: { waiting: skills, version: sv },
    forge: { waiting: forge, version: fv },
  });

  it('takes the counts announced on connecting as history', () => {
    expect(diffWaiting(null, w(2, 1, 1, 1))).toEqual([]);
    expect(diffWaiting(w(0, 0, 0, 0), w(2, 1, 1, 1))).toEqual([]);
  });

  it('raises a notice when a skill or a piece newly waits', () => {
    const notices = diffWaiting(w(0, 1, 0, 1), w(2, 2, 1, 2));
    expect(notices.map((n) => [n.kind, n.heroId, n.text])).toEqual([
      ['skill_ready', null, '2 reviewed skills wait for your approval'],
      ['piece_ready', null, 'A forged piece is ready to install'],
    ]);
  });

  it('stays quiet when a decision is made', () => {
    expect(diffWaiting(w(2, 2, 1, 2), w(1, 3, 0, 3))).toEqual([]);
  });
});
