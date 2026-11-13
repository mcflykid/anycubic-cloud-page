const { test, expect } = require('@playwright/test');
const { login } = require('./helpers.cjs');

test('les sources de stockage restent accessibles au clavier et sur mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'files');
  const tabs = page.locator('#files-form .files-sources');
  const usb = tabs.getByRole('button', { name: 'Clé USB' });
  const cloud = tabs.getByRole('button', { name: 'Cloud Anycubic' });
  await usb.focus();
  await usb.press('Enter');
  await expect(usb).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await cloud.click();
  await expect(cloud).toHaveAttribute('aria-pressed', 'true');
  await expect(usb).toHaveAttribute('aria-pressed', 'false');
  const bounds = await cloud.boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
});

test('le relais ACE demande confirmation depuis la carte du module', async ({page}) => {
  const orders = [];
  await page.route('**/imprimante-api/command', async route => {
    orders.push(route.request().postDataJSON());
    await route.fulfill({json: {ok: true}});
  });
  await login(page);
  await page.getByRole('button', {name: 'ACE et filaments', exact: true}).click();
  const relay = page.locator('#ace-relay-open');
  await expect(relay).toHaveText('Désactiver');
  await relay.press('Space');
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await expect(page.locator('#dry-dialog')).toBeHidden();
  await page.locator('#confirm-no').click();
  expect(orders).toHaveLength(0);
  await relay.click();
  await page.locator('#confirm-yes').click();
  await expect.poll(() => orders.length).toBe(1);
  expect(orders[0]).toMatchObject({action: 'auto-feed', box: 0, enabled: false});
});
