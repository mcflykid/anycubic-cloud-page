const {test, expect} = require('@playwright/test');
const {login} = require('./helpers.cjs');

for (const [language, heading] of [['de', 'Übersicht'], ['it', 'Riepilogo']]) {
  test(`le sélecteur conserve la langue ${language} sur mobile et à la connexion`, async ({page}) => {
    await page.setViewportSize({width:390,height:844});
    await login(page, 'summary');
    await page.locator('#interface-language').selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('#atelier-tabs [data-tab=summary]')).toHaveText(heading);
    await expect(page.locator('#interface-language')).toHaveValue(language);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.locator('.logout-form button').click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
  });
}
