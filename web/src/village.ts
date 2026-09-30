import type { GuildState, Hero, Location } from '@agent-guild/core';
import { roster } from '@agent-guild/core';

/** Canvas drawing for the village. Pure function of state: no clock, no randomness. */

export const VILLAGE_WIDTH = 760;
export const VILLAGE_HEIGHT = 520;

interface Building {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export const BUILDINGS: Record<Location, Building> = {
  library: { label: 'Library', x: 30, y: 30, w: 220, h: 200, color: '#3b6ea5' },
  forge: { label: 'Forge', x: 270, y: 30, w: 220, h: 200, color: '#b8562b' },
  arena: { label: 'Arena', x: 510, y: 30, w: 220, h: 200, color: '#8a3d8f' },
  tower: { label: 'Tower', x: 30, y: 290, w: 220, h: 200, color: '#2f8a7a' },
  guildhall: { label: 'Guildhall', x: 270, y: 290, w: 460, h: 200, color: '#6b6f2a' },
};

export const COLORS = {
  ground: '#141a12',
  path: '#232c1f',
  ink: '#f1efe6',
  muted: '#b9b6a8',
  beacon: '#ffcc33',
};

const HERO_RADIUS = 22;

/** Where each hero stands: a grid of slots inside its building, in roster order. */
export function heroPositions(state: GuildState): Map<string, { x: number; y: number }> {
  const byBuilding = new Map<Location, Hero[]>();
  for (const hero of roster(state)) {
    byBuilding.set(hero.location, [...(byBuilding.get(hero.location) ?? []), hero]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [location, heroes] of byBuilding) {
    const b = BUILDINGS[location];
    const cols = Math.max(1, Math.floor((b.w - 20) / 64));
    heroes.forEach((hero, i) => {
      positions.set(hero.id, {
        x: b.x + 42 + (i % cols) * 64,
        y: b.y + 88 + Math.floor(i / cols) * 64,
      });
    });
  }
  return positions;
}

export function drawVillage(ctx: CanvasRenderingContext2D, state: GuildState): void {
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, 0, VILLAGE_WIDTH, VILLAGE_HEIGHT);

  // Paths between the buildings, so the map reads as one place rather than five boxes.
  ctx.fillStyle = COLORS.path;
  ctx.fillRect(0, 245, VILLAGE_WIDTH, 30);
  ctx.fillRect(255, 0, 10, VILLAGE_HEIGHT);
  ctx.fillRect(495, 0, 10, 245);

  for (const b of Object.values(BUILDINGS)) {
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.28;
    roundRect(ctx, b.x, b.y, b.w, b.h, 14);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 3;
    roundRect(ctx, b.x, b.y, b.w, b.h, 14);
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(b.label, b.x + 14, b.y + 12);
  }

  const positions = heroPositions(state);

  // Party lines first, so heroes draw over them.
  ctx.strokeStyle = COLORS.muted;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  for (const hero of roster(state)) {
    const from = hero.parentId ? positions.get(hero.parentId) : undefined;
    const to = positions.get(hero.id);
    if (from && to) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  for (const hero of roster(state)) {
    const pos = positions.get(hero.id);
    if (pos) drawHero(ctx, hero, pos.x, pos.y);
  }
}

function drawHero(ctx: CanvasRenderingContext2D, hero: Hero, x: number, y: number): void {
  const r = hero.parentId ? HERO_RADIUS - 5 : HERO_RADIUS;

  if (hero.status === 'needs_you') {
    ctx.strokeStyle = COLORS.beacon;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COLORS.beacon;
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('!', x, y - r - 10);
  }

  ctx.fillStyle = hero.status === 'idle' ? '#5d6157' : '#e9e4d0';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#141a12';
  ctx.font = `700 ${hero.parentId ? 14 : 18}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hero.name.slice(0, 1).toUpperCase(), x, y + 1);

  // Level badge.
  ctx.fillStyle = COLORS.beacon;
  ctx.beginPath();
  ctx.arc(x + r * 0.75, y + r * 0.75, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#141a12';
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillText(String(hero.level), x + r * 0.75, y + r * 0.75 + 0.5);

  ctx.fillStyle = COLORS.ink;
  ctx.font = '500 12px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(hero.name, x, y + r + 6);
  ctx.textAlign = 'start';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
