import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type Page, expect, test } from '@playwright/test';

import { LIVE_DIR, LIVE_HOME, LIVE_PORT, LIVE_SKILLS, LIVE_TOKEN } from '../playwright.config.ts';

/**
 * Chatting with sessions and the Town Crier, against the real server with
 * e2e/fake-claude.mjs standing in for the `claude` CLI.
 */
const LIVE = `http://127.0.0.1:${LIVE_PORT}`;
const PROJECT = join(LIVE_HOME, 'proj');

test.describe.configure({ mode: 'serial' });

async function openGuild(page: Page) {
  await page.goto(`${LIVE}/?token=${LIVE_TOKEN}`);
  await expect(page.getByTestId('live-status')).toHaveText('Live');
}

test('start a session from the browser and talk to it', async ({ page }) => {
  await openGuild(page);
  await page.getByTestId('new-session').click();
  const form = page.getByTestId('new-chat');
  await form.getByTestId('new-cwd').fill(PROJECT);
  await form.getByTestId('new-name').fill('Builder');
  await form.getByTestId('new-message').fill('Hello there');
  await form.getByTestId('new-start').click();

  const chat = page.getByTestId('chat');
  await expect(chat.getByRole('heading', { name: 'Builder' })).toBeVisible();
  await expect(chat.getByTestId('msg-user')).toHaveText('Hello there');
  await expect(chat.getByTestId('msg-assistant')).toHaveText('You said: Hello there');

  // A follow-up in the same session, with a tool call shown as its own row.
  await chat.getByTestId('composer').fill('please use a tool');
  await chat.getByTestId('composer').press('Enter');
  await expect(chat.getByTestId('msg-tool')).toContainText('Read');
  await expect(chat.getByTestId('msg-assistant').last()).toHaveText('You said: please use a tool');
  await expect(chat.getByTestId('composer')).toHaveValue('');
  await page.screenshot({ path: 'e2e-screenshots/10-chat.png', animations: 'disabled' });

  // The session walked into the guild as a hero named after the session.
  await chat.getByRole('button', { name: 'Close chat' }).click();
  await expect(page.locator('.roster')).toContainText('Builder');
});

test('skipping permission checks is not offered unless the guild allows it', async ({ page, request }) => {
  await openGuild(page);
  await page.getByTestId('new-session').click();
  const options = await page.getByTestId('new-mode').locator('option').allTextContents();
  expect(options.join('|')).not.toContain('Skip all permission checks');

  const res = await request.post(`${LIVE}/api/chats`, {
    headers: { authorization: `Bearer ${LIVE_TOKEN}` },
    data: { cwd: PROJECT, mode: 'bypassPermissions', message: 'go' },
  });
  expect(res.status()).toBe(403);
});

test('clicking a session opens its conversation, and it can be continued', async ({ page }) => {
  await openGuild(page);
  await page.locator('.roster').getByRole('button', { name: 'Open Builder' }).click();
  await page.getByTestId('open-chat').click();

  const chat = page.getByTestId('chat');
  await expect(chat.getByTestId('msg-user').first()).toHaveText('Hello there');
  await chat.getByTestId('composer').fill('one more thing');
  await chat.getByTestId('send').click();
  await expect(chat.getByTestId('msg-assistant').last()).toHaveText('You said: one more thing');

  // The open chat survives a reload: it lives in the URL.
  await page.reload();
  await expect(page.getByTestId('chat').getByTestId('msg-user').last()).toHaveText('one more thing');
});

test('a missing Claude login is explained, not shown as a reply', async ({ page }) => {
  await openGuild(page);
  await page.getByTestId('new-session').click();
  const form = page.getByTestId('new-chat');
  await form.getByTestId('new-cwd').fill(PROJECT);
  await form.getByTestId('new-message').fill('LOGIN please');
  await form.getByTestId('new-start').click();
  const chat = page.getByTestId('chat');
  await expect(chat.getByTestId('msg-notice')).toContainText('/login');
  // Said once, not echoed as Claude's reply as well.
  await expect(chat.getByTestId('msg-assistant')).toHaveCount(0);
  await expect(chat.getByText(/not logged in/i)).toHaveCount(1);
});

test('the new-session form refuses a folder outside home', async ({ page }) => {
  await openGuild(page);
  await page.getByTestId('new-session').click();
  const form = page.getByTestId('new-chat');
  await form.getByTestId('new-cwd').fill('/etc');
  await form.getByTestId('new-message').fill('hi');
  await form.getByTestId('new-start').click();
  await expect(form.getByRole('alert')).toContainText('inside your home directory');
});

test('the Town Crier runs on demand, writes a report, and the report opens', async ({ page }) => {
  await openGuild(page);
  const card = page.getByTestId('crier');
  await expect(card).toContainText('Town Crier');

  // Settings save through the server.
  await card.getByTestId('crier-threshold').fill('8');
  await card.getByTestId('crier-threshold').blur();
  await expect(card).toContainText('scored 8/10 or higher');

  await card.getByTestId('crier-run').click();
  const chat = page.getByTestId('chat');
  await expect(chat.getByRole('heading', { name: 'Town Crier' })).toBeVisible();
  await expect(chat.getByTestId('msg-user')).toContainText('scoring 8 or higher');
  await expect(chat.getByTestId('msg-assistant')).toContainText('.md');
  await chat.getByRole('button', { name: 'Close chat' }).click();

  await page.reload();
  const date = await page
    .getByTestId('crier')
    .getByRole('button', { name: /^\d{4}-\d{2}-\d{2}$/ })
    .first();
  await date.click();
  const report = page.getByTestId('report');
  await expect(report.getByRole('heading', { level: 1 })).toContainText('Town Crier');
  await expect(report).toContainText('Fake model released');
  await page.screenshot({ path: 'e2e-screenshots/11-town-crier-report.png', animations: 'disabled' });
});

test('control routes refuse requests without the token', async ({ request }) => {
  for (const [method, path] of [
    ['GET', '/api/control'],
    ['POST', '/api/chats'],
    ['POST', '/api/crier/run'],
    ['GET', '/api/crier'],
  ] as const) {
    const res = await request.fetch(`${LIVE}${path}`, { method, data: method === 'POST' ? {} : undefined });
    expect(res.status(), `${method} ${path}`).toBe(401);
  }
  const stream = await request.get(`${LIVE}/api/chats/00000000-0000-4000-8000-000000000000/stream`);
  expect(stream.status()).toBe(401);
});

test('the King is crowned, raises a Knight, and gives it orders through the guild tools', async ({
  page,
}) => {
  await openGuild(page);
  await page.getByTestId('talk-to-king').click();
  const crown = page.getByTestId('crown');
  await crown.getByTestId('crown-message').fill(`raise Squire in ${PROJECT}: say hello`);
  await crown.getByTestId('crown-start').click();

  // The King's turn: a real raise_knight call through the MCP server and the guild routes,
  // which starts a Knight whose answer comes back to the King.
  const chat = page.getByTestId('chat');
  await expect(chat.getByRole('heading', { name: 'King' })).toBeVisible();
  await expect(chat.getByTestId('msg-tool').first()).toContainText('raise_knight');
  await expect(chat.getByTestId('msg-assistant').last()).toHaveText(
    'I raised Squire. It reports: You said: say hello',
    {
      timeout: 20_000,
    },
  );

  // A second order goes to the same Knight, which keeps its session.
  await chat.getByTestId('composer').fill('order Squire: report your progress');
  await chat.getByTestId('composer').press('Enter');
  await expect(chat.getByTestId('msg-assistant').last()).toHaveText(
    'Squire reports: You said: report your progress',
    {
      timeout: 20_000,
    },
  );
  await page.screenshot({ path: 'e2e-screenshots/15-king-chat.png', animations: 'disabled' });
  await chat.getByRole('button', { name: 'Close chat' }).click();

  // On the map the King leads the roster, crowned, and Squire serves him.
  await expect(page.locator('.roster .hero-head strong').first()).toHaveText('King');
  await expect(page.locator('.roster')).toContainText('Squire');
  await page.locator('.roster').getByRole('button', { name: 'Open King' }).click();
  await expect(page.getByTestId('hero-rank')).toContainText('King');
  await page.getByTestId('back').click();
  await page.screenshot({ path: 'e2e-screenshots/16-king-map.png', animations: 'disabled' });

  // With a King crowned, the button opens his chat straight away.
  await page.getByTestId('talk-to-king').click();
  await expect(page.getByTestId('chat').getByRole('heading', { name: 'King' })).toBeVisible();
});

test('a Knight shows what it is working on, and "Talk" on the map opens its chat', async ({ page }) => {
  // A session in a terminal: a quest in progress, then a question for the user.
  const id = '5a1e0c2d-7b4f-4e8a-9c3d-1f2e3d4c5b6a';
  const dir = join(LIVE_DIR, PROJECT.replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const at = new Date().toISOString();
  const line = (o: object) => JSON.stringify({ ...o, cwd: PROJECT, sessionId: id, timestamp: at });
  const todos = [
    { content: 'Map the sync code', status: 'completed' },
    { content: 'Fix the flaky sync test', status: 'in_progress' },
  ];
  await writeFile(
    join(dir, `${id}.jsonl`),
    [
      line({ type: 'custom-title', customTitle: 'Bedivere' }),
      line({
        type: 'assistant',
        message: { id: 'b1', content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos } }] },
      }),
      line({
        type: 'assistant',
        message: { id: 'b2', content: [{ type: 'tool_use', name: 'AskUserQuestion', input: {} }] },
      }),
    ].join('\n') + '\n',
  );

  await openGuild(page);
  // Waiting on the user, so its Talk button is already out, in red.
  const talk = page.getByTestId(`talk-${id}`);
  await expect(talk).toBeVisible();
  await expect(talk).toHaveClass(/talk-urgent/);
  await expect(page.getByRole('button', { name: 'Talk to Bedivere' })).toBeVisible();
  await page.screenshot({ path: 'e2e-screenshots/17-talk-on-map.png', animations: 'disabled' });

  // Its panel names the work.
  await page.locator('.roster').getByRole('button', { name: 'Open Bedivere' }).click();
  await expect(page.getByTestId('working-on')).toHaveText('Working on: Fix the flaky sync test');

  await talk.click();
  const chat = page.getByTestId('chat');
  await expect(chat.getByRole('heading', { name: 'Bedivere' })).toBeVisible();
  await page.screenshot({ path: 'e2e-screenshots/18-talk-opens-chat.png', animations: 'disabled' });
});

test('the librarians find and review a skill, and the user installs it from the Skills tab', async ({
  page,
}) => {
  await openGuild(page);
  await page.getByTestId('tab-skills').click();
  const panel = page.getByTestId('skills-panel');
  await expect(panel.getByTestId('nothing-to-review')).toBeVisible();
  await expect(panel.getByTestId('librarians')).toContainText('Paused');
  await expect(panel.getByTestId('librarians-min-stars')).toHaveValue('5000');

  // Run now: the Scout (fake CLI over the real MCP server) adds a candidate pinned to a
  // commit, then the Reviewer records its verdict.
  await panel.getByTestId('librarians-run').click();
  const card = panel.getByTestId('skill-csv-wrangler');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('Fills a gap');
  await expect(card).toContainText('Nothing installed handles plain CSV files.');
  await expect(page.getByTestId('tab-skills')).toContainText('1');
  await expect(panel).toContainText('Scout Librarian');
  // The threshold holds: the Archive refused the Scout's 340-star find.
  await expect(panel).toContainText('tiny-helper had too few stars.');
  await expect(panel.getByTestId('archive')).not.toContainText('tiny-helper');
  await page.screenshot({ path: 'e2e-screenshots/19-skills-to-review.png', animations: 'disabled' });

  // The user's decision: installed at the reviewed commit, into the skills folder.
  await card.getByTestId('install-csv-wrangler').click();
  await expect(panel.getByTestId('nothing-to-review')).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByTestId('archive')).toContainText('Installed');
  expect(await readFile(join(LIVE_SKILLS, 'csv-wrangler', 'SKILL.md'), 'utf8')).toContain(
    'name: csv-wrangler',
  );
  await expect(page.getByTestId('tab-skills')).not.toContainText('1');
  await page.screenshot({ path: 'e2e-screenshots/20-skill-installed.png', animations: 'disabled' });

  // The librarians are inside the Library: its page shows them at their desks.
  await page.getByTestId('tab-guild').click();
  await page.locator('.roster').getByRole('button', { name: 'Open Reviewer' }).click();
  await expect(page.getByTestId('hero-rank')).toContainText('Librarian');
  await page.getByTestId('back').click();
  // A skill the user wrote: no stars, so it sorts after the Archive's.
  await mkdir(join(LIVE_SKILLS, 'zebra-notes'), { recursive: true });
  await writeFile(
    join(LIVE_SKILLS, 'zebra-notes', 'SKILL.md'),
    '---\nname: zebra-notes\ndescription: Keep notes.\n---\n',
  );
  await page.getByTestId('open-library').click();
  const library = page.getByTestId('library-page');
  // Every skill the user has, sortable by stars.
  const yours = library.getByTestId('your-skills');
  const order = () => yours.locator('tbody tr strong').allTextContents();
  await expect(yours.getByTestId('your-skill-csv-wrangler')).toContainText('★ 6,400');
  await expect(yours.getByTestId('your-skill-csv-wrangler')).toContainText('acme-labs/agent-skills');
  await expect(yours.getByTestId('your-skill-zebra-notes')).toContainText('—');
  expect(await order()).toEqual(['csv-wrangler', 'zebra-notes']);
  await yours.getByTestId('sort-name').click();
  await yours.getByTestId('sort-name').click();
  expect(await order()).toEqual(['zebra-notes', 'csv-wrangler']);
  await yours.getByTestId('sort-stars').click();
  expect(await order()).toEqual(['csv-wrangler', 'zebra-notes']);
  await yours.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e-screenshots/22-your-skills.png', animations: 'disabled' });
  await expect(library.getByTestId('desk-Reviewer')).toHaveAttribute('data-state', 'resting');
  await expect(library.getByTestId('library-min-stars')).toHaveText('★ 5,000');
  await expect(library.getByTestId('library-archive')).toContainText('1 installed');
  const scene = page.locator('[data-testid="library-scene"][data-ready="true"]');
  await expect(scene).toHaveAttribute('aria-label', /0 skills wait for you on the Archive board/);
  await page.screenshot({ path: 'e2e-screenshots/21-library-page-live.png', animations: 'disabled' });
  // The Archive board in the scene leads to the Skills tab.
  const box = (await scene.boundingBox())!;
  await scene.click({ position: { x: (560 / 1120) * box.width, y: (640 / 720) * box.height } });
  await expect(page.getByTestId('skills-panel')).toBeVisible();
  await page.getByTestId('tab-guild').click();

  // The King learns of it from the Archive.
  await page.getByTestId('talk-to-king').click();
  const chat = page.getByTestId('chat');
  await chat.getByTestId('composer').fill('consult the archive');
  await chat.getByTestId('composer').press('Enter');
  await expect(chat.getByTestId('msg-assistant').last()).toContainText('csv-wrangler', { timeout: 20_000 });
});

test('a Knight asks the Forge for a skill; the Blacksmith forges it, the Library reviews it, the user installs it', async ({
  page,
}) => {
  // A Knight working in its own project (fictional), started from the browser like any session.
  const bakery = join(LIVE_HOME, 'bakery');
  await mkdir(bakery, { recursive: true });
  await openGuild(page);
  await page.getByTestId('new-session').click();
  const form = page.getByTestId('new-chat');
  await form.getByTestId('new-cwd').fill(bakery);
  await form.getByTestId('new-name').fill('Tristan');
  await form
    .getByTestId('new-message')
    .fill('forge me a skill: write release notes the way this project does');
  await form.getByTestId('new-start').click();

  // 1. The Knight asks the Forge (its request_equipment tool, through the real MCP server).
  const chat = page.getByTestId('chat');
  await expect(chat.getByTestId('msg-assistant').last()).toContainText('Asked the Forge', {
    timeout: 20_000,
  });
  await expect(chat.getByTestId('msg-tool')).toContainText('request_equipment');
  await page.screenshot({ path: 'e2e-screenshots/23-knight-asks-the-forge.png', animations: 'disabled' });
  await chat.getByRole('button', { name: 'Close chat' }).click();

  // 2. The Blacksmith forges it in the Knight's project; the Library's Reviewer tests it.
  await page.getByTestId('open-forge').click();
  const forge = page.getByTestId('forge-page');
  const card = forge.getByTestId('order-release-notes');
  await expect(card).toHaveAttribute('data-status', 'reviewed', { timeout: 40_000 });
  await expect(card).toContainText('asked by Tristan');
  await expect(card).toContainText('bakery');
  await expect(card).toContainText('The Library: Ready to install.');
  await card.locator('summary').click();
  await expect(card).toContainText('scripts/changes.sh');
  const scene = page.locator('[data-testid="forge-scene"][data-ready="true"]');
  await expect(scene).toHaveAttribute('aria-label', /1 piece waits for you on the rack/);
  await expect(page.getByTestId('desk-Blacksmith')).toHaveAttribute('data-state', 'resting');
  await page.screenshot({
    path: 'e2e-screenshots/24-forge-rack.png',
    animations: 'disabled',
    fullPage: true,
  });

  // 3. The user approves: exactly the reviewed files land in the Knight's project.
  await card.getByRole('button', { name: 'Approve & install' }).click();
  await expect(card).toHaveAttribute('data-status', 'installed');
  const skill = join(bakery, '.claude', 'skills', 'release-notes');
  expect(await readFile(join(skill, 'SKILL.md'), 'utf8')).toContain('name: release-notes');
  expect(await readFile(join(skill, 'scripts', 'changes.sh'), 'utf8')).toContain('git log');
  await expect(card).toContainText(`Installed at ${skill}`);

  // 4. The Knight who asked is told where its new skill is.
  await forge.getByTestId('forge-back').click();
  await page.locator('.roster').getByRole('button', { name: 'Open Tristan' }).click();
  await page.getByTestId('open-chat').click();
  await expect(chat.getByTestId('msg-user').last()).toContainText(
    'The Forge: the skill you asked for, "release-notes", was reviewed and the user installed it',
    { timeout: 20_000 },
  );
  await page.screenshot({ path: 'e2e-screenshots/25-knight-told.png', animations: 'disabled' });
});
