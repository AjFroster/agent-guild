import { type GuildState, type Hero, rankOf } from '@agent-guild/core';
import { useEffect, useRef, useState } from 'react';

import {
  BUILDINGS,
  type Selection,
  type Sprites,
  VILLAGE_HEIGHT,
  VILLAGE_WIDTH,
  type VillageView,
  type Walker,
  drawVillage,
  heroPositions,
  hitTest,
  loadSprites,
  sameSelection,
  walkerPosition,
} from './village.ts';

/** The live guild's clock, in epoch seconds like event times. Demo mode passes its own. */
const wallClock = () => Date.now() / 1000;

/** Loaded once per page; every Village shares the same images. */
let spritesPromise: Promise<Sprites> | null = null;
const getSprites = () => (spritesPromise ??= loadSprites());

interface Props {
  state: GuildState;
  heroes: Hero[];
  /** Live mode: animate and walk. Demo mode: one frozen frame. */
  animate: boolean;
  selected: Selection | null;
  onSelect: (s: Selection | null) => void;
  /**
   * Open a chat with a hero, when it can be talked to (live mode, a session the guild can
   * resume). A "Talk" button then sits beside the selected Knight and beside any Knight
   * waiting on the user: the two moments a conversation is wanted.
   */
  onTalk?: ((id: string) => void) | undefined;
  canTalk?: ((hero: Hero) => boolean) | undefined;
  /** Demo mode's frozen moment (epoch seconds of the replay); live mode reads the clock. */
  clock?: number | undefined;
}

export function VillageCanvas({ state, heroes, animate, selected, onSelect, onTalk, canTalk, clock }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sprites, setSprites] = useState<Sprites | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<Selection | null>(null);

  // The animation loop reads these through refs so it never restarts on a state change.
  const stateRef = useRef(state);
  const viewRef = useRef<VillageView>({ selected, hovered, clock });
  /** Heroes walking to a new building, keyed by hero id (live mode only). */
  const walkers = useRef(new Map<string, Walker>());
  /** Where each hero was last drawn, so a walk starts from there. */
  const shown = useRef(new Map<string, { x: number; y: number }>());
  /** Clock of the frame last drawn, for hit-testing heroes mid-walk. */
  const lastNow = useRef(0);
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    stateRef.current = state;
    viewRef.current = { selected, hovered, clock: animate ? wallClock() : clock };
    redraw.current();
  }, [state, selected, hovered, clock, animate]);

  useEffect(() => {
    let cancelled = false;
    getSprites().then(
      (s) => !cancelled && setSprites(s),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * When a hero's target moves, start a walk from wherever it is drawn now (live mode). Run
   * on every state change and every frame: a place can change with time alone, as when a
   * Knight's audience before the throne ends and it leaves for work.
   */
  const retarget = useRef((now: number) => {
    for (const [id, to] of heroPositions(stateRef.current, wallClock())) {
      const from = shown.current.get(id);
      const current = walkers.current.get(id);
      if (!from) {
        shown.current.set(id, to);
        continue;
      }
      if (current && current.toX === to.x && current.toY === to.y) continue;
      if (!current && from.x === to.x && from.y === to.y) continue;
      walkers.current.set(id, { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, startMs: now });
    }
  });

  useEffect(() => {
    if (animate) retarget.current(performance.now());
  }, [state, animate]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || !sprites) return;
    const scale = window.devicePixelRatio || 1;
    el.width = VILLAGE_WIDTH * scale;
    el.height = VILLAGE_HEIGHT * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    if (!animate) {
      // Demo mode: frozen clock, no walkers, redrawn only when selection or hover changes.
      redraw.current = () => drawVillage(ctx, stateRef.current, sprites, 0, new Map(), viewRef.current);
      redraw.current();
      el.dataset.ready = 'true';
      return () => {
        redraw.current = () => {};
      };
    }

    let frame = 0;
    const tick = (now: number) => {
      lastNow.current = now;
      retarget.current(now);
      viewRef.current = { ...viewRef.current, clock: wallClock() };
      for (const [id, w] of walkers.current) {
        const pos = walkerPosition(w, now);
        shown.current.set(id, { x: pos.x, y: pos.y });
        if (!pos.moving) walkers.current.delete(id);
      }
      drawVillage(ctx, stateRef.current, sprites, now, walkers.current, viewRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    el.dataset.ready = 'true';
    return () => cancelAnimationFrame(frame);
  }, [sprites, animate]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VILLAGE_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * VILLAGE_HEIGHT;
    return hitTest(stateRef.current, walkers.current, lastNow.current, x, y, viewRef.current.clock);
  };

  // The canvas is decoration for sighted users; this sentence carries the same facts, and
  // every hero and building can also be opened from the side panel with the keyboard.
  const summary =
    heroes.length === 0
      ? 'The village is empty.'
      : heroes.map((h) => `${h.name} at the ${BUILDINGS[h.location].label}`).join('; ') + '.';

  if (error) return <p role="alert">The village art did not load: {error}</p>;

  // Live mode passes no clock here, so a Knight's button waits for it at its post.
  const positions = onTalk ? heroPositions(state, clock) : null;
  const talkable = onTalk
    ? heroes.filter(
        (h) =>
          (rankOf(h) === 'knight' || rankOf(h) === 'king') &&
          (canTalk?.(h) ?? true) &&
          (h.status === 'needs_you' || sameSelection(selected, { kind: 'hero', id: h.id })),
      )
    : [];

  return (
    <div className="village-wrap">
      <canvas
        ref={canvas}
        className="village"
        width={VILLAGE_WIDTH}
        height={VILLAGE_HEIGHT}
        style={{ cursor: hovered ? 'pointer' : 'default' }}
        role="img"
        aria-label={summary}
        data-testid="village"
        onMouseMove={(e) => {
          const hit = pick(e);
          if (!sameSelection(hit, hovered)) setHovered(hit);
        }}
        onMouseLeave={() => setHovered(null)}
        onClick={(e) => {
          const hit = pick(e);
          // Clicking empty grass, or the thing already open, closes the panel.
          onSelect(hit && !sameSelection(hit, selected) ? hit : null);
        }}
      />
      {talkable.map((h) => {
        const at = positions!.get(h.id);
        if (!at) return null;
        const k = h.crowned ? 1.3 : 1;
        return (
          <button
            key={h.id}
            type="button"
            className={`talk-pill${h.status === 'needs_you' ? ' talk-urgent' : ''}`}
            // Percentages, so the button stays beside its Knight however wide the map is drawn.
            style={{
              left: `${((at.x + 30 * k) / VILLAGE_WIDTH) * 100}%`,
              top: `${((at.y - 16) / VILLAGE_HEIGHT) * 100}%`,
            }}
            onClick={() => onTalk!(h.id)}
            aria-label={`Talk to ${h.name}`}
            data-testid={`talk-${h.id}`}
          >
            Talk
          </button>
        );
      })}
    </div>
  );
}
