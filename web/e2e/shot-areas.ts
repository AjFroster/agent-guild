/**
 * Which screenshots a pull request shows. The browser tests take every shot; the PR
 * comment shows only those for the parts of the app the PR changed
 * (scripts/shot-select.ts). A path ending in `/` is a folder; anything else is one file.
 *
 * A new page or shot goes in an area here; scripts/shot-select.test.ts fails until it does.
 */

/** A change here can move any screen, so every shot shows. */
export const SHARED: readonly string[] = [
  'web/src/styles.css',
  'web/src/themes.css',
  'web/src/fonts.ts',
  'web/src/App.tsx',
  'web/src/main.tsx',
  'web/src/api.ts',
  'web/src/live.ts',
  'web/src/demo.ts',
  'web/src/format.ts',
  'web/src/token.ts',
  'web/src/scene.ts',
  'web/src/BuildingPage.tsx',
  'web/src/SceneCanvas.tsx',
  'web/index.html',
  'web/package.json',
  'web/vite.config.ts',
  'web/playwright.config.ts',
  'web/e2e/shots.ts',
  'web/e2e/shot-areas.ts',
  'scripts/shot-select.ts',
  'scripts/shot-table.ts',
];

/** A change here repaints a theme, so the shots it shows are posted in every theme. */
export const THEME_FILES: readonly string[] = [
  'web/src/styles.css',
  'web/src/themes.css',
  'web/src/themes.ts',
  'web/src/fonts.ts',
  'web/e2e/shots.ts',
];

export interface Area {
  name: string;
  files: readonly string[];
  shots: readonly string[];
}

export const AREAS: readonly Area[] = [
  {
    name: 'Village and map',
    files: [
      'web/src/village.ts',
      'web/src/VillageCanvas.tsx',
      'web/src/panels.tsx',
      'web/src/selection.ts',
      'core/src/game.ts',
      'core/src/events.ts',
      'core/src/transcript.ts',
      'fixtures/',
      'web/public/',
      'web/e2e/transcripts/',
      'server/src/watcher.ts',
      'server/src/git.ts',
    ],
    shots: [
      '1-empty-guild',
      '2-hero-at-forge',
      '3-party-mid-quest',
      '4-level-up',
      '5-needs-you',
      '6-live-session',
      '7-hero-panel',
      '8-building-panel',
      '12-report-card',
      '13-loose-ends',
      '14-kingdom',
      '17-talk-on-map',
    ],
  },
  {
    name: 'Chat',
    files: [
      'web/src/chat.tsx',
      'core/src/chat.ts',
      'server/src/chats.ts',
      'server/src/chatRoutes.ts',
      'server/src/crier.ts',
      'web/e2e/fake-claude.mjs',
    ],
    shots: ['10-chat', '11-town-crier-report', '18-talk-opens-chat', '31-new-session'],
  },
  {
    name: 'The King',
    files: ['server/src/king.ts', 'server/src/kingRoutes.ts', 'server/src/kingMcp.ts'],
    shots: ['14-kingdom', '15-king-chat', '16-king-map'],
  },
  {
    name: 'Library',
    files: [
      'web/src/library.tsx',
      'web/src/libraryScene.ts',
      'web/src/skills.tsx',
      'web/src/skillList.ts',
      'web/src/health.tsx',
      'server/src/skills.ts',
      'server/src/archive.ts',
      'server/src/library.ts',
      'server/src/install.ts',
      'server/src/libraryRoutes.ts',
    ],
    shots: [
      '15-library-signs',
      '16-library-page',
      '19-skills-to-review',
      '20-skill-installed',
      '21-library-page-live',
      '22-your-skills',
    ],
  },
  {
    name: 'Forge',
    files: [
      'web/src/forge.tsx',
      'web/src/forgeScene.ts',
      'web/src/health.tsx',
      'server/src/forge.ts',
      'server/src/forgeRoutes.ts',
    ],
    shots: [
      '17-forge-signs',
      '18-forge-page',
      '23-knight-asks-the-forge',
      '24-forge-rack',
      '25-knight-told',
      '29-forge-health',
    ],
  },
  {
    name: 'Tower',
    files: [
      'web/src/tower.tsx',
      'web/src/towerScene.ts',
      'server/src/ports.ts',
      'server/src/portalRoutes.ts',
    ],
    shots: ['19-tower-page', '26-portal-on-the-map', '27-tower-portals'],
  },
  {
    name: 'Needs you',
    files: ['web/src/inbox.tsx', 'web/src/decisions.ts'],
    shots: ['5-needs-you', '9-needs-you-toast', '28-needs-you-inbox'],
  },
  {
    name: 'Settings and notices',
    files: [
      'web/src/chrome.tsx',
      'web/src/settings.ts',
      'web/src/themes.ts',
      'web/src/notices.ts',
      'web/src/useNotices.ts',
    ],
    shots: ['9-needs-you-toast', '30-settings'],
  },
];
