const {test, expect} = require('@playwright/test');
const {login, openSection} = require('./helpers.cjs');

test('la disposition se déplace, se redimensionne et se retrouve après actualisation', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await login(page, 'summary');
  const panel = page.locator('#tab-summary');
  const lock = panel.locator('[data-layout-action=lock]');
  const cards = panel.locator('[data-layout-card]');
  const printer = panel.locator('[data-layout-card=printer]');
  const ace = panel.locator('[data-layout-card=ace]');
  const handle = printer.locator('[data-layout-action=drag]');
  const resize = printer.locator('[data-layout-action=resize]');
  await expect(handle).toBeHidden();
  await lock.click();
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const to = await ace.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width * .75, to.y + 60);
  await page.mouse.up();
  await expect(cards.first()).toHaveAttribute('data-layout-card', 'ace');
  await resize.scrollIntoViewIfNeeded();
  const grip = await resize.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 160, grip.y + grip.height / 2);
  await page.mouse.up();
  await expect(printer).toHaveAttribute('data-layout-span', '2');
  await resize.press('Enter');
  await expect(printer).toHaveAttribute('data-layout-span', '1');
  await resize.press('Enter');
  await expect(printer).toHaveAttribute('data-layout-span', '2');
  await openSection(page, 'ace');
  await openSection(page, 'summary');
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(cards.first()).toHaveAttribute('data-layout-card', 'ace');
  await expect(printer).toHaveAttribute('data-layout-span', '2');
  await expect(handle).toBeHidden();
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.locator('body').evaluate(body => body.scrollWidth)).toBeLessThanOrEqual(390);
});

test('la sauvegarde contient uniquement les dispositions et un fichier invalide conserve les réglages', async ({page}) => {
  await login(page, 'settings');
  const restore = page.locator('#layout-import');
  const json = (body) => ({name: 'disposition.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(body))});
  const valid = {version:1, layouts:{summary:{order:['ace','printer'],spans:{ace:2}}}};
  await restore.setInputFiles(json(valid));
  await expect(page.getByText('Disposition restaurée.')).toBeVisible();
  await restore.setInputFiles(json({version:1, layouts:{summary:{order:[],spans:{}}}}));
  await expect(page.getByText('Sauvegarde de disposition invalide.')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#layout-export').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(valid);
});

test('le glissement tactile atteint les cartes sous le premier écran', async ({browser}) => {
  const context = await browser.newContext({viewport:{width:390,height:760},hasTouch:true,reducedMotion:'reduce'});
  try {
    const page = await context.newPage();
    await login(page, 'summary');
    const panel = page.locator('#tab-summary');
    const cards = panel.locator('[data-layout-card]');
    await panel.locator('[data-layout-action=lock]').tap();
    const handle = cards.first().locator('[data-layout-action=drag]');
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox();
    const input = await context.newCDPSession(page);
    // Le contact reste près du bord inférieur jusqu’à ce que la seconde carte remonte.
    await input.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:from.x+from.width/2,y:from.y+from.height/2}]});
    await input.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:195,y:747}]});
    await expect(cards.first()).toHaveAttribute('data-layout-card','ace');
    await input.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await page.reload();
    await expect(cards.first()).toHaveAttribute('data-layout-card','ace');
  } finally {
    await context.close();
  }
});

test('les cartes utilisent le ressort Parrilla et suivent la préférence sans mouvement', async ({page}) => {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    window.tileMotion = [];
    Element.prototype.animate = function (frames, options) {
      if (options?.id === 'tile-position') window.tileMotion.push(options);
      return animate.call(this, frames, options);
    };
  });
  await login(page, 'summary');
  const panel = page.locator('#tab-summary');
  await panel.locator('[data-layout-action=lock]').click();
  const cards = panel.locator('[data-layout-card]');
  await cards.first().locator('[data-layout-action=after]').press('Enter');
  const animated = await page.evaluate(() => window.tileMotion);
  expect(animated.length).toBeGreaterThan(0);
  expect(animated.every(animation => animation.duration === 800)).toBe(true);
  expect(animated[0].easing).toMatch(/^linear\(0\.0000, /);

  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await cards.first().locator('[data-layout-action=after]').press('Enter');
  expect(await page.evaluate(() => window.tileMotion.length)).toBe(animated.length);
});

test('la grille et la case d’insertion suivent le geste puis se retirent au verrouillage', async ({page}) => {
  await login(page, 'summary');
  const panel = page.locator('#tab-summary');
  const group = panel.locator('.summary-grid');
  const lock = panel.locator('[data-layout-action=lock]');
  const first = panel.locator('[data-layout-card=printer]');
  const second = panel.locator('[data-layout-card=ace]');
  await expect(group).toHaveCSS('background-image', 'none');
  await lock.click();
  await expect(group).not.toHaveCSS('background-image', 'none');

  const grip = first.locator('[data-layout-action=drag]');
  const from = await grip.boundingBox();
  const to = await second.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width * .8, to.y + 70, {steps: 6});
  await expect(group.locator('.layout-drop-target')).toHaveAttribute('data-layout-drop', '');
  await expect(first).not.toHaveCSS('translate', 'none');
  await page.keyboard.press('Escape');
  await page.mouse.up();

  await expect(group.locator('.layout-drop-target')).toHaveCount(0);
  await expect(group).toHaveCSS('background-image', 'none');
  await expect(first).toHaveCSS('translate', 'none');
  await expect(panel.locator('[data-layout-card]').first()).toHaveAttribute('data-layout-card', 'printer');
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
});
