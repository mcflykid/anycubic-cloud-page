const {test, expect} = require('@playwright/test');
const {login, openSection} = require('./helpers.cjs');

const styles = ['standard', 'apple', 'blueprint', 'aurora', 'lab', 'glasshouse', 'prism'];

test('sept styles conservent les mêmes destinations, les mesures et les tuiles personnalisées', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await login(page, 'summary');
  const panel = page.locator('#tab-summary');
  const lock = panel.locator('[data-layout-action=lock]');
  const cards = panel.locator('.summary-grid > [data-layout-card]');
  await lock.click();
  await cards.first().locator('[data-layout-action=after]').press('Enter');
  await cards.first().locator('[data-layout-action=resize]').press('Enter');
  await lock.click();

  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 920});
    for (const mode of ['light', 'dark']) {
      for (const style of styles) {
        await openSection(page, 'settings');
        await expect(page.locator('#interface-style option')).toHaveCount(7);
        await page.locator('#interface-theme').selectOption(mode);
        await page.locator('#interface-style').selectOption(style);
        await openSection(page, 'summary');
        await expect(page.locator('html')).toHaveAttribute('data-style', style);
        await expect(page.locator('#summary-job')).toBeVisible();
        await expect(page.locator('#summary-ace-status')).toBeVisible();
        await expect(cards.first()).toHaveAttribute('data-layout-card', 'ace');
        await expect(cards.first()).toHaveAttribute('data-layout-span', '2');
        await expect(lock).toHaveAttribute('aria-pressed', 'false');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    }
  }
});
