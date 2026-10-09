import { mkdirSync } from 'node:fs';

import type { Locator, Page } from '@playwright/test';

import { THEMES } from '../src/themes.ts';

/**
 * Screenshots for a person to look at. CI posts them on the pull request, one row per
 * shot with a column per theme, because an assertion can say an element exists but not
 * that the page looks right in every theme.
 */
export const SHOTS = 'e2e-screenshots';
mkdirSync(SHOTS, { recursive: true });

/**
 * Save `name` once per theme, as `<name>--<theme>.png`, then put the page's own theme
 * back. Themes are pure CSS on <html data-theme>, so switching the attribute repaints the
 * same state without a reload and every column shows exactly the same moment.
 */
export async function shoot(
  target: Page | Locator,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  const page = 'page' in target ? target.page() : target;
  const original = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
  try {
    for (const theme of THEMES) {
      await page.evaluate(async (id) => {
        document.documentElement.dataset.theme = id;
        await document.fonts.ready;
        // Two frames: one to apply the styles, one to paint them.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, theme.id);
      await target.screenshot({
        path: `${SHOTS}/${name}--${theme.id}.png`,
        animations: 'disabled',
        ...options,
      });
    }
  } finally {
    await page.evaluate((id) => {
      if (id === null) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = id;
    }, original);
  }
}
