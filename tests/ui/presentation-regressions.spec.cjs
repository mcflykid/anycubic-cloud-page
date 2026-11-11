const {test, expect} = require('@playwright/test');
const {login, openSection} = require('./helpers.cjs');

test('les deux cartes thermiques occupent des cases distinctes', async ({page}) => {
  await page.setViewportSize({width: 1418, height: 759});
  await login(page, 'statistics');
  await expect(page.locator('#chart-bed svg')).toBeVisible();
  const nozzle = await page.locator('#chart-nozzle').boundingBox();
  const bed = await page.locator('#chart-bed').boundingBox();
  expect(nozzle.x + nozzle.width).toBeLessThanOrEqual(bed.x);
});

async function mockHistory(route) {
  const response = await route.fetch();
  const data = await response.json();
  const items = Array.from({length: 15}, (_, i) => ({
    ...data.items[i % data.items.length],
    key: 'fixture-' + i,
    name: 'Impression fictive ' + (i + 1),
  }));
  await route.fulfill({response, json: {...data, items, has_more: false}});
}

test('les fiches de l’historique peuvent défiler sans rogner leur contenu', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.route('**/imprimante-api/extras/tasks?*', mockHistory);
  await login(page, 'history');
  const rows = page.locator('#tasks-list > li');
  await expect(rows).toHaveCount(15);
  const measurements = await rows.first().evaluate(card => ({
    visible: card.clientHeight,
    content: card.scrollHeight,
  }));
  expect(measurements.visible).toBeGreaterThanOrEqual(measurements.content - 1);
  await rows.last().locator('.history-card-name').scrollIntoViewIfNeeded();
  await expect(rows.last().locator('.history-card-name')).toBeInViewport();
});

test('la caméra et ses commandes partagent la même largeur sur grand écran', async ({page}) => {
  await page.setViewportSize({width: 1720, height: 900});
  await login(page, 'camera');
  const stage = await page.locator('#camera-wrapper').boundingBox();
  const controls = await page.locator('.camera-controls').boundingBox();
  const axes = await page.locator('.axis-card').boundingBox();
  expect(Math.abs(controls.width - stage.width)).toBeLessThan(3);
  expect(axes.x - stage.x - stage.width).toBeGreaterThanOrEqual(0);
  expect(axes.x - stage.x - stage.width).toBeLessThan(24);
  await expect(page.locator('.axis-step-control label').last()).toHaveCSS('white-space', 'nowrap');
});

const styles = ['standard', 'apple', 'blueprint', 'aurora', 'lab', 'glasshouse'];

for (const style of styles) {
  for (const mode of ['light', 'dark']) {
    test(`${style} ${mode} garde les graphiques, l’historique et la caméra lisibles`, async ({page}) => {
      await page.emulateMedia({reducedMotion: 'reduce'});
      await page.route('**/imprimante-api/extras/tasks?*', mockHistory);
      await login(page, 'settings');
      await page.locator('#interface-theme').selectOption(mode);
      await page.locator('#interface-style').selectOption(style);

      for (const [width, height] of [[1366, 768], [1920, 1080], [390, 844]]) {
        await page.setViewportSize({width, height});
        await openSection(page, 'statistics');
        await expect(page.locator('#chart-nozzle svg')).toBeVisible();
        await expect(page.locator('#chart-bed svg')).toBeVisible();
        const nozzle = await page.locator('#chart-nozzle').boundingBox();
        const bed = await page.locator('#chart-bed').boundingBox();
        // Sur mobile les deux courbes peuvent être empilées.
        const overlapX = Math.min(nozzle.x + nozzle.width, bed.x + bed.width) - Math.max(nozzle.x, bed.x);
        const overlapY = Math.min(nozzle.y + nozzle.height, bed.y + bed.height) - Math.max(nozzle.y, bed.y);
        expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(1);

        await openSection(page, 'history');
        const cards = page.locator('#tasks-list > li');
        await expect(cards).toHaveCount(15);
        expect(await cards.first().evaluate(card => card.scrollHeight - card.clientHeight)).toBeLessThanOrEqual(1);
        const lastTitle = cards.last().locator('.history-card-name');
        await expect(async () => {
          await lastTitle.evaluate(title => title.scrollIntoView({block: 'nearest'}));
          await expect(lastTitle).toBeInViewport({timeout: 500});
        }).toPass({timeout: 5000});

        await openSection(page, 'camera');
        const stage = await page.locator('#camera-wrapper').boundingBox();
        const controls = await page.locator('.camera-controls').boundingBox();
        const axes = await page.locator('.axis-card').boundingBox();
        if (width > 400) {
          expect(Math.abs(controls.width - stage.width)).toBeLessThan(3);
          expect(axes.x - stage.x - stage.width).toBeLessThan(24);
          expect(axes.x).toBeGreaterThanOrEqual(stage.x + stage.width - 1);
        } else {
          expect(axes.y).toBeGreaterThan(stage.y);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        }
      }
    });
  }
}
