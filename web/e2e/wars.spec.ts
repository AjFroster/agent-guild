import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

import { LIVE_GH, LIVE_HOME, LIVE_PORT, LIVE_TOKEN } from '../playwright.config.ts';

/**
 * The War Room (docs/WARS.md) against the real server: a real git repository under the
 * test home, e2e/fake-claude.mjs for the Knight, and e2e/fake-gh.mjs for pull requests.
 * The tests run in order, as one campaign: declare, fight, win, clear, report.
 */
const LIVE = `http://127.0.0.1:${LIVE_PORT}`;
const AUTH = { authorization: `Bearer ${LIVE_TOKEN}` };
const REPO = join(LIVE_HOME, 'castle');
const BATTLE = 'feat/raise-the-banners';
const GONE = 'fix/drawbridge';

test.describe.configure({ mode: 'serial' });

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function openWarRoom(page: Page) {
  await page.goto(`${LIVE}/?token=${LIVE_TOKEN}`);
  await expect(page.getByTestId('live-status')).toHaveText('Live');
  await page.getByTestId('open-war-room').click();
  await expect(page.getByTestId('wars-page')).toBeVisible();
}

/** From the War Room's list of wars into the castle war's battlefield. */
async function openCastle(page: Page) {
  await openWarRoom(page);
  await page.getByTestId('all-wars').getByTestId('open-war-castle').click();
  await expect(page.getByTestId('war-page')).toBeVisible();
}

async function battleOf(request: APIRequestContext, branch: string) {
  const res = await request.get(`${LIVE}/api/wars`, { headers: AUTH });
  const status = (await res.json()) as {
    wars: { id: string; folder: string; battles: { branch: string; knights: { id: string }[] }[] }[];
  };
  const war = status.wars.find((w) => w.folder === 'castle')!;
  return { war, battle: war.battles.find((b) => b.branch === branch)! };
}

test.beforeAll(async () => {
  await mkdir(REPO, { recursive: true });
  git(REPO, 'init', '-q', '-b', 'main');
  await writeFile(join(REPO, 'README.md'), '# Castle\n');
  git(REPO, 'add', '.');
  git(REPO, 'commit', '-q', '-m', 'Lay the foundations');
  // A branch of work already under way: one commit ahead of main.
  git(REPO, 'checkout', '-q', '-b', GONE);
  await writeFile(join(REPO, 'gate.txt'), 'raised\n');
  git(REPO, 'add', '.');
  git(REPO, 'commit', '-q', '-m', 'Mend the drawbridge');
  git(REPO, 'checkout', '-q', 'main');
  await mkdir(LIVE_GH, { recursive: true });
});

test('declare a war on a repository, plan a battle and send a Knight into its worktree', async ({
  page,
  request,
}) => {
  const errors = watchForErrors(page);
  await openWarRoom(page);

  // Declaring: the folder, a name and a goal.
  const declare = page.getByTestId('declare-war');
  await declare.getByTestId('war-folder').fill(REPO);
  await declare.getByTestId('war-name').fill('Siege of the Castle');
  await declare.getByTestId('war-goal').fill('Hold the walls through winter.');
  await declare.getByTestId('declare-war-go').click();

  const war = page.getByTestId('war-castle');
  await expect(war.getByRole('heading', { name: 'Siege of the Castle' })).toBeVisible();
  await expect(war).toContainText('Hold the walls through winter.');
  // The branch already under way is a battle, holding: ahead, but nobody on it.
  await expect(war.getByTestId(`battle-${GONE}`)).toHaveAttribute('data-state', 'holding');

  // A battle declared ahead of time: planned, on a branch named for it.
  await war.getByTestId('battle-title').fill('Raise the banners');
  await war.getByTestId('declare-battle').click();
  const battle = war.getByTestId(`battle-${BATTLE}`);
  await expect(battle).toHaveAttribute('data-state', 'planned');
  await expect(battle).toContainText('Raise the banners');

  // Send a Knight: it fights in its own worktree, on a new branch.
  await battle.getByTestId(`send-knight-${BATTLE}`).click();
  await war.getByTestId('send-knight-order').fill('Hang a banner on every tower.');
  await war.getByTestId('send-knight-go').click();
  // The fake Knight answers at once, so its turn is over: the battle holds, with it on it.
  await expect(battle.getByRole('button', { name: 'raise-the-banners' })).toBeVisible({ timeout: 15_000 });
  await expect(battle).toHaveAttribute('data-state', 'holding');
  const trees = git(REPO, 'worktree', 'list', '--porcelain');
  expect(trees).toContain(`branch refs/heads/${BATTLE}`);
  // Declaring opened the war's battlefield: the Knight duels its enemy there.
  await expect(page.getByTestId('war-page')).toBeVisible();
  const { battle: fought } = await battleOf(request, BATTLE);
  const duel = page.getByTestId(`duel-${fought.knights[0]!.id}`);
  await expect(duel).toContainText('raise-the-banners');
  await expect(duel.locator('.war-foe')).not.toBeEmpty();
  // Its enemy is the same on every visit.
  const foe = await duel.locator('.war-foe').textContent();
  await page.reload();
  await expect(page.getByTestId(`duel-${fought.knights[0]!.id}`).locator('.war-foe')).toHaveText(foe!);
  await expect(page.locator('[data-testid="war-scene"][data-ready="true"]')).toHaveCount(1);
  await page.screenshot({
    path: 'e2e-screenshots/30-war-battlefield.png',
    animations: 'disabled',
    fullPage: true,
  });

  // All wars, from the War Room: this one sleeps, since its Knight's turn is over.
  await page.getByTestId('war-back').click();
  await expect(page.getByTestId('wars-sleeping')).toContainText('Siege of the Castle');
  await expect(page).not.toHaveURL(/war=/);
  await page.getByTestId('all-wars').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e-screenshots/35-all-wars.png', animations: 'disabled' });

  // On the map the Knight wears the war's banner, and its panel names the war.
  await page.getByTestId('wars-back').click();
  const knight = page.locator('.roster').getByRole('button', { name: 'Open raise-the-banners' });
  await knight.click();
  await expect(page.getByTestId('panel-hero').getByTestId('hero-war')).toHaveText('Siege of the Castle');
  await expect(page.locator('[data-testid="village"][data-ready="true"]')).toHaveCount(1);
  await page.screenshot({ path: 'e2e-screenshots/31-war-camp.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('a merged pull request wins the battle, and the field is cleared only when nothing is lost', async ({
  page,
  request,
}) => {
  const errors = watchForErrors(page);
  const { battle: before } = await battleOf(request, BATTLE);
  const knightId = before.knights[0]!.id;
  const tree = git(REPO, 'worktree', 'list', '--porcelain')
    .split('\n\n')
    .find((b) => b.includes(`branch refs/heads/${BATTLE}`))!
    .split('\n')[0]!
    .replace(/^worktree /, '');

  // The Knight's work, pushed and merged two days ago (fake gh).
  await writeFile(join(tree, 'banners.txt'), 'one on every tower\n');
  git(tree, 'add', '.');
  git(tree, 'commit', '-q', '-m', 'Hang the banners');
  const head = git(tree, 'rev-parse', 'HEAD');
  await writeFile(
    join(LIVE_GH, 'castle.json'),
    JSON.stringify([
      {
        number: 7,
        state: 'MERGED',
        headRefName: BATTLE,
        headRefOid: head,
        mergedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
      },
    ]),
  );

  await openCastle(page);
  const war = page.getByTestId('war-castle');
  const battle = war.getByTestId(`battle-${BATTLE}`);
  await expect(battle).toHaveAttribute('data-state', 'won', { timeout: 15_000 });
  await expect(battle).toContainText('#7 merged');
  await expect(battle).toContainText('checks passing');
  await expect(war.getByTestId('war-facts-castle')).toContainText('1 victory');
  // The Knight worked there today, so the guild keeps the worktree on its own...
  await expect(battle.getByTestId(`guard-${BATTLE}`)).toContainText('Knight');
  expect(existsSync(tree)).toBe(true);
  // ...and by hand too, while the Knight is still running in it.
  await battle.getByTestId(`clear-${BATTLE}`).click();
  await expect(war.getByRole('alert')).toContainText('A Knight is working in that worktree');
  await page.screenshot({
    path: 'e2e-screenshots/32-battle-won.png',
    animations: 'disabled',
    fullPage: true,
  });

  // Once the Knight stops, clearing by hand removes the worktree; the branch stays.
  expect((await request.post(`${LIVE}/api/chats/${knightId}/stop`, { headers: AUTH })).ok()).toBe(true);
  await expect(async () => {
    await battle.getByTestId(`clear-${BATTLE}`).click();
    await expect(battle).toContainText('field cleared', { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  expect(existsSync(tree)).toBe(false);
  expect(git(REPO, 'branch', '--list', BATTLE)).toContain(BATTLE);

  // The Knight earned the victory.
  await page.getByTestId('open-war-room').click();
  await page.locator('.roster').getByRole('button', { name: 'Open raise-the-banners' }).click();
  await expect(page.getByTestId('panel-hero').getByTestId('hero-victories')).toHaveText('1');
  expect(errors.filter((e) => !e.includes('409'))).toEqual([]);
});

test('a branch gone without a word waits in Needs you until the user says how it ended', async ({ page }) => {
  const errors = watchForErrors(page);
  git(REPO, 'branch', '-q', '-D', GONE);
  await page.goto(`${LIVE}/?token=${LIVE_TOKEN}&tab=inbox`);
  await expect(page.getByTestId('live-status')).toHaveText('Live');
  const inbox = page.getByTestId('inbox');
  const row = inbox.getByTestId(`inbox-won-${GONE}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('tab-inbox').locator('.tab-badge')).not.toHaveText('0');
  await page.screenshot({ path: 'e2e-screenshots/33-needs-you-battle.png', animations: 'disabled' });

  await row.click();
  await expect(row).toHaveCount(0);
  await openCastle(page);
  const war = page.getByTestId('war-castle');
  await expect(war.getByTestId(`battle-${GONE}`)).toHaveAttribute('data-state', 'won');
  await expect(war.getByTestId('war-facts-castle')).toContainText('2 victories');
  expect(errors).toEqual([]);
});

test('a battle report covers the war, and is kept in the reports folder', async ({ page }) => {
  const errors = watchForErrors(page);
  await openWarRoom(page);
  const reports = page.getByTestId('battle-reports');
  await reports.getByTestId('run-report').click();
  const report = reports.getByTestId('battle-report');
  await expect(report).toContainText('Siege of the Castle');
  await expect(report).toContainText('Raise the banners');
  const saved = await readdir(join(LIVE_HOME, '.agent-guild', 'battle-reports'));
  expect(saved.some((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))).toBe(true);
  await report.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e-screenshots/34-battle-report.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});
