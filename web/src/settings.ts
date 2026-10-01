import { useCallback, useState } from 'react';

/**
 * Per-browser preferences. They live in localStorage because they belong to this viewer
 * on this machine; storage can be missing or throw (private windows, blocked site data),
 * so every access is guarded and the defaults always work.
 */

export interface Settings {
  /** Play a short chime with notices. */
  sound: boolean;
  /** Also raise a desktop notification while the tab is in the background. */
  desktop: boolean;
  /** Notice when a session finishes a turn. */
  finished: boolean;
  /** Notice when a session joins or leaves. */
  comings: boolean;
}

export const DEFAULT_SETTINGS: Settings = { sound: true, desktop: false, finished: true, comings: false };

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

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(() => read(KEY, DEFAULT_SETTINGS));
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
