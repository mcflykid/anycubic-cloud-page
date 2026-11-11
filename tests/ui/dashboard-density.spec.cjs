const { test, expect } = require('@playwright/test');
const { login } = require('./helpers.cjs');

const styles = ['standard', 'apple', 'blueprint', 'aurora', 'lab', 'glasshouse', 'prism'];
const colors = ['light', 'dark'];
const desktopWidths = [
  { name: 'bureau', width: 1920, height: 1080 },
  { name: 'portable', width: 1366, height: 768 },
];
const tabs = [
  'overview',
  'ace',
  'files',
  'upload',
  'camera',
  'history',
  'statistics',
  'fleet',
  'settings',
];

/** Mesure la largeur du document sans imposer une hauteur artificiellement compacte. */
async function measurePage(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  }));
}

/** Applique chaque palette et style par l’attribut suivi par les thèmes et leurs observateurs. */
async function setAppearance(page, style, color) {
  await page.evaluate(([nextStyle, nextColor]) => {
    document.documentElement.dataset.style = nextStyle;
    document.documentElement.dataset.theme = nextColor;
  }, [style, color]);
}

/** Choisit une section à l’aide du bouton de navigation réel, y compris les styles regroupés. */
async function openTab(page, key) {
  const toggle = page.locator('#section-menu-toggle');
  if (await toggle.isVisible()) {
    if (await page.locator('#atelier-tabs').getAttribute('data-open') !== 'true') {
      await toggle.click({ timeout: 5000 });
      await expect(page.locator('#atelier-tabs')).toHaveAttribute('data-open', 'true');
    }
  }
  await page.locator(`#atelier-tabs [data-tab="${key}"]`).click();
  await expect(page.locator(`#tab-${key}`)).toBeVisible();
  if (key === 'overview') await expect(page.locator('#job-name')).not.toBeEmpty();
  if (key === 'files') await expect(page.locator('#file-rows tr').first()).toBeVisible();
  if (key === 'history') await expect(page.locator('#tasks-list > li').first()).toBeVisible();
  if (key === 'statistics') await expect(page.locator('#chart-nozzle svg')).toBeVisible();
  if (key === 'fleet') await expect(page.locator('#monitor-grid .monitor-card').first()).toBeVisible();
}

test('les onglets du tableau de bord tiennent dans les deux vues ordinateur, sept styles et deux palettes', async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);

  for (const viewport of desktopWidths) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const style of styles) {
      for (const color of colors) {
        await setAppearance(page, style, color);
        for (const tab of tabs) {
          await openTab(page, tab);
          const dimensions = await measurePage(page);
          expect(
            dimensions.width,
            `${style}/${color}/${viewport.name}/${tab}: débordement horizontal ${JSON.stringify(dimensions)}`,
          ).toBeLessThanOrEqual(viewport.width);
          if (tab === 'files') {
            await expect(page.locator('#tab-files .table-scroll')).toHaveCSS('overflow-y', 'auto');
            await expect(page.locator('#tab-files > .section-title')).toBeInViewport();
            await expect(page.locator('#files-form')).toBeInViewport();
          }
          if (tab === 'history') {
            await expect(page.locator('#tasks-list')).toHaveCSS('overflow-y', 'auto');
            await expect(page.locator('#tab-history .section-title')).toBeInViewport();
            await expect(page.locator('.history-filters')).toBeInViewport();
            await expect(page.locator('.history-selection')).toBeInViewport();
          }
        }
      }
    }
  }
});

test('sur téléphone les sept styles restent sans débordement horizontal et gardent état et action visibles', async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);

  for (const style of styles) {
    for (const color of colors) {
      await setAppearance(page, style, color);
      for (const tab of tabs) {
        await openTab(page, tab);
        const dimensions = await measurePage(page);
        expect(
          dimensions.width,
          `${style}/${color}/mobile/${tab}: débordement horizontal ${JSON.stringify(dimensions)}`,
        ).toBeLessThanOrEqual(390);
      }
      await openTab(page, 'overview');
      await expect(page.locator('#printer-model')).toBeInViewport();
      await expect(page.locator('#printer-status')).toBeInViewport();
      await expect(page.locator('#job-name')).toBeInViewport();
      const actions = page.locator('#tab-overview .actions button');
      expect(await actions.count(), `${style}/${color}/mobile: actions d’impression absentes`).toBeGreaterThan(0);
      for (const action of await actions.all()) {
        await expect(action, `${style}/${color}/mobile: action d’impression hors écran`).toBeInViewport();
      }
    }
  }
});

test('les largeurs extrêmes et le seuil de navigation ne débordent dans aucun style', async ({ page }) => {
  test.setTimeout(180000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);

  for (const width of [320, 761, 900]) {
    await page.setViewportSize({ width, height: 844 });
    for (const style of styles) {
      for (const color of colors) {
        await setAppearance(page, style, color);
        for (const tab of tabs) {
          await openTab(page, tab);
          const dimensions = await measurePage(page);
          expect(
            dimensions.width,
            `${style}/${color}/${width}px/${tab}: débordement horizontal ${JSON.stringify(dimensions)}`,
          ).toBeLessThanOrEqual(width);
        }
      }
    }
  }
});

test('le Parc du Laboratoire garde ses neuf graphiques lisibles sur grand écran et sa grille légère sur portable', async ({page}) => {
  test.setTimeout(30000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await setAppearance(page, 'lab', 'dark');
  await openTab(page, 'fleet');
  const largeGrid = page.locator('#monitor-grid');
  await expect(largeGrid.locator('.monitor-card')).toHaveCount(9);
  const largeColumns = await largeGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  const largeCard = await largeGrid.locator('.monitor-card').first().boundingBox();
  expect(largeColumns).toBe(3);
  expect(largeCard.height).toBeGreaterThanOrEqual(138);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1920);

  await page.setViewportSize({ width: 1366, height: 768 });
  await setAppearance(page, 'lab', 'dark');
  await openTab(page, 'fleet');
  const portableColumns = await largeGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(portableColumns).toBe(5);
  expect((await largeGrid.locator('.monitor-card').first().boundingBox()).height).toBeLessThan(138);
});
