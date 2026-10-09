import { describe, expect, it } from 'vitest';

import { EventStream, Signal } from './events.ts';

describe('signals from the Herald', () => {
  it('takes a session id and a kind', () => {
    expect(Signal.parse({ session: 'abc-123_X', kind: 'permission' })).toEqual({
      session: 'abc-123_X',
      kind: 'permission',
    });
    expect(Signal.safeParse({ session: 'a', kind: 'cleared' }).success).toBe(true);
  });

  it('refuses any other kind, an odd id, or anything extra', () => {
    const bad = [
      { session: 'a', kind: 'deny' },
      { session: '', kind: 'permission' },
      { session: 'a'.repeat(101), kind: 'permission' },
      { session: '../etc/passwd', kind: 'permission' },
      { session: 'a b', kind: 'permission' },
      { session: 'a', kind: 'permission', prompt: 'hello' },
      { session: 'a' },
      { kind: 'permission' },
      'a',
      null,
    ];
    for (const body of bad) expect(Signal.safeParse(body).success, JSON.stringify(body)).toBe(false);
  });

  it('accepts the cleared event in a stream', () => {
    expect(EventStream.safeParse([{ t: 0, session: 'a', type: 'cleared' }]).success).toBe(true);
  });
});
