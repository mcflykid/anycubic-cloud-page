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

test('le relais ACE reste un choix local jusqu’à son application', async ({ page }) => {
  const orders = [];
  await page.route('**/imprimante-api/command', async route => {
    orders.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await login(page);
  await page.getByRole('button', { name: 'ACE et filaments', exact: true }).click();
  await page.locator('#go-drying').click();

  const relay = page.getByRole('switch', { name: 'Relais automatique des bobines' });
  const track = page.locator('.ace-relay-track');
  await expect(relay).toBeChecked();
  await expect(track).toBeVisible();
  const thumb = track.locator('.ace-relay-thumb');
  const checkedX = (await thumb.boundingBox()).x;
  await relay.press('Space');
  await expect(relay).not.toBeChecked();
  await expect.poll(async () => (await thumb.boundingBox()).x).toBeLessThan(checkedX - 10);
  expect(orders).toHaveLength(0);
});
