const {test,expect}=require('@playwright/test');
const {login,openSection}=require('./helpers.cjs');

test('la chronologie compacte reste à côté des compteurs sur ordinateur', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:1440,height:900});
  const start = Date.parse('2026-11-14T13:42:00Z') / 1000;
  const events = ['leveling', 'printing', 'spool', 'paused', 'resumed', 'filament_low'].map((kind, i) => ({
    kind, time:start + [0, 7, 23, 33, 39, 46][i] * 60, slots:[[0, 4]], shortages:[4],
  }));
  let active = false;
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), json = await response.json();
    json.updated_at = json.mqtt_updated_at = '2026-11-14T14:42:00Z';
    Object.assign(json.printer, {
      job_name:active ? 'Boîte de rangement · PLA' : '',
      job_state:active ? 'printing' : 'idle', job_in_progress:active, is_busy:active,
      job_current_layer:active ? 112 : null, job_total_layers:active ? 176 : null,
      job_progress:active ? 64 : null, job_time_remaining:active ? 84 : null,
      job_time_elapsed:active ? 60 : null, print_timeline:active ? events : [],
      curr_nozzle_temp:active ? 219 : 28, target_nozzle_temp:active ? 220 : 0,
      curr_hotbed_temp:active ? 60 : 26, target_hotbed_temp:active ? 60 : 0,
      fan_speed_pct:active ? 100 : 0, aux_fan_speed_pct:active ? 25 : 0,
      command_project:active ? 'demo-current-print' : null,
    });
    await route.fulfill({response, json});
  });
  await login(page);
  await expect(page.locator('#job-name')).toHaveText('Prête pour la prochaine création.');
  const materials = page.locator('.printer-materials');
  const card = page.locator('.printer-chronology');
  const list = card.locator('ol');
  await expect(list).toBeHidden();
  const [left, right] = await Promise.all([materials.boundingBox(), card.boundingBox()]);
  expect(left.y).toBe(right.y);
  expect(left.height).toBeCloseTo(right.height);
  await expect(materials.locator('.printer-material-actions > .muted')).toHaveCSS('text-align', 'left');
  expect(left.x + left.width).toBeLessThan(right.x);
  active = true;
  await page.reload();
  await openSection(page, 'overview');
  await expect(list.locator('li')).toHaveCount(1);
  await expect(list.locator('li')).toContainText('Impression en cours');
  await expect(page.locator('#printer-finish')).toHaveText('Fin prévue 17:06');
  const measurements = page.locator('#temperatures');
  await expect(measurements.getByRole('columnheader')).toHaveText(['Mesure', 'Cible', 'Actuelle']);
  const rows = measurements.locator('tbody tr');
  await expect(rows.getByRole('rowheader')).toHaveText(['Buse', 'Plateau', 'Pièce', 'Auxiliaire', 'Circulation']);
  await expect(rows.nth(0).getByRole('cell')).toHaveText(['220 °C', '219 °C']);
  await expect(rows.nth(2).getByRole('cell')).toHaveText(['', '100 %']);
  await expect(rows.nth(3).getByRole('cell')).toHaveText(['', '25 %']);
  await expect(rows.nth(4).getByRole('cell')).toHaveText(['', '0 %']);
  await expect(card.getByRole('button', {name:'Tout afficher'})).toHaveCount(0);
  const play = card.getByRole('button', {name:'Reprendre le défilement'});
  await expect(play).toBeVisible();
  await card.getByRole('button', {name:'Événement suivant'}).click();
  await expect(list.locator('li').first()).toHaveText(/Mise à niveau du plateau/);
  await card.getByRole('button', {name:'Événement précédent'}).click();
  await expect(list.locator('li').first()).toHaveText(/Impression en cours/);
  const markers = page.locator('#printer-task-markers button');
  await expect(markers).toHaveCount(events.length);
  await markers.nth(2).focus();
  await page.keyboard.press('ArrowRight');
  await expect(markers.nth(3)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(list.locator('[data-kind="paused"]')).toBeFocused();
  await expect(list.locator('.timeline-when').first()).toHaveText('15:156 min');
  await expect(card.locator('.timeline-day')).toHaveText('samedi 14 novembre 2026');
  await expect(card.locator('footer')).toContainText('Europe/Paris');
  const band = page.locator('#printer-task-timeline');
  await expect(band.locator('.timeline-axis time')).toHaveCount(5);
  await expect(band.locator('.timeline-legend')).toHaveText('PréchauffageImpressionPause');
  const [activeLeft, activeRight] = await Promise.all([materials.boundingBox(), card.boundingBox()]);
  expect(activeLeft.height).toBeCloseTo(activeRight.height);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.clock.install();
  await play.click();
  await page.clock.fastForward(6500);
  await expect(list.locator('li').first()).toHaveText(/Impression reprise/);
  await card.getByRole('button', {name:'Suspendre le défilement'}).click();
  await page.clock.fastForward(6500);
  await expect(list.locator('li').first()).toHaveText(/Impression reprise/);
  await page.setViewportSize({width:390,height:844});
  const [top, bottom] = await Promise.all([materials.boundingBox(), card.boundingBox()]);
  expect(top.y + top.height).toBeLessThan(bottom.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
