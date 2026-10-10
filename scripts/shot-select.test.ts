import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { AREAS, SHARED } from '../web/e2e/shot-areas.ts';
import { dependents, isModule, repoGraph } from './import-graph.ts';
import { header, matches, repoSpecShots, selectShots, shotsInSpec } from './shot-select.ts';

const specShots = repoSpecShots();
const allShots = [...new Set([...specShots.values()].flat())].sort();
const graph = repoGraph();
const pick = (changed: string[], forceAll = false) =>
  selectShots({ changed, allShots, graph, specShots, forceAll });

describe('the area map', () => {
  it('finds the shots the specs take', () => {
    expect(allShots).toContain('10-chat');
    expect(allShots).toContain('1-empty-guild');
    expect(allShots.length).toBeGreaterThan(30);
  });

  it('puts every shot the specs take in an area', () => {
    const inAreas = new Set(AREAS.flatMap((a) => a.shots));
    expect(allShots.filter((s) => !inAreas.has(s))).toEqual([]);
  });

  it('names only shots that exist', () => {
    const known = new Set(allShots);
    expect(AREAS.flatMap((a) => a.shots).filter((s) => !known.has(s))).toEqual([]);
  });

  it('names only modules that exist', () => {
    expect(AREAS.flatMap((a) => a.modules).filter((m) => !graph.has(m))).toEqual([]);
  });

  it('reaches an area, or is shared, from every web source file', () => {
    const modules = new Set(AREAS.flatMap((a) => a.modules));
    const missing = readdirSync('web/src')
      .map((f) => `web/src/${f}`)
      .filter((p) => !/\.test\.tsx?$/.test(p))
      .filter((p) => !SHARED.some((l) => matches(p, l)))
      .filter((p) => !isModule(p) || ![p, ...dependents(graph, p)].some((m) => modules.has(m)));
    expect(missing).toEqual([]);
  });
});

describe('selectShots', () => {
  it('shows only the chat shots, in the default theme, for a chat change', () => {
    const s = pick(['server/src/chatRoutes.ts']);
    expect(s.shots.sort()).toEqual([
      '10-chat',
      '11-town-crier-report',
      '18-talk-opens-chat',
      '38-new-session',
    ]);
    expect(s.themes).toBe('default');
    expect(s.reasons).toEqual(['Chat (server/src/chatRoutes.ts)']);
    expect(s.skipped).toContain('Forge');
  });

  it('adds areas together', () => {
    const s = pick(['web/src/forge.tsx', 'server/src/ports.ts']);
    expect(s.shots).toHaveLength(9);
    expect(s.reasons).toEqual(['Forge (web/src/forge.tsx)', 'Tower (server/src/ports.ts)']);
  });

  it('shows everything, in every theme, when a stylesheet changes', () => {
    const s = pick(['web/src/themes.css']);
    expect(s.shots).toEqual(allShots);
    expect(s.themes).toBe('all');
  });

  it('shows everything for a shared file, in the default theme unless it is a theme file', () => {
    const s = pick(['web/src/App.tsx']);
    expect(s.shots).toEqual(allShots);
    expect(s.themes).toBe('default');
    expect(s.reasons).toEqual(['every screen (web/src/App.tsx is shared by all of them)']);
  });

  it('follows a helper to the screens that import it', () => {
    // health.tsx is drawn on the Forge and Library pages, and nowhere else.
    const s = pick(['web/src/health.tsx']);
    expect(s.reasons).toEqual([
      'Library (web/src/health.tsx, used by library.tsx)',
      'Forge (web/src/health.tsx, used by forge.tsx)',
    ]);
    expect(s.skipped).toContain('Chat');
  });

  it('follows a helper through other helpers', () => {
    // format.ts → panels.tsx, which the village and every building page draw with.
    const s = pick(['web/src/format.ts']);
    expect(s.reasons[0]).toBe('Village and map (web/src/format.ts, used by panels.tsx)');
    expect(s.skipped).toEqual(['Chat']);
  });

  it('follows a core function to only the screens that use it', () => {
    // transcript.ts reaches the web only through the server's watcher.
    const s = pick(['core/src/transcript.ts']);
    expect(s.reasons).toEqual(['Village and map (core/src/transcript.ts, used by watcher.ts)']);
  });

  it('follows a server helper to the areas whose routes use it', () => {
    const s = pick(['server/src/jsonStore.ts']);
    expect(s.reasons.map((r) => r.split(' (')[0])).toEqual(['Library', 'Forge', 'Wars']);
  });

  it('follows a component another page borrows', () => {
    // The War Room renders battle reports with the chat's Markdown.
    const s = pick(['web/src/chat.tsx']);
    expect(s.reasons).toEqual(['Chat (web/src/chat.tsx)', 'Wars (web/src/chat.tsx, used by wars.tsx)']);
  });

  it('shows nothing for a module no screen uses', () => {
    expect(pick(['server/src/heraldRoutes.ts']).shots).toEqual([]);
  });

  it('shows the touched area in every theme when the theme list changes', () => {
    const s = pick(['web/src/themes.ts']);
    expect(s.shots.sort()).toEqual(['37-settings', '9-needs-you-toast']);
    expect(s.themes).toBe('all');
  });

  it('shows nothing for docs or test changes', () => {
    expect(pick(['docs/WARS.md', 'README.md']).shots).toEqual([]);
    expect(pick(['web/src/village.test.ts', 'core/src/game.test.ts']).shots).toEqual([]);
  });

  it('shows everything when a web source file is in no area yet', () => {
    const s = pick(['web/src/warRoom.tsx']);
    expect(s.shots).toEqual(allShots);
    expect(s.reasons).toEqual(['every screen (web/src/warRoom.tsx is in no area yet)']);
  });

  it('shows the shots a changed spec takes', () => {
    const s = pick(['web/e2e/interact.spec.ts']);
    expect(s.shots.sort()).toEqual(['7-hero-panel', '8-building-panel']);
  });

  it('shows everything, in every theme, for the label', () => {
    const s = pick(['docs/WARS.md'], true);
    expect(s.shots).toEqual(allShots);
    expect(s.themes).toBe('all');
    expect(s.reasons).toEqual(['the "screenshots: all" label']);
  });

  it('matches folders by prefix and files exactly', () => {
    expect(pick(['fixtures/party.json']).shots).toContain('1-empty-guild');
    expect(pick(['server/src/skills.ts']).reasons).toEqual(['Library (server/src/skills.ts)']);
    expect(pick(['web/src/skills.tsx']).reasons).toEqual([
      'Library (web/src/skills.tsx)',
      'Needs you (web/src/skills.tsx, used by inbox.tsx)',
    ]);
  });
});

describe('shotsInSpec', () => {
  it('reads shoot and capture calls, across lines', () => {
    const src = [
      "await capture(page, '1-empty-guild');",
      "await shoot(page.getByTestId('chat'), '10-chat');",
      "await shoot(page, '16-library-page', { fullPage: true });",
      "await shoot(\n  page,\n  '24-forge-rack',\n);",
      "await page.getByTestId('x').click();",
    ].join('\n');
    expect(shotsInSpec(src)).toEqual(['1-empty-guild', '10-chat', '16-library-page', '24-forge-rack']);
  });
});

describe('header', () => {
  const base = { reasons: ['Chat (web/src/chat.tsx)'], skipped: ['Forge', 'Tower'] };

  it('says how many shots, why, and what was left out', () => {
    const text = header(
      { ...base, shots: ['10-chat', '38-new-session'], themes: 'default' },
      36,
      'abc1234',
      'https://x/a',
    );
    expect(text).toContain('From the browser tests on abc1234.');
    expect(text).toContain('2 of 36 shots, in the default theme');
    expect(text).toContain('for Chat (web/src/chat.tsx)');
    expect(text).toContain('Not taken: Forge, Tower');
    expect(text).toContain("[the run's download](https://x/a)");
  });

  it('says so when no screen changed', () => {
    const text = header({ shots: [], themes: 'default', reasons: [], skipped: [] }, 36, 'abc1234');
    expect(text).toContain('No screen this PR changes has a shot, so none were taken.');
    expect(text).toContain('take all 36');
  });
});
