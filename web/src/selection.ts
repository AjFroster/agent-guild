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

/** Which side-panel tab is open, kept in `?tab=` so a reload keeps it. */
export type PanelTab = 'guild' | 'skills';

export function usePanelTab(): [PanelTab, (t: PanelTab) => void] {
  const [tab, setTab] = useState<PanelTab>(() =>
    new URLSearchParams(window.location.search).get('tab') === 'skills' ? 'skills' : 'guild',
  );
  const open = useCallback((t: PanelTab) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === 'skills') url.searchParams.set('tab', 'skills');
    else url.searchParams.delete('tab');
    window.history.replaceState(null, '', url);
  }, []);
  return [tab, open];
}

/** Which page is open: the village, or a building's (`?page=library`, `?page=forge`). */
export type Page = 'village' | 'library' | 'forge';

export function usePage(): [Page, (p: Page) => void] {
  const [page, setPage] = useState<Page>(() => {
    const p = new URLSearchParams(window.location.search).get('page');
    return p === 'library' || p === 'forge' ? p : 'village';
  });
  const open = useCallback((p: Page) => {
    setPage(p);
    const url = new URL(window.location.href);
    if (p !== 'village') url.searchParams.set('page', p);
    else url.searchParams.delete('page');
    window.history.replaceState(null, '', url);
  }, []);
  return [page, open];
}

/** A drawer over the map: a chat, a Town Crier report, the new-session form, or crowning a King. */
export type Drawer =
  { kind: 'chat'; id: string } | { kind: 'report'; date: string } | { kind: 'new' } | { kind: 'king' };

export function parseDrawer(value: string | null): Drawer | null {
  if (!value) return null;
  if (value === 'new') return { kind: 'new' };
  if (value === 'king') return { kind: 'king' };
  const [kind, ...rest] = value.split(':');
  const arg = rest.join(':');
  if (kind === 'chat' && /^[0-9a-f-]{36}$/i.test(arg)) return { kind: 'chat', id: arg };
  if (kind === 'report' && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return { kind: 'report', date: arg };
  return null;
}

const formatDrawer = (d: Drawer) =>
  d.kind === 'new' || d.kind === 'king' ? d.kind : d.kind === 'chat' ? `chat:${d.id}` : `report:${d.date}`;

/** The open drawer, kept in `?open=` like the selection, so a reload keeps the chat open. */
export function useDrawer(): [Drawer | null, (d: Drawer | null) => void] {
  const [drawer, setDrawer] = useState<Drawer | null>(() =>
    parseDrawer(new URLSearchParams(window.location.search).get('open')),
  );
  const open = useCallback((d: Drawer | null) => {
    setDrawer(d);
    const url = new URL(window.location.href);
    if (d) url.searchParams.set('open', formatDrawer(d));
    else url.searchParams.delete('open');
    window.history.replaceState(null, '', url);
  }, []);
  return [drawer, open];
}
