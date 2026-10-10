import { type Page, expect, test } from '@playwright/test';

/**
 * Clicking around the village. Positions are map coordinates from the layout in
 * src/village.ts (1120 x 720): at party t=20 Ada is alone at the Forge (building foot at
 * 420,210, leaders stand 88px below it), so her body is at about (420, 270). The canvas
 * is drawn scaled to its column, so clicks go through `at`, which converts.
 */
const ADA = { x: 420, y: 270 };
const LIBRARY = { x: 140, y: 130 };
const ARENA = { x: 700, y: 130 };
const GRASS = { x: 830, y: 380 };

/** A map point as a click position on the canvas as drawn on the page. */
async function at(page: Page, point: { x: number; y: number }) {
  const box = (await page.getByTestId('village').boundingBox())!;
  return { x: (point.x / 1120) * box.width, y: (point.y / 720) * box.height };
}

async function ready(page: Page) {
  await expect(page.locator('[data-testid="village"][data-ready="true"]')).toHaveCount(1);
}

const village = (page: Page) => page.getByTestId('village');

test('clicking a hero on the map opens their sessions panel', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await ready(page);
  await village(page).click({ position: await at(page, ADA) });

  const panel = page.getByTestId('panel-hero');
  await expect(panel.getByRole('heading', { name: 'Ada' })).toBeVisible();
  await expect(panel).toContainText('Editing files at the Forge');
  await expect(panel).toContainText('feat/win-probability');
  await expect(panel).toContainText('claude-opus-5-5');
  await expect(panel).toContainText('Quests 3/4');
  await expect(panel.getByTestId('activity').locator('li').first()).toContainText('Write');
  await expect(page).toHaveURL(/select=hero%3As-ada/);
  await page.screenshot({ path: 'e2e-screenshots/7-hero-panel.png', animations: 'disabled' });

  // Party links move between members.
  await panel.getByRole('button', { name: 'Tester' }).click();
  await expect(page.getByTestId('panel-hero').getByRole('heading', { name: 'Tester' })).toBeVisible();
  await expect(page.getByTestId('panel-hero')).toContainText('Party of');

  await page.getByTestId('back').click();
  await expect(page.locator('.roster')).toBeVisible();
  await expect(page).not.toHaveURL(/select=/);
});

test('clicking a building shows who is there and what happened there', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await ready(page);

  await village(page).click({ position: await at(page, ARENA) });
  const panel = page.getByTestId('panel-building');
  await expect(panel.getByRole('heading', { name: 'Arena' })).toBeVisible();
  await expect(panel).toContainText('Tools: Bash');
  await page.screenshot({ path: 'e2e-screenshots/8-building-panel.png', animations: 'disabled' });

  // From a building straight to a hero: Ada is at the Forge (whose panel a link still opens).
  await page.goto('/?demo=party&t=20&select=building:forge');
  await expect(panel.getByRole('heading', { name: 'Forge' })).toBeVisible();
  await panel.getByRole('button', { name: 'Ada' }).first().click();
  await expect(page.getByTestId('panel-hero').getByRole('heading', { name: 'Ada' })).toBeVisible();
});

test('clicking the Library opens its page, where the librarians are', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await ready(page);
  await village(page).click({ position: await at(page, LIBRARY) });
  const library = page.getByTestId('library-page');
  await expect(library.getByRole('heading', { name: 'The Library', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/page=library/);
  // No librarians in this guild: both desks are empty.
  await expect(library.getByTestId('desk-Scout')).toHaveAttribute('data-state', 'away');
  await expect(library.getByTestId('desk-Reviewer')).toHaveAttribute('data-state', 'away');
  await expect(library.getByTestId('nobody-reading')).toBeVisible();

  await library.getByTestId('library-back').click();
  await expect(page).not.toHaveURL(/page=/);
  await ready(page);
});

test('clicking open grass or pressing Escape closes the panel', async ({ page }) => {
  await page.goto('/?demo=party&t=20&select=building:forge');
  await ready(page);
  await expect(page.getByTestId('panel-building')).toBeVisible();
  await village(page).click({ position: await at(page, GRASS) });
  await expect(page.getByTestId('panel-building')).toHaveCount(0);

  await page.goto('/?demo=party&t=20&select=hero:s-grace');
  await expect(page.getByTestId('panel-hero')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-hero')).toHaveCount(0);
});

test('everything on the map can be opened from the keyboard', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await page.getByRole('button', { name: 'Open Grace' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('panel-hero')).toContainText('Waiting for your answer');

  await page.keyboard.press('Escape');
  await page.getByTestId('open-arena').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('panel-building').getByRole('heading', { name: 'Arena' })).toBeVisible();
});

test('the beacon names are links to the waiting hero', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await page.getByTestId('beacon').getByRole('button', { name: 'Grace' }).click();
  await expect(page.getByTestId('panel-hero').getByRole('heading', { name: 'Grace' })).toBeVisible();
});

test('a link to a hero who has left falls back to the guild', async ({ page }) => {
  // Scout finished at t=14.
  await page.goto('/?demo=party&t=20&select=hero:s-scout');
  await expect(page.getByTestId('panel-hero')).toHaveCount(0);
  await expect(page.locator('.roster')).toBeVisible();
});

test('the war camp on the Barracks fence opens the War Room', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await ready(page);
  await village(page).click({ position: await at(page, { x: 170, y: 400 }) });
  await expect(page.getByTestId('wars-page')).toBeVisible();
  await expect(page).toHaveURL(/page=wars/);
  await page.getByTestId('wars-back').click();
  await expect(page.getByTestId('village')).toBeVisible();
});
