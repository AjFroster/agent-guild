import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AREAS, SHARED, THEME_FILES } from '../web/e2e/shot-areas.ts';
import { header, matches, selectShots, shotsInSpec } from './shot-select.ts';

const E2E = 'web/e2e';
const specFiles = readdirSync(E2E).filter((f) => f.endsWith('.spec.ts'));
const specShots = new Map(
  specFiles.map((f) => [`${E2E}/${f}`, shotsInSpec(readFileSync(join(E2E, f), 'utf8'))] as const),
);
const allShots = [...new Set([...specShots.values()].flat())].sort();
const pick = (changed: string[], forceAll = false) => selectShots({ changed, allShots, specShots, forceAll });

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

  it('places every web source file in an area or on the shared list', () => {
    const lists = [...SHARED, ...THEME_FILES, ...AREAS.flatMap((a) => a.files)];
    const missing = readdirSync('web/src')
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .map((f) => `web/src/${f}`)
      .filter((p) => !lists.some((l) => matches(p, l)));
    expect(missing).toEqual([]);
  });
});

describe('selectShots', () => {
  it('shows only the chat shots, in the default theme, for a chat change', () => {
    const s = pick(['web/src/chat.tsx']);
    expect(s.shots.sort()).toEqual([
      '10-chat',
      '11-town-crier-report',
      '18-talk-opens-chat',
      '31-new-session',
    ]);
    expect(s.themes).toBe('default');
    expect(s.reasons).toEqual(['Chat (web/src/chat.tsx)']);
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
    expect(s.reasons).toEqual(['web/src/App.tsx is shared by every screen']);
  });

  it('shows the touched area in every theme when the theme list changes', () => {
    const s = pick(['web/src/themes.ts']);
    expect(s.shots.sort()).toEqual(['30-settings', '9-needs-you-toast']);
    expect(s.themes).toBe('all');
  });

  it('shows nothing for server-only, docs or test changes', () => {
    expect(pick(['server/src/runs.ts', 'docs/WARS.md', 'README.md']).shots).toEqual([]);
    expect(pick(['web/src/village.test.ts', 'core/src/game.test.ts']).shots).toEqual([]);
  });

  it('shows everything when a web source file is in no area yet', () => {
    const s = pick(['web/src/warRoom.tsx']);
    expect(s.shots).toEqual(allShots);
    expect(s.reasons).toEqual(['web/src/warRoom.tsx is in no area yet']);
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
    expect(pick(['web/src/skills.tsx']).reasons).toEqual(['Library (web/src/skills.tsx)']);
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
      { ...base, shots: ['10-chat', '31-new-session'], themes: 'default' },
      36,
      'abc1234',
      'https://x/a',
    );
    expect(text).toContain('From the browser tests on abc1234.');
    expect(text).toContain('2 of 36 shots, in the default theme');
    expect(text).toContain('for Chat (web/src/chat.tsx)');
    expect(text).toContain('Left out: Forge, Tower');
    expect(text).toContain("[the run's download](https://x/a)");
  });

  it('says so when no screen changed', () => {
    const text = header({ shots: [], themes: 'default', reasons: [], skipped: [] }, 36, 'abc1234');
    expect(text).toContain("No screens changed in this PR. All 36 shots are in the run's download.");
  });
});
