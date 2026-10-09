import { useCallback, useEffect, useState } from 'react';

/**
 * Per-browser preferences. They live in localStorage because they belong to this viewer
 * on this machine; storage can be missing or throw (private windows, blocked site data),
 * so every access is guarded and the defaults always work.
 */

/** The looks the guild's panels, chat and forms can wear. The village is drawn the same in all. */
export const THEMES = [
  { id: 'control-room', name: 'Control Room', note: 'Graphite, hairlines and amber' },
  { id: 'telemetry', name: 'Telemetry', note: 'All mono, cyan on black' },
  { id: 'hazard', name: 'Hazard', note: 'Concrete, black rules, safety yellow' },
  { id: 'classic', name: 'Classic', note: 'The original look' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'control-room';

/** A stored theme name, or the default when it is missing or no longer exists. */
export function themeOf(value: unknown): ThemeId {
  return THEMES.some((t) => t.id === value) ? (value as ThemeId) : DEFAULT_THEME;
}

export interface Settings {
  /** How the panels, chat and forms look (see themes.css). */
  theme: ThemeId;
  /** Play a short chime with notices. */
  sound: boolean;
  /** Also raise a desktop notification while the tab is in the background. */
  desktop: boolean;
  /** Notice when a session finishes a turn. */
  finished: boolean;
  /** Notice when a session joins or leaves. */
  comings: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME,
  sound: true,
  desktop: false,
  finished: true,
  comings: false,
};

const KEY = 'agent-guild:settings';
const HINT_KEY = 'agent-guild:hint-dismissed';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : { ...fallback, ...(JSON.parse(raw) as object) };
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not persisted; the choice still applies for this page.
  }
}

/** Stored settings over the defaults, with anything unrecognised put back to its default. */
export function parseSettings(raw: string | null): Settings {
  let stored: Partial<Record<keyof Settings, unknown>> = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (parsed && typeof parsed === 'object') stored = parsed;
  } catch {
    // Unreadable: the defaults stand.
  }
  const flag = (key: Exclude<keyof Settings, 'theme'>) =>
    typeof stored[key] === 'boolean' ? stored[key] : DEFAULT_SETTINGS[key];
  return {
    theme: themeOf(stored.theme),
    sound: flag('sound'),
    desktop: flag('desktop'),
    finished: flag('finished'),
    comings: flag('comings'),
  };
}

export function readSettings(): Settings {
  try {
    return parseSettings(window.localStorage.getItem(KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Puts the theme on <html>, where themes.css picks it up. */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(readSettings);
  useEffect(() => applyTheme(settings.theme), [settings.theme]);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      write(KEY, next);
      return next;
    });
  }, []);
  return [settings, update];
}

export function useHint(): [boolean, () => void] {
  const [dismissed, setDismissed] = useState<boolean>(() => read(HINT_KEY, { v: false }).v);
  const dismiss = useCallback(() => {
    setDismissed(true);
    write(HINT_KEY, { v: true });
  }, []);
  return [!dismissed, dismiss];
}
