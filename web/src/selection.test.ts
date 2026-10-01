import { replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import { formatSelection, parseSelection, resolveSelection } from './selection.ts';

describe('parseSelection', () => {
  it('reads heroes and known buildings, and round-trips', () => {
    expect(parseSelection('hero:s-ada')).toEqual({ kind: 'hero', id: 's-ada' });
    expect(parseSelection('building:forge')).toEqual({ kind: 'building', id: 'forge' });
    expect(formatSelection({ kind: 'hero', id: 'a:b' })).toBe('hero:a:b');
    expect(parseSelection('hero:a:b')).toEqual({ kind: 'hero', id: 'a:b' });
  });

  it('ignores anything else instead of opening a broken panel', () => {
    for (const bad of [null, '', 'hero:', 'building:castle', 'villain:x', 'forge']) {
      expect(parseSelection(bad)).toBeNull();
    }
  });
});

describe('resolveSelection', () => {
  const state = replay([
    { t: 0, session: 'a', type: 'session_start', name: 'A' },
    { t: 0, session: 'b', type: 'session_start', name: 'B' },
    { t: 1, session: 'b', type: 'session_end' },
  ]);

  it('drops a hero that is unknown or has left', () => {
    expect(resolveSelection(state, { kind: 'hero', id: 'a' })).toEqual({ kind: 'hero', id: 'a' });
    expect(resolveSelection(state, { kind: 'hero', id: 'b' })).toBeNull();
    expect(resolveSelection(state, { kind: 'hero', id: 'zzz' })).toBeNull();
    expect(resolveSelection(state, { kind: 'building', id: 'tower' })).toEqual({
      kind: 'building',
      id: 'tower',
    });
  });
});
