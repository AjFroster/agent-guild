import { EventStream, type GuildEvent } from '@agent-guild/core';
import { useEffect, useState } from 'react';

import type { ChatInfo, PortalStatus } from './api.ts';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'unauthorized';

/** Server announcements that ride the same stream: chat list, Town Crier, control on/off. */
export interface Announcements {
  control: { enabled: boolean; allowBypass?: boolean } | null;
  /** The King's session id, once one is crowned. */
  king: { id: string | null } | null;
  /** Reviewed skills waiting on the user, and a counter that ticks when the Archive changes. */
  skills: { waiting: number; version: number };
  /** Forged pieces waiting on the user, and a counter that ticks when the Forge changes. */
  forge: { waiting: number; version: number };
  /**
   * How many of the utilities' runs have failed, the latest failure, and a counter that
   * ticks when a run ends.
   */
  runs: { failed: number; last: { utility: 'library' | 'forge'; detail: string } | null; version: number };
  /** Services listening on local ports, kept current by the Portal Keeper. */
  portals: PortalStatus | null;
  chats: ChatInfo[];
  crierVersion: number;
}

/**
 * Follows the local server's event stream. The server sends every event so far as a
 * `snapshot`, then new ones as `events`. EventSource reconnects on its own after a drop,
 * and the fresh snapshot replaces what we had, so a reconnect cannot double-count XP.
 */
export function useLiveEvents(token: string): {
  events: GuildEvent[];
  status: LiveStatus;
  announcements: Announcements;
} {
  const [events, setEvents] = useState<GuildEvent[]>([]);
  const [announcements, setAnnouncements] = useState<Announcements>({
    control: null,
    king: null,
    skills: { waiting: 0, version: 0 },
    forge: { waiting: 0, version: 0 },
    runs: { failed: 0, last: null, version: 0 },
    portals: null,
    chats: [],
    crierVersion: 0,
  });
  const [status, setStatus] = useState<LiveStatus>('connecting');

  useEffect(() => {
    const url = `/api/events?token=${encodeURIComponent(token)}`;
    const source = new EventSource(url);
    let opened = false;

    const parse = (data: string): GuildEvent[] => {
      const result = EventStream.safeParse(JSON.parse(data));
      return result.success ? result.data : [];
    };

    const json = (e: Event) => JSON.parse((e as MessageEvent<string>).data) as unknown;
    source.addEventListener('control', (e) =>
      setAnnouncements((a) => ({ ...a, control: json(e) as Announcements['control'] })),
    );
    source.addEventListener('king', (e) =>
      setAnnouncements((a) => ({ ...a, king: json(e) as Announcements['king'] })),
    );
    source.addEventListener('skills', (e) =>
      setAnnouncements((a) => ({
        ...a,
        skills: { waiting: (json(e) as { waiting: number }).waiting, version: a.skills.version + 1 },
      })),
    );
    source.addEventListener('forge', (e) =>
      setAnnouncements((a) => ({
        ...a,
        forge: { waiting: (json(e) as { waiting: number }).waiting, version: a.forge.version + 1 },
      })),
    );
    source.addEventListener('portals', (e) =>
      setAnnouncements((a) => ({ ...a, portals: json(e) as PortalStatus })),
    );
    source.addEventListener('chats', (e) =>
      setAnnouncements((a) => ({ ...a, chats: json(e) as ChatInfo[] })),
    );
    source.addEventListener('runs', (e) =>
      setAnnouncements((a) => ({
        ...a,
        runs: { ...(json(e) as Omit<Announcements['runs'], 'version'>), version: a.runs.version + 1 },
      })),
    );
    // The Town Crier's details are fetched on demand; this only says they changed.
    source.addEventListener('crier', () =>
      setAnnouncements((a) => ({ ...a, crierVersion: a.crierVersion + 1 })),
    );

    source.addEventListener('snapshot', (e) => {
      opened = true;
      setStatus('live');
      setEvents(parse((e as MessageEvent<string>).data));
    });
    source.addEventListener('events', (e) => {
      const next = parse((e as MessageEvent<string>).data);
      if (next.length > 0) setEvents((prev) => [...prev, ...next]);
    });
    source.onerror = () => {
      if (!opened) {
        // EventSource hides the status code, so ask once whether the token is the problem
        // rather than retrying a request that can never succeed.
        void fetch(url)
          .then((r) => {
            if (r.status === 401) {
              source.close();
              setStatus('unauthorized');
            }
            void r.body?.cancel();
          })
          .catch(() => {
            // Server down: EventSource keeps retrying, and the status already says so.
          });
      }
      setStatus((s) => (s === 'unauthorized' ? s : 'reconnecting'));
    };
    return () => source.close();
  }, [token]);

  return { events, status, announcements };
}
