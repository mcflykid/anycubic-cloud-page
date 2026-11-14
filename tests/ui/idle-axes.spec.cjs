const {test, expect} = require('@playwright/test');
const {login, openSection} = require('./helpers.cjs');

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
  await panel.getByLabel('Circulation', {exact:true}).fill('33');
  await panel.getByRole('button', {name:'Appliquer les réglages'}).click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  expect(sent).toHaveLength(0);
  await page.locator('#confirm-yes').click();
  await expect.poll(() => sent.length).toBe(4);
  expect(sent).toEqual([
    expect.objectContaining({action:'idle-settings', confirmed:true, target_hotbed_temp:'30'}),
    expect.objectContaining({action:'idle-settings', confirmed:true, fan_speed_pct:'25'}),
    expect.objectContaining({action:'idle-settings', confirmed:true, aux_fan_speed_pct:'35'}),
    expect.objectContaining({action:'idle-settings', confirmed:true, box_fan_level:'33'}),
  ]);
  expect(sent[1]).not.toHaveProperty('aux_fan_speed_pct');
  expect(sent[2]).not.toHaveProperty('fan_speed_pct');
  expect(sent[3]).not.toHaveProperty('target_hotbed_temp');
  expect(sent[3]).not.toHaveProperty('fan_speed_pct');
  expect(sent[3]).not.toHaveProperty('aux_fan_speed_pct');
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
  for (const style of ['standard', 'aurora', 'lab']) {
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((html, appearance) => Object.assign(html.dataset, appearance), {style, theme});
      await expect.poll(() => drawing.evaluate(svg => {
        const errors = Array.from(svg.querySelectorAll('polyline')).map(line => {
          const row = svg.parentElement.querySelector(`.current-control-row[data-organ="${line.dataset.organ}"] label`);
          const box = row.getBoundingClientRect();
          const tip = line.points.getItem(line.points.numberOfItems - 1);
          return Math.abs(box.y + box.height / 2 - (svg.getBoundingClientRect().y + tip.y));
        });
        return errors.length ? Math.max(...errors) : Infinity;
      })).toBeLessThanOrEqual(1);
      const overflow = await panel.evaluate(el => Math.max(el.scrollWidth-el.clientWidth,el.scrollHeight-el.clientHeight));
      expect(overflow).toBeLessThanOrEqual(1);
    }
  }
  await page.setViewportSize({width:390,height:760});
  await expect(drawing).toBeHidden();
  expect(await panel.evaluate(el => el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
});

test('la barre horizontale centre ses groupes sur ordinateur', async ({page}) => {
  await page.setViewportSize({width:1920,height:1080});
  await login(page);
  const bar = page.locator('#atelier-tabs');
  for (const style of ['standard', 'aurora']) {
    await page.locator('html').evaluate((html, value) => { html.dataset.style = value; }, style);
    const offset = await bar.evaluate(nav => {
      const bounds = nav.getBoundingClientRect();
      const groups = nav.querySelectorAll('.atelier-nav-group');
      const first = groups[0].getBoundingClientRect().left;
      const last = groups[groups.length - 1].getBoundingClientRect().right;
      return Math.abs((first + last) / 2 - (bounds.left + bounds.width / 2));
    });
    expect(offset).toBeLessThanOrEqual(1);
  }
});

test('la vue garde ses lignes et propose les deux actions si l’éclairage est inconnu', async ({page}) => {
  let active = false;
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), data = await response.json();
    Object.assign(data.printer, {job_in_progress:active, camera_light:null, box_fan_level:33});
    await route.fulfill({json:data});
  });
  await page.setViewportSize({width:1440,height:860});
  await page.emulateMedia({reducedMotion:'reduce'});
  await login(page);
  const panel = page.locator('#controls-dialog');
  const sizes = [];
  for (const expected of ['Au repos', 'Impression en cours']) {
    await page.locator('#controls-open').click();
    await expect(panel.locator('#controls-machine-state')).toHaveText(expected);
    await expect(panel.locator('#current-circulation-reading')).toContainText('33 %');
    await expect(panel.locator('#control-light-on')).toBeVisible();
    await expect(panel.locator('#control-light-off')).toBeVisible();
    sizes.push(await panel.locator('.current-control-row').evaluateAll(rows =>
      rows.map(row => ({top:row.offsetTop, height:row.offsetHeight}))));
    if (active) break;
    active = true;
    await page.reload();
    await openSection(page, 'overview');
  }
  expect(sizes[0]).toEqual(sizes[1]);
});

test('les commandes affichent l’état et la mesure dans les trois langues', async ({page}) => {
  await page.setViewportSize({width:1920,height:1080});
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), data = await response.json();
    data.printer.box_fan_level = 33;
    await route.fulfill({json:data});
  });
  await login(page);
  const panel = page.locator('#controls-dialog');
  for (const [language, idle, circulation, reading] of [
    ['fr', 'Au repos', 'Circulation', 'Actuelle'],
    ['en', 'Idle', 'Circulation', 'Current'],
    ['es', 'En reposo', 'Circulación', 'Actual'],
  ]) {
    await page.locator('#interface-language').selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await openSection(page, 'overview');
    await page.locator('#controls-open').click();
    await expect(panel.locator('#controls-machine-state')).toHaveText(idle);
    await expect(panel.getByLabel(circulation, {exact:true})).toBeVisible();
    await expect(panel.locator('#current-circulation-reading')).toHaveText(`${reading} 33 %`);
    await page.keyboard.press('Escape');
  }
});

test('les repères des commandes courantes se redessinent sans erreur après un redimensionnement', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await page.locator('#controls-open').click();
  const panel = page.locator('#controls-dialog');
  await expect(panel).toBeVisible();
  // Le second tracé lisait un repère déjà dessiné au lieu de la ligne du formulaire.
  for (const width of [1050, 1000]) {
    await page.setViewportSize({width, height:900});
    await page.waitForTimeout(150);
  }
  await expect(panel.locator('line[data-organ], path[data-organ], polyline[data-organ]').first()).toBeAttached();
  expect(errors).toEqual([]);
});
