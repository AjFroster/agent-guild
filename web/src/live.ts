import { EventStream, type GuildEvent } from '@agent-guild/core';
import { useEffect, useState } from 'react';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'unauthorized';

/**
 * Follows the local server's event stream. The server sends every event so far as a
 * `snapshot`, then new ones as `events`. EventSource reconnects on its own after a drop,
 * and the fresh snapshot replaces what we had, so a reconnect cannot double-count XP.
 */
export function useLiveEvents(token: string): { events: GuildEvent[]; status: LiveStatus } {
  const [events, setEvents] = useState<GuildEvent[]>([]);
  const [status, setStatus] = useState<LiveStatus>('connecting');

  useEffect(() => {
    const url = `/api/events?token=${encodeURIComponent(token)}`;
    const source = new EventSource(url);
    let opened = false;

    const parse = (data: string): GuildEvent[] => {
      const result = EventStream.safeParse(JSON.parse(data));
      return result.success ? result.data : [];
    };

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

  return { events, status };
}
