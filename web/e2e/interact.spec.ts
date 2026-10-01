import { type Page, expect, test } from '@playwright/test';

/**
 * Clicking around the village. Positions come from the layout in src/village.ts: at
 * party t=20 Ada is alone at the Forge (building foot at 440,200, heroes stand 88px
 * below it), so her body is at about (440, 258) on the canvas.
 */
const ADA = { x: 440, y: 258 };
const LIBRARY = { x: 130, y: 120 };
const FORGE = { x: 440, y: 120 };
const GRASS = { x: 300, y: 250 };

async function ready(page: Page) {
  await expect(page.locator('[data-testid="village"][data-ready="true"]')).toHaveCount(1);
}

const village = (page: Page) => page.getByTestId('village');

test('clicking a hero on the map opens their sessions panel', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await ready(page);
  await village(page).click({ position: ADA });

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

  await village(page).click({ position: LIBRARY });
  const panel = page.getByTestId('panel-building');
  await expect(panel.getByRole('heading', { name: 'Library' })).toBeVisible();
  await expect(panel.getByTestId('nobody-here')).toBeVisible();
  await expect(panel).toContainText('Tools: Read, Grep, Glob, LS');

  await village(page).click({ position: FORGE });
  await expect(panel.getByRole('heading', { name: 'Forge' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Ada' }).first()).toBeVisible();
  await page.screenshot({ path: 'e2e-screenshots/8-building-panel.png', animations: 'disabled' });

  // From the building straight to a hero.
  await panel.getByRole('button', { name: 'Ada' }).first().click();
  await expect(page.getByTestId('panel-hero').getByRole('heading', { name: 'Ada' })).toBeVisible();
});

test('clicking open grass or pressing Escape closes the panel', async ({ page }) => {
  await page.goto('/?demo=party&t=20&select=building:forge');
  await ready(page);
  await expect(page.getByTestId('panel-building')).toBeVisible();
  await village(page).click({ position: GRASS });
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
  await page.getByTestId('open-tower').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('panel-building').getByRole('heading', { name: 'Tower' })).toBeVisible();
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
