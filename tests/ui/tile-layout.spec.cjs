const { test, expect } = require('@playwright/test');
const { login } = require('./helpers.cjs');

test('une ancienne disposition enregistrée ne modifie plus le résumé', async ({ page }) => {
  // Simule une disposition personnalisée enregistrée avant la refonte.
  await page.addInitScript(() => {
    localStorage.setItem('cloud-page-tile-layout-v1', JSON.stringify({
      version: 1,
      layouts: { summary: { order: ['ace', 'printer'], spans: { ace: 2 } } },
    }));
  });
  await login(page, 'summary');
  await expect(page.locator('.summary-grid > section').first()).toHaveClass(/summary-printer/);
  await expect(page.locator('[data-layout-action]')).toHaveCount(0);
  await page.locator('[data-tab=settings]').click();
  await expect(page.locator('#settings-layout-backup')).toHaveCount(0);
});
