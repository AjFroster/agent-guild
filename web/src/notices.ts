import type { GuildState, Hero } from '@agent-guild/core';

/**
 * What is worth interrupting the user for, worked out by comparing two guild states.
 * Pure, so it can be tested without a browser; useNotices() turns the result into toasts,
 * sounds and desktop notifications.
 *
 * Only leaders (main sessions) raise "finished", "arrived" and "left", and not the guild's
 * own helpers (librarians, smiths). Sub-agents and helpers finish constantly as part of
 * their work and would bury the notices that matter; a helper's result reaches the user as
 * a decision (skill_ready, piece_ready) instead.
 * "Needs you" is raised for anyone, since a waiting sub-agent blocks its leader too.
 */

export type NoticeKind = 'needs_you' | 'finished' | 'arrived' | 'left' | 'skill_ready' | 'piece_ready';

export interface Notice {
  /** Stable for one occurrence, so the same change never toasts twice. */
  key: string;
  kind: NoticeKind;
  /** The hero it is about; null for a decision in the inbox (a skill or a piece). */
  heroId: string | null;
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
    const leader = after.parentId === null && !after.librarian && !after.smith;

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

/** What the server announces waits on the user, and how often it has announced. */
export interface Waiting {
  skills: { waiting: number; version: number };
  forge: { waiting: number; version: number };
}

/**
 * A reviewed skill or a forged piece newly waiting on the user. The server announces its
 * counts once on connecting (version 1), which is history; after that, a count going up is
 * news.
 */
export function diffWaiting(prev: Waiting | null, next: Waiting): Notice[] {
  if (prev === null) return [];
  const notices: Notice[] = [];
  const grew = (a: Waiting['skills'], b: Waiting['skills']) => a.version > 0 && b.waiting > a.waiting;
  if (grew(prev.skills, next.skills)) {
    const n = next.skills.waiting - prev.skills.waiting;
    notices.push({
      key: `skill_ready:${next.skills.version}`,
      kind: 'skill_ready',
      heroId: null,
      text:
        n === 1 ? 'A reviewed skill waits for your approval' : `${n} reviewed skills wait for your approval`,
    });
  }
  if (grew(prev.forge, next.forge)) {
    const n = next.forge.waiting - prev.forge.waiting;
    notices.push({
      key: `piece_ready:${next.forge.version}`,
      kind: 'piece_ready',
      heroId: null,
      text: n === 1 ? 'A forged piece is ready to install' : `${n} forged pieces are ready to install`,
    });
  }
  return notices;
}
