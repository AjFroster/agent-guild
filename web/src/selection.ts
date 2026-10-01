import { type GuildState, LOCATIONS, type Location } from '@agent-guild/core';
import { useCallback, useEffect, useState } from 'react';

import type { Selection } from './village.ts';

/**
 * What the user has clicked, kept in the URL as `?select=hero:<id>` or
 * `?select=building:<name>`. The URL makes a selection shareable and reloadable, and lets
 * a browser test open a panel directly to screenshot it.
 */

export function parseSelection(value: string | null): Selection | null {
  if (!value) return null;
  const [kind, ...rest] = value.split(':');
  const id = rest.join(':');
  if (kind === 'hero' && id) return { kind: 'hero', id };
  if (kind === 'building' && (LOCATIONS as readonly string[]).includes(id)) {
    return { kind: 'building', id: id as Location };
  }
  return null;
}

export const formatSelection = (s: Selection) => `${s.kind}:${s.id}`;

/** A hero selection only counts while that hero is still in the guild. */
export function resolveSelection(state: GuildState, s: Selection | null): Selection | null {
  if (s?.kind === 'hero') {
    const hero = state.heroes[s.id];
    return hero && hero.status !== 'gone' ? s : null;
  }
  return s;
}

export function useSelection(): [Selection | null, (s: Selection | null) => void] {
  const [selection, setSelection] = useState<Selection | null>(() =>
    parseSelection(new URLSearchParams(window.location.search).get('select')),
  );

  const select = useCallback((s: Selection | null) => {
    setSelection(s);
    const url = new URL(window.location.href);
    if (s) url.searchParams.set('select', formatSelection(s));
    else url.searchParams.delete('select');
    // replaceState, not pushState: clicking around the map should not fill the back button.
    window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);

  return [selection, select];
}
