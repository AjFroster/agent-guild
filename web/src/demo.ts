import { EventStream, type GuildEvent } from '@agent-guild/core';

/**
 * Demo mode: replay a recorded, scrubbed event stream and freeze at `t`.
 *
 * This is what the browser tests and CI screenshots run against. A fixed stream and a
 * fixed moment give the same frame on every run, with no live Claude session involved.
 */

const files = import.meta.glob<GuildEvent[]>('../../fixtures/*.json', { eager: true, import: 'default' });

export const fixtures: Record<string, GuildEvent[]> = Object.fromEntries(
  Object.entries(files).map(([path, raw]) => {
    const name = path
      .split('/')
      .pop()!
      .replace(/\.json$/, '');
    // Parse rather than trust: a hand-edited fixture that breaks the schema should fail
    // loudly here, not render a half-built guild that a screenshot then blesses.
    return [name, EventStream.parse(raw)];
  }),
);

export interface DemoRequest {
  fixture: string;
  events: GuildEvent[];
  /** Replay up to this time. Infinity means the whole stream. */
  t: number;
}

export function readDemoRequest(search: string): DemoRequest | { error: string } | null {
  const params = new URLSearchParams(search);
  const fixture = params.get('demo');
  if (fixture === null) return null;
  const events = fixtures[fixture];
  if (!events) return { error: `No demo fixture called "${fixture}".` };
  const rawT = params.get('t');
  const t = rawT === null ? Infinity : Number(rawT);
  if (!Number.isFinite(t) && rawT !== null) return { error: `"t" must be a number of seconds.` };
  return { fixture, events, t };
}
