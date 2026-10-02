import { describe, expect, it } from 'vitest';

import { type TokenStore, takeToken } from './token.ts';

function memory(initial: string | null = null): TokenStore & { value: string | null } {
  const s = {
    value: initial,
    get: () => s.value,
    set: (t: string) => {
      s.value = t;
    },
    clear: () => {
      s.value = null;
    },
  };
  return s;
}

describe('takeToken', () => {
  it('keeps a token from the link and takes it out of the address, leaving the rest', () => {
    const store = memory();
    const got = takeToken('http://127.0.0.1:4747/?token=abc&select=building%3Aforge#x', store);
    expect(got).toEqual({ token: 'abc', cleanHref: '/?select=building%3Aforge#x' });
    expect(store.value).toBe('abc');
  });

  it('uses the stored token when the address has none', () => {
    expect(takeToken('http://127.0.0.1:4747/', memory('kept'))).toEqual({ token: 'kept', cleanHref: null });
    expect(takeToken('http://127.0.0.1:4747/', memory())).toEqual({ token: null, cleanHref: null });
  });

  it('prefers a new link over an old stored token', () => {
    const store = memory('old');
    expect(takeToken('http://127.0.0.1:4747/?token=new', store).token).toBe('new');
    expect(store.value).toBe('new');
  });
});
