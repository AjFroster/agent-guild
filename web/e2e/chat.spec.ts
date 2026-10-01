import { join } from 'node:path';

import { type Page, expect, test } from '@playwright/test';

import { LIVE_HOME, LIVE_PORT, LIVE_TOKEN } from '../playwright.config.ts';

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
