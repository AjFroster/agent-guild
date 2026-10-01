import type { ReactNode } from 'react';

import type { Art } from './scene.ts';
import { SceneCanvas } from './SceneCanvas.tsx';

/**
 * The shell every building's page fills (docs/BUILDING-PAGES.md): a way back to the
 * village, the building's name on a ribbon, its Tiny Swords scene, a line on what can be
 * clicked, then the page's own cards as children.
 */
export function BuildingPage<M, P>({
  id,
  title,
  ribbon,
  onBack,
  scene,
  hint,
  children,
}: {
  /** The building: names the page's test ids (`<id>-page`, `<id>-back`, `<id>-scene`). */
  id: string;
  title: string;
  ribbon: 'yellow' | 'red' | 'blue';
  onBack: () => void;
  scene: {
    model: M;
    animate: boolean;
    draw: (ctx: CanvasRenderingContext2D, art: Art, model: M, nowMs: number, hovered: P | null) => void;
    pick: (model: M, x: number, y: number) => P | null;
    same: (a: P | null, b: P | null) => boolean;
    onPick: (p: P) => void;
    /** What the picture shows, for screen readers. */
    label: string;
  };
  hint: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      className={id === 'library' ? 'library-page' : `library-page ${id}-page`}
      data-testid={`${id}-page`}
      aria-label={title}
    >
      <div className="library-head">
        <button type="button" className="ts-button" onClick={onBack} data-testid={`${id}-back`}>
          ← Back to the village
        </button>
        <h2 className={`ts-ribbon ts-ribbon-${ribbon}`}>{title}</h2>
      </div>
      <SceneCanvas {...scene} testId={`${id}-scene`} />
      <p className="muted small library-hint">{hint}</p>
      {children}
    </section>
  );
}
