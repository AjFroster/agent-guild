import type { GuildState, Hero } from '@agent-guild/core';

/**
 * What is worth interrupting the user for, worked out by comparing two guild states.
 * Pure, so it can be tested without a browser; useNotices() turns the result into toasts,
 * sounds and desktop notifications.
 *
 * Only leaders (main sessions) raise "finished", "arrived" and "left". Sub-agents finish
 * constantly as part of their leader's work and would bury the notices that matter.
 * "Needs you" is raised for anyone, since a waiting sub-agent blocks its leader too.
 */

export type NoticeKind = 'needs_you' | 'finished' | 'arrived' | 'left';

export interface Notice {
  /** Stable for one occurrence, so the same change never toasts twice. */
  key: string;
  kind: NoticeKind;
  heroId: string;
  text: string;
}

const present = (h: Hero | undefined): boolean => h !== undefined && h.status !== 'gone';

export function diffNotices(prev: GuildState | null, next: GuildState): Notice[] {
  // The first snapshot describes the past, not something that just happened.
  if (prev === null) return [];
  const notices: Notice[] = [];

  for (const id of next.order) {
    const before = prev.heroes[id];
    const after = next.heroes[id]!;
    const leader = after.parentId === null;

    if (present(after) && after.status === 'needs_you' && before?.status !== 'needs_you') {
      notices.push({
        key: `needs_you:${id}:${after.lastActiveAt}`,
        kind: 'needs_you',
        heroId: id,
        text: `${after.name} needs you`,
      });
    }
    if (!leader) continue;
    if (present(after) && !present(before)) {
      notices.push({
        key: `arrived:${id}:${after.startedAt}`,
        kind: 'arrived',
        heroId: id,
        text: `${after.name} joined the guild`,
      });
    }
    if (present(before) && !present(after)) {
      notices.push({
        key: `left:${id}:${after.lastActiveAt}`,
        kind: 'left',
        heroId: id,
        text: `${after.name} left the guild`,
      });
    }
    if (
      before &&
      present(before) &&
      present(after) &&
      after.turns > before.turns &&
      after.status === 'idle'
    ) {
      notices.push({
        key: `finished:${id}:${after.turns}`,
        kind: 'finished',
        heroId: id,
        text: `${after.name} finished a turn`,
      });
    }
  }
  return notices;
}
