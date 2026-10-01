import { expect, test } from '@playwright/test';

test('settings are saved in the browser and survive a reload', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await page.getByTestId('open-settings').click();
  const dialog = page.getByTestId('settings');
  await expect(dialog).toBeVisible();
  const sound = dialog.getByLabel('Play a sound with notices');
  await expect(sound).toBeChecked();
  await sound.uncheck();
  await dialog.getByLabel('Tell me when a session joins or leaves').check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings').getByLabel('Play a sound with notices')).not.toBeChecked();
  await expect(
    page.getByTestId('settings').getByLabel('Tell me when a session joins or leaves'),
  ).toBeChecked();
});

test('the first-run hint goes away for good once dismissed', async ({ page }) => {
  await page.goto('/?demo=solo');
  await expect(page.getByTestId('hint')).toBeVisible();
  await page.getByTestId('hint').getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByTestId('hint')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('guild')).toBeVisible();
  await expect(page.getByTestId('hint')).toHaveCount(0);
});

test('demo mode never raises notices, so screenshots stay still', async ({ page }) => {
  await page.goto('/?demo=party&t=20');
  await expect(page.getByTestId('beacon')).toBeVisible();
  await expect(page.getByTestId('toasts')).toHaveCount(0);
});
