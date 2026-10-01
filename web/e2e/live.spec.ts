import { expect, test } from '@playwright/test';

import { LIVE_PORT, LIVE_TOKEN } from '../playwright.config.ts';

const LIVE = `http://127.0.0.1:${LIVE_PORT}`;

/**
 * The real server following e2e/transcripts: a fake project with a lead session that
 * writes todos, spawns an Explore sub-agent, finishes a turn and then asks a question.
 */
test('the live guild shows sessions read from Claude Code transcripts', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${LIVE}/?token=${LIVE_TOKEN}`);
  await expect(page.getByTestId('live-status')).toHaveText('Live');

  const names = page.locator('.roster > .hero strong');
  await expect(names).toHaveText(['guild-demo', 'Explore']);

  const lead = page.getByTestId('hero-sess-lead');
  await expect(lead).toContainText('Quests 1/3');
  await expect(lead).toContainText('Needs you');
  await expect(page.getByTestId('beacon')).toHaveText('guild-demo needs you');

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
