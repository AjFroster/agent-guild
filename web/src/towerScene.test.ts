import { describe, expect, it } from 'vitest';

import type { PortalInfo } from './api.ts';
import {
  KEEPER,
  describeTower,
  plaza,
  plazaXs,
  portalLabel,
  portalLook,
  portalRect,
  towerModel,
  towerPick,
} from './towerScene.ts';

const portal = (port: number, over: Partial<PortalInfo> = {}): PortalInfo => ({
  port,
  command: 'node',
  folder: 'shop',
  knight: null,
  http: true,
  status: 200,
  title: null,
  name: null,
  pinned: false,
  since: 0,
  ...over,
});
const centre = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;

describe('the Tower scene', () => {
  it("colours a portal: a Knight's service, a website, unchecked, or not a website", () => {
    expect(portalLook(portal(1, { knight: { id: 'k', name: 'Tristan' } }))).toBe('purple');
    expect(portalLook(portal(1))).toBe('green');
    expect(portalLook(portal(1, { http: null }))).toBe('blue');
    expect(portalLook(portal(1, { http: false, knight: { id: 'k', name: 'Tristan' } }))).toBe('closed');
  });

  it("names a portal by the user's name, then the page title, then the program", () => {
    expect(portalLabel(portal(5173, { command: 'vite', knight: { id: 'k', name: 'Tristan' } }))).toBe(
      ':5173 vite',
    );
    expect(portalLabel(portal(3000, { title: 'Shop admin', name: 'Admin' }))).toBe(':3000 Admin');
    expect(portalLabel(portal(3000, { title: 'A very long page title indeed' }))).toBe(':3000 A very l…');
  });

  it('stands up to five portals on the plaza, four and "+N more" past that', () => {
    expect(plaza(towerModel(null))).toEqual([]);
    expect(plaza(towerModel([1, 2, 3, 4, 5].map((n) => portal(n))))).toHaveLength(5);
    const crowded = plaza(towerModel([1, 2, 3, 4, 5, 6, 7].map((n) => portal(n))));
    expect(crowded).toHaveLength(5);
    expect(crowded[4]).toEqual({ more: 3 });
  });

  it('opens a website portal, sends a closed one to its row, and knows the keeper', () => {
    const model = towerModel([portal(3000), portal(5432, { http: false, command: 'postgres' })]);
    const xs = plazaXs(2);
    expect(towerPick(model, ...centre(portalRect(xs[0]!)))).toEqual({
      kind: 'portal',
      port: 3000,
      url: 'http://localhost:3000/',
    });
    expect(towerPick(model, ...centre(portalRect(xs[1]!)))).toEqual({
      kind: 'portal',
      port: 5432,
      url: null,
    });
    expect(towerPick(model, KEEPER.x, KEEPER.base - 60)).toEqual({ kind: 'keeper' });
    expect(towerPick(model, 10, 10)).toBeNull();
    expect(describeTower(model)).toBe('The Tower: 2 portals open, 1 to a website.');
  });
});
