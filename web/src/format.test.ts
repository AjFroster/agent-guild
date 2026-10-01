import { describe, expect, it } from 'vitest';

import { compact, duration } from './format.ts';

describe('compact', () => {
  it('shortens thousands and millions', () => {
    expect([0, 950, 1000, 1234, 12_345, 999_999, 1_234_567, 45_000_000].map(compact)).toEqual([
      '0',
      '950',
      '1k',
      '1.2k',
      '12k',
      '1M',
      '1.2M',
      '45M',
    ]);
  });
});

describe('duration', () => {
  it('reads as minutes, then hours and minutes', () => {
    expect([0, 59, 60, 42 * 60, 3600, 3 * 3600 + 5 * 60].map(duration)).toEqual([
      '< 1 min',
      '< 1 min',
      '1 min',
      '42 min',
      '1 h',
      '3 h 5 min',
    ]);
  });
});
