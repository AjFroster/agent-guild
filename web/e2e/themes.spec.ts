import { join } from 'node:path';

import { type Locator, type Page, expect, test } from '@playwright/test';

import { THEMES as THEME_LIST } from '../src/themes.ts';
import { shoot } from './shots.ts';

import { LIVE_HOME, LIVE_PORT, LIVE_TOKEN } from '../playwright.config.ts';

/**
 * The gear button, the theme picker in Settings, and each theme repainting the panels,
 * chat and forms while the village stays as drawn.
 */
const LIVE = `http://127.0.0.1:${LIVE_PORT}`;

/** Each theme's panel colour and section-label font, straight from themes.css. */
const THEMES = [
  { id: 'control-room', name: 'Control Room', panel: 'rgb(19, 21, 24)', font: 'JetBrains Mono' },
  { id: 'telemetry', name: 'Telemetry', panel: 'rgb(10, 13, 14)', font: 'IBM Plex Mono' },
  { id: 'hazard', name: 'Hazard', panel: 'rgb(216, 215, 209)', font: 'Space Grotesk' },
  { id: 'classic', name: 'Classic', panel: 'rgb(24, 32, 21)', font: null },
] as const;

const css = (loc: Locator, prop: string) =>
  loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Choose a theme the way a person would: gear, then the theme's row, then Done. */
async function pickTheme(page: Page, name: string) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByTestId('settings');
  await dialog.getByRole('radio', { name: new RegExp(`^${name}`) }).check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

test('settings open from a gear button', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  const gear = page.getByRole('button', { name: 'Settings' });
  await expect(gear).toBeVisible();
  await expect(gear).toHaveText('');
  await expect(gear.locator('svg')).toBeVisible();
  await gear.click();
  const dialog = page.getByTestId('settings');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Theme' })).toBeVisible();
});

test('Control Room is the theme until another is chosen', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'control-room');
  await page.getByRole('button', { name: 'Settings' }).click();
  const radios = page.getByTestId('theme-picker').getByRole('radio');
  await expect(radios).toHaveCount(THEMES.length);
  await expect(page.getByRole('radio', { name: /^Control Room/ })).toBeChecked();
});

for (const theme of THEMES) {
  test(`the ${theme.name} theme repaints the panels and keeps the village`, async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto('/?demo=party&t=20');
    await pickTheme(page, theme.name);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);

    await expect(page.locator('.panel')).toHaveCSS('background-color', theme.panel);
    if (theme.font) {
      // The section labels use the theme's bundled face, and it actually loaded.
      expect(await css(page.locator('.panel .section').first(), 'font-family')).toContain(theme.font);
      expect(await page.evaluate((f) => document.fonts.check(`12px "${f}"`), theme.font)).toBe(true);
    }
    // The village is drawn the same in every theme.
    await expect(page.locator('[data-testid="village"][data-ready="true"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test('every theme is in the list the tests check', () => {
  expect(THEMES.map((t) => t.id)).toEqual(THEME_LIST.map((t) => t.id));
});

test('the Settings dialog and the new-session form, in every theme', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await page.getByRole('button', { name: 'Settings' }).click();
  await shoot(page.getByTestId('settings'), '37-settings');
  await page.getByTestId('settings').getByRole('button', { name: 'Done' }).click();

  await page.goto(`${LIVE}/?token=${LIVE_TOKEN}&open=new`);
  const form = page.getByTestId('new-chat');
  await expect(form).toBeVisible();
  await form.getByTestId('new-cwd').fill('~/code/lighthouse');
  await form.getByTestId('new-message').fill('Fix the flaky upload test and open a PR.');
  await shoot(form, '38-new-session');
});

test('the chosen theme survives a reload and is on the page before it draws', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await pickTheme(page, 'Hazard');
  // Record the theme at the very first script, before React has rendered anything.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { firstTheme?: string | undefined }).firstTheme =
        document.documentElement.dataset.theme;
    });
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'hazard');
  expect(
    await page.evaluate(() => (window as unknown as { firstTheme?: string | undefined }).firstTheme),
  ).toBe('hazard');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('radio', { name: /^Hazard/ })).toBeChecked();
});

test('a theme that no longer exists falls back to Control Room', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('agent-guild:settings', JSON.stringify({ theme: 'neon', sound: false }));
  });
  await page.goto('/?demo=party&t=20');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'control-room');
  await page.getByRole('button', { name: 'Settings' }).click();
  // Other choices stored beside it are kept.
  await expect(page.getByTestId('settings').getByLabel('Play a sound with notices')).not.toBeChecked();
});

test('the Settings dialog wears each theme', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  for (const theme of THEMES) {
    await pickTheme(page, theme.name);
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByTestId('settings');
    await expect(dialog).toHaveCSS('background-color', theme.panel);
    await expect(dialog.getByTestId(`theme-${theme.id}`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
  }
});

test.describe('live chat in each theme', () => {
  test.describe.configure({ mode: 'serial' });
  let chatId = '';

  test.beforeAll(async ({ request }) => {
    // A session of its own, so these tests don't depend on chat.spec.ts running first.
    const res = await request.post(`${LIVE}/api/chats`, {
      headers: { authorization: `Bearer ${LIVE_TOKEN}` },
      data: {
        cwd: join(LIVE_HOME, 'proj'),
        name: 'Painter',
        mode: 'acceptEdits',
        message: 'please use a tool',
      },
    });
    expect(res.ok()).toBe(true);
    chatId = ((await res.json()) as { id: string }).id;
  });

  for (const theme of THEMES) {
    test(`the chat drawer, composer and new-session form in ${theme.name}`, async ({ page }) => {
      const errors = watchForErrors(page);
      await page.addInitScript((id) => {
        window.localStorage.setItem('agent-guild:settings', JSON.stringify({ theme: id }));
      }, theme.id);

      // The new-session form: the drawer and its fields take the theme.
      await page.goto(`${LIVE}/?token=${LIVE_TOKEN}&open=new`);
      await expect(page.getByTestId('live-status')).toHaveText('Live');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
      const form = page.getByTestId('new-chat');
      await expect(form).toHaveCSS('background-color', theme.panel);
      await form.getByTestId('new-message').fill('Tidy the README');
      await form.getByRole('button', { name: 'Cancel' }).click();

      // The Needs-you tab.
      await page.getByTestId('tab-inbox').click();
      await expect(page.getByTestId('inbox')).toBeVisible();

      // The chat drawer with a conversation and a tool call, and the composer.
      await page.goto(`${LIVE}/?open=chat:${chatId}`);
      const chat = page.getByTestId('chat');
      await expect(chat).toHaveCSS('background-color', theme.panel);
      await expect(chat.getByTestId('msg-tool')).toBeVisible();
      await expect(chat.getByTestId('msg-assistant').first()).toBeVisible();
      await chat.getByTestId('composer').fill('Now run the tests');
      await expect(chat.getByTestId('send')).toBeEnabled();
      expect(errors).toEqual([]);
    });
  }
});
