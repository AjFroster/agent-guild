/**
 * Which screenshots a pull request takes and shows. Each area names the modules that draw
 * its screens; scripts/shot-select.ts follows the import graph (scripts/import-graph.ts)
 * from each changed module to the areas that use it, directly or through others. A path
 * ending in `/` is a folder; anything else is one file.
 *
 * A new page goes in an area here; scripts/shot-select.test.ts fails until it does.
 */

/** A change here can move any screen, so every shot is taken. */
export const SHARED: readonly string[] = [
  'web/src/styles.css',
  'web/src/themes.css',
  'web/src/fonts.ts',
  'web/src/App.tsx',
  'web/src/main.tsx',
  // The data every screen is drawn from: demo fixtures, the live stream and its login.
  'web/src/demo.ts',
  'web/src/live.ts',
  'web/src/token.ts',
  'server/src/server.ts',
  'server/src/cli.ts',
  'web/index.html',
  'web/package.json',
  'web/vite.config.ts',
  'web/playwright.config.ts',
  'web/e2e/shots.ts',
  'web/e2e/shot-areas.ts',
  'scripts/import-graph.ts',
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
  /** The modules that draw this area's screens (and serve their data). */
  modules: readonly string[];
  /** Anything else its screens show: fixtures, art, fake transcripts. */
  files: readonly string[];
  shots: readonly string[];
}

export const AREAS: readonly Area[] = [
  {
    name: 'Village and map',
    modules: [
      'web/src/village.ts',
      'web/src/VillageCanvas.tsx',
      'web/src/panels.tsx',
      'web/src/selection.ts',
      'server/src/watcher.ts',
      'server/src/git.ts',
    ],
    files: ['fixtures/', 'web/public/', 'web/e2e/transcripts/'],
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
    modules: ['web/src/chat.tsx', 'server/src/chats.ts', 'server/src/chatRoutes.ts', 'server/src/crier.ts'],
    files: ['web/e2e/fake-claude.mjs'],
    shots: ['10-chat', '11-town-crier-report', '18-talk-opens-chat', '31-new-session'],
  },
  {
    name: 'The King',
    modules: ['server/src/king.ts', 'server/src/kingRoutes.ts', 'server/src/kingMcp.ts'],
    files: [],
    shots: ['14-kingdom', '15-king-chat', '16-king-map'],
  },
  {
    name: 'Library',
    modules: [
      'web/src/library.tsx',
      'web/src/libraryScene.ts',
      'web/src/skills.tsx',
      'web/src/skillList.ts',
      'server/src/skills.ts',
      'server/src/library.ts',
      'server/src/install.ts',
      'server/src/libraryRoutes.ts',
    ],
    files: [],
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
    modules: [
      'web/src/forge.tsx',
      'web/src/forgeScene.ts',
      'server/src/forge.ts',
      'server/src/forgeRoutes.ts',
    ],
    files: [],
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
    modules: [
      'web/src/tower.tsx',
      'web/src/towerScene.ts',
      'server/src/ports.ts',
      'server/src/portalRoutes.ts',
    ],
    files: [],
    shots: ['19-tower-page', '26-portal-on-the-map', '27-tower-portals'],
  },
  {
    name: 'Needs you',
    modules: ['web/src/inbox.tsx', 'web/src/decisions.ts'],
    files: [],
    shots: ['5-needs-you', '9-needs-you-toast', '28-needs-you-inbox'],
  },
  {
    name: 'Settings and notices',
    modules: [
      'web/src/chrome.tsx',
      'web/src/settings.ts',
      'web/src/themes.ts',
      'web/src/notices.ts',
      'web/src/useNotices.ts',
    ],
    files: [],
    shots: ['9-needs-you-toast', '30-settings'],
  },
];
