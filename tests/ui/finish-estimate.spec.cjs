const {test, expect} = require('@playwright/test');
const {login, openSection} = require('./helpers.cjs');

test('la fin annoncée se fonde sur le relevé de temps restant', async ({page}) => {
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.updated_at = '2026-11-14T03:06:00Z';
    json.mqtt_updated_at = json.updated_at;
    Object.assign(json.printer, {
      job_state: 'printing', job_time_remaining: 37,
    });
    await route.fulfill({response, json});
  });
  await login(page, 'summary');
  await expect(page.locator('#summary-finish')).toHaveText('Fin prévue 04:43');
  await openSection(page, 'overview');
  await expect(page.locator('#printer-finish')).toHaveText('Fin prévue 04:43');
});
