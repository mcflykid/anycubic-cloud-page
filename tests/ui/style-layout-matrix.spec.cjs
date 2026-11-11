const {test, expect} = require('@playwright/test');
const {login, openSection} = require('./helpers.cjs');

const styles = ['standard', 'aurora', 'lab'];

test('trois styles conservent les mêmes destinations, les mesures et l’ordre des cartes', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await login(page, 'summary');
  const panel = page.locator('#tab-summary');
  const cards = panel.locator('.summary-grid > section');

  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 920});
    for (const mode of ['light', 'dark']) {
      for (const style of styles) {
        await openSection(page, 'settings');
        await expect(page.locator('#interface-style option')).toHaveCount(styles.length);
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

test('les dix écrans de démonstration tiennent dans la fenêtre sur ordinateur', async ({ page }) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, 'summary');
  const origin = new URL(page.url()).origin;
  await page.request.post('/imprimante-api/demo/reset', { data: {}, headers: { Origin: origin } });
  await page.reload();
  await expect(page.getByText('En ligne', { exact: true }).first()).toBeVisible();

  const sections = ['summary', 'overview', 'ace', 'files', 'upload', 'camera', 'history', 'fleet', 'statistics', 'settings'];
  for (const [width, height] of [[1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['light', 'dark']) {
      for (const style of styles) {
        await page.evaluate(([style, mode]) => {
          document.documentElement.dataset.style = style;
          document.documentElement.dataset.theme = mode;
        }, [style, mode]);
        for (const section of sections) {
          await openSection(page, section);
          if (section === 'fleet') await expect(page.locator('#monitor-grid .monitor-card').first()).toBeVisible();
          if (section === 'history') await expect(page.locator('#tasks-list tr').first()).toBeVisible();
          if (section === 'statistics') await expect(page.locator('#chart-nozzle svg')).toBeVisible();
          const size = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
          }));
          expect(size.width, section + '/' + style + '/' + mode).toBeLessThanOrEqual(width);
          expect(size.height, section + '/' + style + '/' + mode).toBeLessThanOrEqual(height);
        }
      }
    }
  }
});
