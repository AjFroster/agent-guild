import { createContext } from 'react';

import type { WarInfo } from './api.ts';
import type { MapWar, Team } from './village.ts';

/**
 * Which Knights fight in which war (docs/WARS.md): they wear its banner on the map and in
 * the panels, and the map plants one banner per war. Pure, from the War Room's status.
 */
export interface WarBanners {
  /** Knight id to the banner colour it wears. */
  teams: ReadonlyMap<string, Team>;
  /** Knight id to the war it fights in. */
  warOf: ReadonlyMap<string, { id: string; name: string }>;
  map: MapWar[];
}

export const NO_BANNERS: WarBanners = { teams: new Map(), warOf: new Map(), map: [] };

export function warBanners(wars: readonly WarInfo[] | null | undefined): WarBanners {
  if (!wars) return NO_BANNERS;
  const teams = new Map<string, Team>();
  const warOf = new Map<string, { id: string; name: string }>();
  const map: MapWar[] = [];
  for (const war of wars) {
    if (war.archived) continue;
    for (const id of war.knights) {
      // A Knight in two wars (nested repositories) keeps the first.
      if (teams.has(id)) continue;
      teams.set(id, war.banner);
      warOf.set(id, { id: war.id, name: war.name });
    }
    map.push({
      name: war.name,
      banner: war.banner,
      victories: war.victories,
      fighting: war.battles.some((b) => b.state === 'fighting'),
    });
  }
  return { teams, warOf, map };
}

/** The banners in force, for anything that shows a Knight's colour outside the map. */
export const BannerContext = createContext<WarBanners>(NO_BANNERS);
