import type { GuildState, Hero } from '@agent-guild/core';
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
}

export function VillageCanvas({ state, heroes, animate, selected, onSelect }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sprites, setSprites] = useState<Sprites | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<Selection | null>(null);

  // The animation loop reads these through refs so it never restarts on a state change.
  const stateRef = useRef(state);
  const viewRef = useRef<VillageView>({ selected, hovered });
  /** Heroes walking to a new building, keyed by hero id (live mode only). */
  const walkers = useRef(new Map<string, Walker>());
  /** Where each hero was last drawn, so a walk starts from there. */
  const shown = useRef(new Map<string, { x: number; y: number }>());
  /** Clock of the frame last drawn, for hit-testing heroes mid-walk. */
  const lastNow = useRef(0);
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    stateRef.current = state;
    viewRef.current = { selected, hovered };
    redraw.current();
  }, [state, selected, hovered]);

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

  // When a hero's target moves, start a walk from wherever it is drawn now.
  useEffect(() => {
    if (!animate) return;
    const now = performance.now();
    for (const [id, to] of heroPositions(state)) {
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
    return hitTest(stateRef.current, walkers.current, lastNow.current, x, y);
  };

  // The canvas is decoration for sighted users; this sentence carries the same facts, and
  // every hero and building can also be opened from the side panel with the keyboard.
  const summary =
    heroes.length === 0
      ? 'The village is empty.'
      : heroes.map((h) => `${h.name} at the ${BUILDINGS[h.location].label}`).join('; ') + '.';

  if (error) return <p role="alert">The village art did not load: {error}</p>;

  return (
    <canvas
      ref={canvas}
      className="village"
      width={VILLAGE_WIDTH}
      height={VILLAGE_HEIGHT}
      style={{ width: VILLAGE_WIDTH, height: VILLAGE_HEIGHT, cursor: hovered ? 'pointer' : 'default' }}
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
  );
}
