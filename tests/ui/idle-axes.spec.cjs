const {test, expect} = require('@playwright/test');
const {login} = require('./helpers.cjs');

test('les réglages au repos partagent une confirmation et conservent des ordres distincts', async ({page}) => {
  const sent = [];
  await page.route('**/imprimante-api/command', route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({json: {ok: true, message: 'Réglage fictif reçu'}});
  });
  await login(page);
  await page.locator('#controls-open').click();
  const panel = page.locator('#controls-dialog');
  await expect(panel).toContainText('Au repos');
  await expect(panel.getByLabel('Plateau', {exact:true})).toHaveAttribute('max','120');
  await panel.getByLabel('Plateau', {exact:true}).fill('30');
  await panel.getByLabel('Pièce', {exact:true}).fill('25');
  await panel.getByLabel('Auxiliaire', {exact:true}).fill('35');
  await panel.getByRole('button', {name:'Appliquer les réglages'}).click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  expect(sent).toHaveLength(0);
  await page.locator('#confirm-yes').click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent).toEqual([
    expect.objectContaining({action:'idle-settings', confirmed:true, target_hotbed_temp:'30'}),
    expect.objectContaining({action:'idle-settings', confirmed:true, fan_speed_pct:'25'}),
    expect.objectContaining({action:'idle-settings', confirmed:true, aux_fan_speed_pct:'35'}),
  ]);
  expect(sent[1]).not.toHaveProperty('aux_fan_speed_pct');
  expect(sent[2]).not.toHaveProperty('fan_speed_pct');
});

test('les limites absentes ne masquent pas le champ et empêchent la commande', async ({page}) => {
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), data = await response.json();
    data.printer.idle_limits = {};
    await route.fulfill({json:data});
  });
  await login(page);
  await page.locator('#controls-open').click();
  const bed = page.locator('#current-bed');
  await expect(bed).toBeVisible();
  await expect(bed).toBeEnabled();
  await bed.fill('30');
  await page.getByRole('button', {name:'Appliquer les réglages'}).click();
  await expect(page.locator('#control-feedback')).toContainText('Limites de température indisponibles');
  await expect(page.locator('#confirm-dialog')).toBeHidden();
});

test('les repères rejoignent les lignes sans défilement à 1 440 px', async ({page}) => {
  await page.setViewportSize({width:1440,height:860});
  await page.emulateMedia({reducedMotion:'reduce'});
  await login(page);
  await page.locator('#controls-open').click();
  const panel = page.locator('#controls-dialog');
  await expect(panel.locator('.current-control-row')).toHaveCount(7);
  const drawing = panel.locator('#controls-connectors');
  await expect(drawing.locator('polyline')).toHaveCount(5);
  const errors = await drawing.evaluate(svg => Array.from(svg.querySelectorAll('polyline')).map(line => {
    const row = svg.parentElement.querySelector(`.current-control-row[data-organ="${line.dataset.organ}"] label`);
    const box = row.getBoundingClientRect();
    const tip = line.points.getItem(line.points.numberOfItems - 1);
    return Math.abs(box.y + box.height / 2 - (svg.getBoundingClientRect().y + tip.y));
  }));
  expect(Math.max(...errors)).toBeLessThanOrEqual(1);
  const overflow = await panel.evaluate(el => Math.max(el.scrollWidth-el.clientWidth,el.scrollHeight-el.clientHeight));
  expect(overflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({width:390,height:760});
  await expect(drawing).toBeHidden();
  expect(await panel.evaluate(el => el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
});

test('la barre horizontale centre ses groupes sur ordinateur', async ({page}) => {
  await page.setViewportSize({width:1920,height:1080});
  await login(page);
  const bar = page.locator('#atelier-tabs');
  const offset = await bar.evaluate(nav => {
    const bounds = nav.getBoundingClientRect();
    const groups = nav.querySelectorAll('.atelier-nav-group');
    return Math.abs((groups[0].getBoundingClientRect().left + groups[groups.length - 1].getBoundingClientRect().right) / 2 - (bounds.left + bounds.width / 2));
  });
  expect(offset).toBeLessThanOrEqual(1);
});
