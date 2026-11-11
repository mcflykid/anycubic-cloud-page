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
  const rows = page.locator('#tasks-list > tr');
  await expect(rows).toHaveCount(15);
  const measurements = await rows.first().evaluate(card => ({
    visible: card.clientHeight,
    content: card.scrollHeight,
  }));
  expect(measurements.visible).toBeGreaterThanOrEqual(measurements.content - 1);
  await rows.last().locator('.history-card-name').scrollIntoViewIfNeeded();
  await expect(rows.last().locator('.history-card-name')).toBeInViewport();
});

test('le flux vidéo reste dans sa carte et les deux pieds s’alignent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await login(page, 'camera');
  await expectCameraLayout(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCameraLayout(page, false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

async function expectCameraLayout(page, sideBySide) {
  const [stage, feed, commands, feedFooter, commandFooter] = await Promise.all(
    ['#camera-wrapper', '.camera-feed', '.camera-command-card', '.camera-feed-actions', '.camera-warning']
      .map(selector => page.locator(selector).boundingBox()),
  );
  expect(stage.x).toBeGreaterThan(feed.x);
  expect(stage.x + stage.width).toBeLessThan(feed.x + feed.width);
  if (sideBySide) {
    expect(Math.abs(feed.width - commands.width)).toBeLessThan(1);
    expect(Math.abs(feedFooter.y - commandFooter.y)).toBeLessThan(1);
  } else {
    expect(commands.y).toBeGreaterThanOrEqual(feed.y + feed.height);
  }
}

async function filamentRows(page) {
  const groups = page.locator('#chart-filament > section');
  return groups.evaluateAll(sections => sections.map(section => {
    const cards = Array.from(section.querySelectorAll('.temperature-card'), card => {
      const {left, right, top, bottom} = card.getBoundingClientRect();
      return {left, right, top, bottom};
    });
    return cards;
  }));
}

function expectSingleFilamentRow(cards) {
  expect(cards).toHaveLength(4);
  for (const [index, card] of cards.entries()) {
    expect(card.right).toBeGreaterThan(card.left);
    expect(Math.abs(card.top - cards[0].top)).toBeLessThan(2);
    if (index) expect(card.left).toBeGreaterThanOrEqual(cards[index - 1].right - 1);
  }
}

test('les quatre graphiques de chaque ACE ont leur propre ligne', async ({page}) => {
  await page.setViewportSize({width: 1366, height: 768});
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch();
    const data = await response.json();
    const [ace] = data.printer.boxes;
    data.printer.boxes.push({...ace, box_id: 1, model: 'ACE Mini'});
    await route.fulfill({response, json: data});
  });
  await page.route('**/imprimante-api/temperatures?*', async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const reading of data.readings) {
      reading.ace_boxes[1] = reading.ace_boxes[0];
    }
    await route.fulfill({response, json: data});
  });
  await login(page, 'statistics');
  await expect(page.locator('#chart-filament .ace-chart-group-name')).toHaveText(['ACE 2 Pro', 'ACE Mini']);
  await expect(page.locator('#chart-filament .temperature-card svg')).toHaveCount(8);
  const [first, second] = await filamentRows(page);
  expectSingleFilamentRow(first);
  expectSingleFilamentRow(second);
  expect(second[0].top).toBeGreaterThan(first[0].bottom);
});

const styles = ['standard', 'aurora', 'lab', 'glasshouse'];

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
        await expect(page.locator('#chart-filament .temperature-card svg')).toHaveCount(4);
        // Une actualisation peut remplacer les graphiques pendant la mesure.
        await expect(async () => {
          const [filament] = await filamentRows(page);
          expect(filament).toHaveLength(4);
          expect(filament.every(card => card.right > card.left && card.bottom > card.top)).toBe(true);
          if (width > 400) {
            expectSingleFilamentRow(filament);
          } else {
            expect(filament.at(-1).top).toBeGreaterThan(filament[0].top);
            expect(filament.every(card => card.left >= 0 && card.right <= width)).toBe(true);
          }
        }).toPass({timeout: 5000});

        await openSection(page, 'history');
        const cards = page.locator('#tasks-list > tr');
        await expect(cards).toHaveCount(15);
        expect(await cards.first().evaluate(card => card.scrollHeight - card.clientHeight)).toBeLessThanOrEqual(1);
        const lastTitle = cards.last().locator('.history-card-name');
        await expect(async () => {
          await lastTitle.evaluate(title => title.scrollIntoView({block: 'nearest'}));
          await expect(lastTitle).toBeInViewport({timeout: 500});
        }).toPass({timeout: 5000});

        await openSection(page, 'camera');
        const sideBySide = await page.locator('.camera-workspace').evaluate(
          element => getComputedStyle(element).gridTemplateColumns.split(' ').length > 1,
        );
        await expectCameraLayout(page, sideBySide);
      }
    });
  }
}
