import { expect, test } from 'claude-code/testing';

import { expandHome, heroFrom, isSessionId, loopbackOrigin, statusLine, tokenFrom } from './herald.ts';

test('loopback addresses only, with no credentials', () => {
  expect(loopbackOrigin('http://127.0.0.1:4747')).toBe('http://127.0.0.1:4747');
  expect(loopbackOrigin(' http://LOCALHOST:4747/some/path?q=1 ')).toBe('http://localhost:4747');
  expect(loopbackOrigin('http://[::1]:4747')).toBe('http://[::1]:4747');
  for (const url of [
    'http://example.com',
    'http://127.0.0.2:4747',
    'http://0.0.0.0:4747',
    'http://localhost.example.com',
    'http://127.0.0.1@example.com',
    'http://a:b@127.0.0.1:4747',
    'file:///etc/passwd',
    'https://127.0.0.1:4747',
    'https://localhost:4747',
    'javascript:alert(1)',
    '',
    7,
    undefined,
  ]) {
    expect(loopbackOrigin(url)).toBeNull();
  }
});

test('session ids follow the server rule', () => {
  expect(isSessionId('b3680d31-8c34-49e9-812b-cce6ee3d91a0')).toBe(true);
  expect(isSessionId('a_b-C')).toBe(true);
  for (const id of ['', 'a b', '../x', 'a/b', 'x'.repeat(101), 3, null]) expect(isSessionId(id)).toBe(false);
});

test('a token is one header-safe word', () => {
  expect(tokenFrom('  abcdefghijklmnop1234\n')).toBe('abcdefghijklmnop1234');
  expect(tokenFrom('short')).toBeNull();
  expect(tokenFrom('abcdefghijklmnop\r\nX-Evil: 1')).toBeNull();
  expect(tokenFrom('abcdefgh ijklmnop')).toBeNull();
  expect(tokenFrom(undefined)).toBeNull();
});

test('~ expands to the home folder', () => {
  expect(expandHome('~/.agent-guild/token', '/home/hero')).toBe('/home/hero/.agent-guild/token');
  expect(expandHome('~/.agent-guild/token', '/home/hero/')).toBe('/home/hero/.agent-guild/token');
  expect(expandHome('/etc/guild/token', undefined)).toBe('/etc/guild/token');
  expect(expandHome('~/x', undefined)).toBeNull();
});

test('a hero is read strictly, and shown as rank, level and XP', () => {
  const hero = heroFrom('{"name":"Ser Quill","rank":"footsoldier","level":2,"xp":160,"status":"working"}');
  expect(hero).toEqual({ name: 'Ser Quill', rank: 'footsoldier', level: 2, xp: 160, status: 'working' });
  expect(statusLine(hero!)).toBe('⚔ Footsoldier · Lv 2 · 160 XP');
  expect(heroFrom('not json')).toBeNull();
  expect(heroFrom('null')).toBeNull();
  expect(heroFrom('{"name":"x","rank":"knight","level":"2","xp":1,"status":"idle"}')).toBeNull();
  expect(heroFrom('{"name":"x","rank":"knight","level":1.5,"xp":1,"status":"idle"}')).toBeNull();
});
