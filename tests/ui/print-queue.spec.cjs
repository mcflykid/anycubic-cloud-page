const {test, expect} = require('@playwright/test');
const {login, openSection} = require('./helpers.cjs');

test('la file prépare la confirmation sans émettre d’ordre', async ({page}) => {
  let items = [], orders = 0;
  await page.route('**/imprimante-api/print-queue', route => {
    if (route.request().method() === 'POST') {
      const {handle} = route.request().postDataJSON();
      items = [
        {handle:'missing', name:'Fichier indisponible.gcode', available:false},
        {handle, name:'Cube de calibration.gcode', available:true},
      ];
    }
    return route.fulfill({json:{items}});
  });
  await page.route('**/imprimante-api/command', route => { orders++; return route.abort(); });
  await login(page, 'files');
  await page.locator('[data-source=cloud]').click();
  await page.locator('#file-rows tr').first().getByRole('button',{name:'Ajouter à la file'}).click();
  await expect(page.locator('#message-text')).toContainText('Fichier ajouté à la file d’attente.');
  await openSection(page, 'overview');
  await page.locator('#queue-open').click();
  await expect(page.locator('#queue-list')).toContainText('Fichier indisponible.gcode');
  await page.locator('#queue-next').click();
  const dialog = page.getByRole('dialog',{name:'Lancer l’impression'});
  await expect(dialog).toContainText('Cube de calibration.gcode');
  await page.keyboard.press('Escape');
  expect(orders).toBe(0);
  expect(items).toHaveLength(2);
});
