import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests run against the production build in demo mode: recorded event streams,
 * frozen at a chosen second, so every run renders the same frame. No live Claude
 * session, no network, no clock.
 */
const PORT = 5281;
export const LIVE_PORT = 4748;
export const LIVE_TOKEN = 'e2e-token-0123456789abcdef';
/** A scratch copy of e2e/transcripts, so tests can write new sessions into it. */
export const LIVE_DIR = join(tmpdir(), 'agent-guild-e2e-projects');
/** Stands in for the user's home: chats may start in folders under it. */
export const LIVE_HOME = join(tmpdir(), 'agent-guild-e2e-home');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      // Build then preview, not the dev server: CI should test what ships.
      command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The real server, following a folder of fake transcripts instead of ~/.claude.
      // It builds too, because it serves web/dist itself and must not race the job above.
      command: `rm -rf ${LIVE_DIR} ${LIVE_HOME} && cp -r e2e/transcripts ${LIVE_DIR} && mkdir -p ${LIVE_HOME}/proj ${LIVE_HOME}/.agent-guild && echo '{"enabled":false}' > ${LIVE_HOME}/.agent-guild/town-crier.json && npx vite build --emptyOutDir false && node ../server/src/cli.ts`,
      url: `http://127.0.0.1:${LIVE_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        AGENT_GUILD_PORT: String(LIVE_PORT),
        AGENT_GUILD_TOKEN: LIVE_TOKEN,
        CLAUDE_PROJECTS_DIR: LIVE_DIR,
        AGENT_GUILD_CLAUDE: resolve('e2e/fake-claude.mjs'),
        AGENT_GUILD_HOME: LIVE_HOME,
        AGENT_GUILD_DATA_DIR: join(LIVE_HOME, '.agent-guild'),
        AGENT_GUILD_MAX_AGE_HOURS: '0',
        AGENT_GUILD_IDLE_MINUTES: '0',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
