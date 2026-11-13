const {test, expect} = require('@playwright/test');
const {login, openSection} = require('./helpers.cjs');

test('l’estimation corrigée est consultable et désactivable', async ({page}) => {
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.printer.corrected_finish = {
      finish:1794590400, original:1794588600, samples:8, factor:1.2, live_weight:50,
    };
    await route.fulfill({response, json});
  });
  await login(page, 'summary');
  await expect(page.locator('#summary-finish')).toContainText('estimation du fichier');
  await expect(page.locator('#summary-finish')).toHaveAttribute('title', /8 impressions réussies/);
  await openSection(page, 'overview');
  await expect(page.locator('#printer-finish')).toBeVisible();
  await page.locator('#task-details-open').click();
  const band = page.locator('#correct-finish-settings');
  await expect(band).toBeVisible();
  await expect(band).toContainText('Corrigée avec l’historique');
  await expect(band).toContainText('8 impressions réussies');
  await page.locator('#correct-finish').uncheck();
  // La bande reste visible pour permettre de réactiver la correction.
  await expect(band).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#printer-finish')).toBeHidden();
  await openSection(page, 'summary');
  await expect(page.locator('#summary-finish')).toBeHidden();
});
