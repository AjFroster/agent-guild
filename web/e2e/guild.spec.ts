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
  // The canvas marks itself ready once its sprites have loaded and it has drawn.
  await expect(page.locator('[data-testid="village"][data-ready="true"]')).toHaveCount(1);
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

test('a hero shows a report card with its tokens and its party total', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/?demo=party&t=20&select=hero:s-ada');
  const card = page.getByTestId('report-card');
  await expect(card).toContainText('Time on task');
  await expect(card).toContainText('Quests done3/4');
  await expect(card.getByTestId('token-split')).toContainText('with party');
  await expect(page.getByTestId('panel-hero')).toBeVisible();
  await capture(page, '12-report-card');
  await page.goto('/?demo=party&t=20');
  await expect(page.getByTestId('guild-tokens')).toContainText('tokens');
  expect(errors).toEqual([]);
});

test('loose ends list unpushed work, from sessions that left too', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/?demo=party&t=20');
  const loose = page.getByTestId('loose-ends');
  await expect(loose).toContainText('Ada');
  await expect(loose).toContainText('2 commits not pushed · 1 uncommitted file');
  await expect(loose).toContainText('Hopper');
  await expect(loose).toContainText('3 commits not pushed · left the guild');
  await expect(loose).not.toContainText('Grace');
  await expect(page.getByTestId('loose-s-ada')).toBeVisible();
  await capture(page, '13-loose-ends');
  await page.goto('/?demo=party&t=20&select=hero:s-grace');
  await expect(page.getByTestId('hero-git')).toHaveText('Everything committed and pushed');
  expect(errors).toEqual([]);
});

test('the librarians work inside the Library, and its signs show what each is doing', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/?demo=library&t=20');
  // On the map: a book over the roof for the Scout at work, "zzz" for the resting Reviewer.
  await capture(page, '15-library-signs');
  await page.getByTestId('open-library').click();
  const library = page.getByTestId('library-page');
  await expect(library.getByTestId('desk-Scout')).toHaveAttribute('data-state', 'working');
  await expect(library.getByTestId('desk-Scout-doing')).toHaveText('Searching the web…');
  await expect(library.getByTestId('desk-Reviewer')).toHaveAttribute('data-state', 'resting');
  await expect(library.getByTestId('desk-Reviewer-doing')).toContainText('last: writing a review');
  // The Library's grounds: the Scout at its glowing orb, the Reviewer asleep at its lectern.
  const scene = page.locator('[data-testid="library-scene"][data-ready="true"]');
  await expect(scene).toHaveCount(1);
  await expect(scene).toHaveAttribute('aria-label', /the Scout is at work, the Reviewer is resting/);
  await page.screenshot({ path: `${SHOTS}/16-library-page.png`, animations: 'disabled', fullPage: true });
  // Clicking a librarian in the scene opens its session (demo mode has no chats).
  const box = (await scene.boundingBox())!;
  await scene.click({ position: { x: (300 / 1120) * box.width, y: (360 / 720) * box.height } });
  await expect(page.getByTestId('panel-hero').getByRole('heading', { name: 'Scout' })).toBeVisible();
  await expect(page.getByTestId('village')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the Forge: a Knight asks for equipment, and the Blacksmith works inside', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/?demo=forge&t=20');
  // On the map: Percival walked to the Forge to ask; a hammer sign for the Blacksmith at work.
  await capture(page, '17-forge-signs');
  await expect(page.getByTestId('hero-s-smith')).toContainText('Smith');
  await page.getByTestId('open-forge').click();
  const forge = page.getByTestId('forge-page');
  await expect(forge.getByTestId('desk-Blacksmith')).toHaveAttribute('data-state', 'working');
  await expect(forge.getByTestId('desk-Blacksmith-doing')).toHaveText('Searching the code…');
  await expect(forge.getByTestId('desk-Armorer')).toHaveAttribute('data-state', 'unhired');
  const scene = page.locator('[data-testid="forge-scene"][data-ready="true"]');
  await expect(scene).toHaveAttribute('aria-label', /the Blacksmith is at the anvil/);
  await page.screenshot({ path: `${SHOTS}/18-forge-page.png`, animations: 'disabled', fullPage: true });
  await forge.getByTestId('forge-back').click();
  await expect(page.getByTestId('village')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the Tower: its grounds and wizards, and the Portal Keeper', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/?demo=party&t=20');
  await page.getByTestId('open-tower').click();
  const tower = page.getByTestId('tower-page');
  await expect(page.locator('[data-testid="tower-scene"][data-ready="true"]')).toHaveCount(1);
  // Demo mode cannot look at ports: the page says so instead of showing none.
  await expect(tower).toContainText('The Portal Keeper looks for services when the guild runs live.');
  await expect(tower.getByTestId('desk-Seer')).toContainText('Coming soon');
  await page.screenshot({ path: `${SHOTS}/19-tower-page.png`, animations: 'disabled', fullPage: true });
  await tower.getByTestId('tower-back').click();
  await expect(page.getByTestId('village')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a kingdom: the King, Knights in their colours, and parties following them', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/?demo=kingdom&t=20');
  const roster = page.locator('.roster');
  await expect(roster.locator('.hero-head strong').first()).toHaveText('Arthur'); // the King leads
  await expect(page.getByTestId('hero-s-king')).toContainText('King');
  await expect(page.getByTestId('hero-s-perc-1')).toContainText('Footsoldier');
  await expect(page.getByTestId('hero-s-perc-2')).toContainText('Worker');
  await capture(page, '14-kingdom');
  await page.goto('/?demo=kingdom&t=20&select=hero:s-gaw-1');
  await expect(page.getByTestId('hero-rank')).toContainText('Footsoldier');
  expect(errors).toEqual([]);
});
