import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { LIVE_DIR, LIVE_PORT, LIVE_TOKEN } from '../playwright.config.ts';

const LIVE = `http://127.0.0.1:${LIVE_PORT}`;

// One server and one transcript folder for the file: the notice test adds a session, so
// these run in order with it last.
test.describe.configure({ mode: 'serial' });

/**
 * The real server following e2e/transcripts: a fake project with a lead session that
 * writes todos, spawns an Explore sub-agent, finishes a turn and then asks a question.
 */
test('the live guild shows sessions read from Claude Code transcripts', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${LIVE}/?token=${LIVE_TOKEN}`);
  await expect(page.getByTestId('live-status')).toHaveText('Live');

  // Other spec files add sessions to the same server, so check these two by id, and
  // that the sub-agent sits directly under its leader.
  await expect(page.getByTestId('hero-sess-lead')).toContainText('guild-demo');
  await expect(page.getByTestId('hero-sess-lead').locator('+ li')).toContainText('Explore');

  const lead = page.getByTestId('hero-sess-lead');
  await expect(lead).toContainText('Quests 1/3');
  await expect(lead).toContainText('Needs you');
  await expect(page.getByTestId('beacon')).toContainText('guild-demo');

  // The prompt in the transcript must never reach the page.
  await expect(page.getByText('fixture prompt')).toHaveCount(0);

  await expect(page.locator('[data-testid="village"][data-ready="true"]')).toHaveCount(1);
  await page.screenshot({ path: 'e2e-screenshots/6-live-session.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('a wrong token gets an explanation, not an empty guild', async ({ page }) => {
  await page.goto(`${LIVE}/?token=${'x'.repeat(LIVE_TOKEN.length)}`);
  await expect(page.getByRole('alert')).toContainText('did not accept this link');
});

test('a session that starts waiting on the user raises a toast that opens it', async ({ page }) => {
  await page.goto(`${LIVE}/?token=${LIVE_TOKEN}`);
  await expect(page.getByTestId('live-status')).toHaveText('Live');

  const project = join(LIVE_DIR, '-home-example-notice-demo');
  await mkdir(project, { recursive: true });
  const file = join(project, 'sess-notice.jsonl');
  const line = (s: number, content: unknown[], stop = 'tool_use') =>
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date(Date.UTC(2026, 8, 30, 13, 0, s)).toISOString(),
      cwd: '/home/example/notice-demo',
      message: { role: 'assistant', content, stop_reason: stop },
    }) + '\n';
  await writeFile(file, line(0, [{ type: 'tool_use', name: 'Read', input: {} }]));
  await expect(page.getByTestId('hero-sess-notice')).toBeVisible();

  // Joining is off by default, so nothing yet; then it asks a question.
  // Other specs' sessions may raise their own toasts on this shared server.
  await expect(page.getByTestId('toasts').getByText('notice-demo')).toHaveCount(0);
  await appendFile(file, line(1, [{ type: 'tool_use', name: 'AskUserQuestion', input: {} }]));
  const toast = page.getByTestId('toasts').getByRole('button', { name: 'notice-demo needs you' });
  await expect(toast).toBeVisible();
  await page.screenshot({ path: 'e2e-screenshots/9-needs-you-toast.png', animations: 'disabled' });

  await toast.click();
  await expect(page.getByTestId('panel-hero').getByRole('heading', { name: 'notice-demo' })).toBeVisible();

  // Finishing a turn is a notice too.
  await appendFile(file, line(2, [{ type: 'text', text: 'done' }], 'end_turn'));
  await expect(page.getByTestId('toasts')).toContainText('notice-demo finished a turn');
});
