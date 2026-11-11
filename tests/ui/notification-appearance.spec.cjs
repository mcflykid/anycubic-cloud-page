const { test, expect } = require('@playwright/test');
const { login } = require('./helpers.cjs');

const styles = ['standard', 'aurora', 'lab'];
const palettes = ['light', 'dark'];

/** Charge un message d'erreur fictif pour vérifier sa lecture sans appeler le Cloud. */
async function loadErrorNotice(page) {
  const notifications = {
    source: 'slicer',
    unread: 1,
    has_more: false,
    items: [{
      key: 'appearance-notification-error',
      name: 'support.3mf_temp/fixture.gcode',
      printer: 'Kobra de démonstration',
      result: 'Notification d’impression',
      kind: 'info',
      unread: true,
      time: 1762340000,
      reason: 'The printer cannot parse the file',
      reason_code: '10115',
      error_title: 'L’imprimante ne peut pas lire ce fichier',
      error_description: 'Le fichier peut être endommagé après un tranchage interrompu ou être dans un format incorrect.',
      help_url: 'https://wiki.anycubic.com/en/error-codes',
    }],
  };
  await page.route('**/imprimante-api/status', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), notifications } });
  });
  await page.route('**/imprimante-api/history?*', (route) => route.fulfill({ json: notifications }));
  await login(page);
}

/** Applique la présentation réelle de l'atelier sans enregistrer une préférence durable. */
async function setAppearance(page, style, palette) {
  await page.evaluate(([nextStyle, nextPalette]) => {
    document.documentElement.dataset.style = nextStyle;
    document.documentElement.dataset.theme = nextPalette;
  }, [style, palette]);
}

test('le panneau des notifications reste lisible dans les trois styles et les deux palettes', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await loadErrorNotice(page);

  for (const style of styles) {
    for (const palette of palettes) {
      await setAppearance(page, style, palette);
      await page.locator('#notifications-toggle').click();
      const row = page.locator('.notification-row');
      await expect(row).toContainText('support.3mf_temp/fixture.gcode');
      await expect(row.locator('.notification-meta time')).toBeVisible();
      await expect(row.locator('.notification-result')).toBeVisible();
      const code = row.getByRole('button', { name: 'Code d’erreur : 10115' });
      await expect(code).toBeVisible();
      await code.hover();
      await expect(row.locator('[role="tooltip"]')).toBeVisible();
      const geometry = await page.evaluate(() => {
        const box = document.querySelector('#notifications-panel').getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width, viewport: innerWidth, document: document.documentElement.scrollWidth };
      });
      expect(geometry.left, `${style}/${palette}: panneau hors écran à gauche`).toBeGreaterThanOrEqual(0);
      expect(geometry.right, `${style}/${palette}: panneau hors écran à droite`).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.document, `${style}/${palette}: débordement de page`).toBeLessThanOrEqual(geometry.viewport);
      await page.keyboard.press('Escape');
    }
  }
});

test('le panneau et le code restent dans les écrans étroits et les grandes interfaces compactes', async ({ page }) => {
  test.setTimeout(120000);
  await loadErrorNotice(page);

  for (const width of [320, 390, 761, 900]) {
    await page.setViewportSize({ width, height: 844 });
    for (const style of styles) {
      for (const palette of palettes) {
        await setAppearance(page, style, palette);
        await page.keyboard.press('Escape');
        await page.locator('#notifications-toggle').click();
        const panel = page.locator('#notifications-panel');
        const code = page.locator('.notification-error-link');
        await expect(panel, `${width}/${style}/${palette}: panneau fermé après clic`).toBeVisible();
        await expect(code, `${width}/${style}/${palette}: code absent du panneau`).toBeVisible();
        await expect(page.locator('#history-read-all').locator('..')).toHaveClass(/notification-actions/);
        await expect(page.locator('.notification-meta time')).toBeVisible();
        const geometry = await panel.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, width: box.width, viewport: innerWidth, document: document.documentElement.scrollWidth };
        });
        if (width > 640) {
          const [filters, search] = await Promise.all([
            page.locator('.notice-filters').boundingBox(),
            page.locator('.notice-search').boundingBox(),
          ]);
          expect(Math.abs(filters.y - search.y), `${width}/${style}/${palette}: filtres et recherche désalignés`).toBeLessThan(3);
        }
        expect(geometry.left, `${width}/${style}/${palette}: panneau hors écran à gauche`).toBeGreaterThanOrEqual(0);
        expect(geometry.right, `${width}/${style}/${palette}: panneau hors écran à droite`).toBeLessThanOrEqual(width);
        expect(geometry.document, `${width}/${style}/${palette}: débordement horizontal`).toBeLessThanOrEqual(width);
        await page.keyboard.press('Escape');
      }
    }
  }
});
