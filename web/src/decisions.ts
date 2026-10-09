import { type GuildState, roster } from '@agent-guild/core';

import type { Battle } from '@agent-guild/core';

import type { ArchiveEntry, ForgeOrder, WarInfo } from './api.ts';

/**
 * Everything that waits on the user, in one list (docs/SHARPEN.md, phase B): a Knight's
 * question, a reviewed skill to approve, a forged piece to install, a battle that stalled
 * or whose outcome the guild cannot tell. Pure, so tests can
 * check what the inbox shows without a browser; the Needs-you tab draws it.
 */

export type Decision =
  | { kind: 'question'; key: string; at: number; heroId: string; name: string; leader: boolean }
  | { kind: 'skill'; key: string; at: number; entry: ArchiveEntry }
  | { kind: 'piece'; key: string; at: number; order: ForgeOrder }
  | { kind: 'battle'; key: string; at: number; war: { id: string; name: string }; battle: Battle };

export function decisions(
  state: GuildState,
  entries: readonly ArchiveEntry[] = [],
  orders: readonly ForgeOrder[] = [],
  wars: readonly WarInfo[] = [],
): Decision[] {
  const all: Decision[] = [
    ...roster(state)
      .filter((h) => h.status === 'needs_you')
      .map((h): Decision => ({
        kind: 'question',
        key: `question:${h.id}`,
        at: h.lastActiveAt,
        heroId: h.id,
        name: h.name,
        leader: h.parentId === null,
      })),
    ...entries
      .filter((e) => e.status === 'reviewed')
      .map((e): Decision => ({
        kind: 'skill',
        key: `skill:${e.id}`,
        at: e.review?.reviewedAt ?? e.foundAt,
        entry: e,
      })),
    ...orders
      .filter((o) => o.status === 'reviewed')
      .map((o): Decision => ({
        kind: 'piece',
        key: `piece:${o.id}`,
        at: o.review?.reviewedAt ?? o.createdAt,
        order: o,
      })),
    // A stalled battle, or a branch gone with nobody saying how it ended (docs/WARS.md).
    ...wars
      .filter((w) => !w.archived)
      .flatMap((w) =>
        w.battles
          .filter((b) => b.state === 'stalled' || b.state === 'unclear')
          .map((b): Decision => ({
            kind: 'battle',
            key: `battle:${w.id}:${b.branch}`,
            at: b.lastActivityAt ?? 0,
            war: { id: w.id, name: w.name },
            battle: b,
          })),
      ),
  ];
  return all.sort((a, b) => b.at - a.at);
}

/**
 * How many decisions wait, from the counts the server announces: the badge, which must be
 * right before the inbox has loaded anything.
 */
export const waitingCount = (state: GuildState, skills: number, pieces: number, battles = 0) =>
  roster(state).filter((h) => h.status === 'needs_you').length + skills + pieces + battles;
