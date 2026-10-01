import { useEffect, useRef, useState } from 'react';

import { type Art, SCENE_HEIGHT, SCENE_WIDTH, loadArt } from './scene.ts';

/**
 * A building's scene on a canvas, for any building page: it loads the scene art, draws
 * `model` with `draw` (every frame when animating, once in demo mode), and turns clicks
 * into whatever `pick` says is there.
 */
export function SceneCanvas<M, P>({
  model,
  animate,
  draw,
  pick,
  same,
  onPick,
  label,
  testId,
}: {
  model: M;
  /** Live mode animates; demo mode draws one frame so screenshots are stable. */
  animate: boolean;
  draw: (ctx: CanvasRenderingContext2D, art: Art, model: M, nowMs: number, hovered: P | null) => void;
  pick: (model: M, x: number, y: number) => P | null;
  same: (a: P | null, b: P | null) => boolean;
  onPick: (p: P) => void;
  /** What the picture shows, for screen readers. */
  label: string;
  testId: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [art, setArt] = useState<Art | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<P | null>(null);
  // The loop reads these through refs so it never restarts on a change.
  const modelRef = useRef(model);
  const hoveredRef = useRef(hovered);
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    modelRef.current = model;
    hoveredRef.current = hovered;
    redraw.current();
  }, [model, hovered]);

  useEffect(() => {
    let cancelled = false;
    loadArt().then(
      (a) => !cancelled && setArt(a),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || !art) return;
    const scale = window.devicePixelRatio || 1;
    el.width = SCENE_WIDTH * scale;
    el.height = SCENE_HEIGHT * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (!animate) {
      redraw.current = () => draw(ctx, art, modelRef.current, 0, hoveredRef.current);
      redraw.current();
      el.dataset.ready = 'true';
      return () => {
        redraw.current = () => {};
      };
    }
    let frame = 0;
    const tick = (now: number) => {
      draw(ctx, art, modelRef.current, now, hoveredRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    el.dataset.ready = 'true';
    return () => cancelAnimationFrame(frame);
  }, [art, animate, draw]);

  if (error) return <p role="alert">The scene art did not load: {error}</p>;

  const at = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return pick(
      model,
      ((e.clientX - box.left) / box.width) * SCENE_WIDTH,
      ((e.clientY - box.top) / box.height) * SCENE_HEIGHT,
    );
  };
  return (
    <canvas
      ref={canvas}
      className="village scene"
      width={SCENE_WIDTH}
      height={SCENE_HEIGHT}
      style={{ cursor: hovered ? 'pointer' : 'default' }}
      role="img"
      aria-label={label}
      data-testid={testId}
      onMouseMove={(e) => {
        const hit = at(e);
        if (!same(hit, hovered)) setHovered(hit);
      }}
      onMouseLeave={() => setHovered(null)}
      onClick={(e) => {
        const hit = at(e);
        if (hit) onPick(hit);
      }}
    />
  );
}
