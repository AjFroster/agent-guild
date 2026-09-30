import { mkdirSync } from 'node:fs';

import { type Page, expect, test } from '@playwright/test';

const SHOTS = 'e2e-screenshots';
mkdirSync(SHOTS, { recursive: true });

/**
 * Save the screen for a person to look at. CI posts these on the pull request, because
 * an assertion can say an element exists but not that the page looks right: a blank
 * canvas next to one correct label still passes.
 */
async function capture(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' });
}

/** Fail the test on any console error or uncaught exception, not just on assertions. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test('an empty guild says so instead of rendering nothing', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/?demo=empty');
  await expect(page.getByTestId('empty-guild')).toBeVisible();
  await expect(page.getByTestId('village')).toHaveAttribute('aria-label', 'The village is empty.');
  await expect(page.getByTestId('beacon')).toHaveCount(0);
  await capture(page, '1-empty-guild');
  expect(errors).toEqual([]);
});

test('a solo hero works at the forge with a quest in progress', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/?demo=solo');
  const ada = page.getByTestId('hero-s-ada');
  await expect(ada).toContainText('Ada');
  await expect(ada).toContainText('Working');
  await expect(ada).toContainText('Quests 1/3');
  await expect(page.getByTestId('village')).toHaveAttribute('aria-label', 'Ada at the Forge.');
  await capture(page, '2-hero-at-forge');
  expect(errors).toEqual([]);
});

test('a party lists sub-agents under their leader and hides ones that left', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/?demo=party&t=10');
  const names = page.locator('.roster > .hero strong');
  await expect(names).toHaveText(['Ada', 'Scout', 'Tester', 'Grace']);
  await capture(page, '3-party-mid-quest');

  // Scout finished at t=14, so it has left the roster by t=16.
  await page.goto('/?demo=party&t=16');
  await expect(names).toHaveText(['Ada', 'Tester', 'Grace']);
  expect(errors).toEqual([]);
});

test('three finished quests level the leader up', async ({ page }) => {
  await page.goto('/?demo=party&t=17');
  const ada = page.getByTestId('hero-s-ada');
  await expect(ada).toContainText('Lv 2');
  await expect(ada).toContainText('Quests 3/4');
  await capture(page, '4-level-up');
});

test('the beacon names the hero waiting on the user', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await expect(page.getByTestId('beacon')).toHaveText('Grace needs you');
  await expect(page.getByTestId('hero-s-grace')).toContainText('Needs you');
  await capture(page, '5-needs-you');
});

test('an unknown fixture shows an error, not a blank page', async ({ page }) => {
  await page.goto('/?demo=does-not-exist');
  await expect(page.getByRole('alert')).toContainText('No demo fixture called "does-not-exist"');
});

test('a non-numeric time is rejected', async ({ page }) => {
  await page.goto('/?demo=party&t=soon');
  await expect(page.getByRole('alert')).toContainText('must be a number');
});
