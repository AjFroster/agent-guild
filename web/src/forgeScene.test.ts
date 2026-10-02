import { type GuildEvent, replay } from '@agent-guild/core';
import { describe, expect, it } from 'vitest';

import {
  ANVIL,
  RACK_SLOTS,
  type ForgeView,
  describeForge,
  forgeModel,
  forgePick,
  rackShown,
  seatRect,
} from './forgeScene.ts';

const smith = (id: string, t = 0): GuildEvent[] => [
  { t, session: id, type: 'session_start', name: 'Blacksmith' },
  { t, session: id, type: 'smith' },
];
const piece = (n: number) => ({
  id: `o${n}`,
  name: `piece-${n}`,
  kind: 'skill' as const,
  verdict: 'ready' as const,
});
const view = (n: number): ForgeView => ({
  rack: Array.from({ length: n }, (_, i) => piece(i)),
  atLibrary: 1,
  forging: true,
  queued: 0,
});
const centre = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;

describe('the Forge scene', () => {
  const state = replay([...smith('b'), { t: 1, session: 'b', type: 'tool', tool: 'Read' }]);

  it('puts the newest Blacksmith at the anvil; the Armorer is not hired yet', () => {
    const model = forgeModel(state, null);
    expect(model.seats.map((s) => [s.role, s.hero?.id ?? null, s.state])).toEqual([
      ['Blacksmith', 'b', 'working'],
      ['Armorer', null, 'unhired'],
    ]);
  });

  it('hangs up to four pieces on the rack, folding the rest into "+N"', () => {
    expect(rackShown(view(4))).toHaveLength(4);
    expect(rackShown(view(6))).toEqual([piece(0), piece(1), piece(2), { more: 3 }]);
  });

  it('says what a click lands on', () => {
    const model = forgeModel(state, view(2));
    expect(forgePick(model, ...centre(seatRect('Blacksmith')))).toEqual({
      kind: 'smith',
      role: 'Blacksmith',
      id: 'b',
    });
    expect(forgePick(model, ...centre(seatRect('Armorer')))).toBeNull();
    expect(forgePick(model, ...centre(RACK_SLOTS[1]!))).toEqual({ kind: 'piece', id: 'o1' });
    expect(forgePick(model, ...centre(RACK_SLOTS[3]!))).toEqual({ kind: 'rack' });
    expect(forgePick(model, ANVIL.x + ANVIL.w - 5, ANVIL.y + 5)).toEqual({ kind: 'anvil' });
  });

  it('describes itself for screen readers', () => {
    expect(describeForge(forgeModel(state, view(1)))).toBe(
      'The Forge: the Blacksmith is at the anvil; 1 piece waits for you on the rack.',
    );
  });
});
