const {test, expect} = require('@playwright/test');
const {login, openSection} = require('./helpers.cjs');

const styles = ['standard', 'aurora', 'lab', 'glasshouse'];

test('quatre styles conservent les mêmes destinations, les mesures et l’ordre des cartes', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await login(page, 'summary');
  const panel = page.locator('#tab-summary');
  const cards = panel.locator('.summary-grid > section');

  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 920});
    for (const mode of ['light', 'dark']) {
      for (const style of styles) {
        await openSection(page, 'settings');
        await expect(page.locator('#interface-style option')).toHaveCount(4);
        await page.locator('#interface-theme').selectOption(mode);
        await page.locator('#interface-style').selectOption(style);
        await openSection(page, 'summary');
        await expect(page.locator('html')).toHaveAttribute('data-style', style);
        await expect(page.locator('#summary-job')).toBeVisible();
        await expect(page.locator('#summary-ace-status')).toBeVisible();
        await expect(cards.first()).toHaveClass(/summary-printer/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    }
  }
});
