import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, DEFAULT_THEME, THEMES, parseSettings, themeOf } from './settings.ts';

describe('themes', () => {
  it('starts in Control Room', () => {
    expect(DEFAULT_THEME).toBe('control-room');
    expect(DEFAULT_SETTINGS.theme).toBe('control-room');
  });

  it('offers Control Room, Telemetry, Hazard and Classic, each once', () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids).toEqual(['control-room', 'telemetry', 'hazard', 'classic']);
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(THEMES.length);
  });

  it('keeps a known theme and falls back for anything else', () => {
    for (const t of THEMES) expect(themeOf(t.id)).toBe(t.id);
    expect(themeOf('neon')).toBe('control-room');
    expect(themeOf(undefined)).toBe('control-room');
    expect(themeOf(3)).toBe('control-room');
  });
});

describe('parseSettings', () => {
  it('gives the defaults when nothing is stored', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('gives the defaults when storage holds something unreadable', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('"hazard"')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps stored choices, including the theme', () => {
    const stored = { theme: 'hazard', sound: false, desktop: true, finished: false, comings: true };
    expect(parseSettings(JSON.stringify(stored))).toEqual(stored);
  });

  it('gives settings saved before themes existed the default theme', () => {
    const old = { sound: false, desktop: false, finished: true, comings: true };
    expect(parseSettings(JSON.stringify(old))).toEqual({ ...old, theme: 'control-room' });
  });

  it('puts back a removed theme or a wrong-typed flag to its default', () => {
    expect(parseSettings(JSON.stringify({ theme: 'gone', sound: 'yes' }))).toEqual(DEFAULT_SETTINGS);
  });
});
