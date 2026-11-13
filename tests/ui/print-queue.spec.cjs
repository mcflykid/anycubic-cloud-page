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

test('une impression terminée propose la suivante sans lancer de commande', async ({page}) => {
  let complete = false, orders = 0;
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch();
    const json = await response.json();
    Object.assign(json.printer, {
      command_project:'fixture', job_complete:complete, job_in_progress:!complete,
    });
    await route.fulfill({response, json});
  });
  await page.route('**/imprimante-api/print-queue', route => route.fulfill({json:{
    items:[{handle:'demo-file', name:'Boîte de rangement.gcode', available:true}],
  }}));
  await page.route('**/imprimante-api/command', route => { orders++; return route.abort(); });
  await login(page, 'overview');
  complete = true;
  await expect(page.locator('#message-text')).toContainText(
    'Vérifiez que le plateau est libre avant d’imprimer « Boîte de rangement.gcode ».'
  );
  expect(orders).toBe(0);
});

test('la confirmation mémorise les emplacements sans envoyer d’ordre', async ({page}) => {
  let added, orders = 0;
  await page.route('**/imprimante-api/print-queue', route => {
    added = route.request().postDataJSON();
    return route.fulfill({json:{items:[]}});
  });
  await page.route('**/imprimante-api/command', route => { orders++; return route.abort(); });
  await login(page, 'files');
  await page.locator('[data-source=cloud]').click();
  await page.locator('#file-rows tr').first().getByRole('button',{name:'Imprimer',exact:true}).click();
  await page.locator('#print-ace-rows select').first().selectOption('1');
  await page.locator('#print-add-slot').click();
  await page.locator('#print-ace-rows select').nth(1).selectOption('3');
  await page.locator('#print-queue-add').click();
  await expect(page.locator('#print-dialog')).toBeHidden();
  expect(added).toMatchObject({action:'add', slots:[1,3]});
  expect(orders).toBe(0);
});

test('une file vide explique comment la remplir et masque le plateau libéré', async ({page}) => {
  await page.route('**/imprimante-api/print-queue', route => route.fulfill({json:{items:[]}}));
  await login(page, 'overview');
  await page.locator('#queue-open').click();
  const dialog = page.getByRole('dialog', {name:'File d’attente'});
  await expect(dialog.getByText('La file d’attente est vide')).toBeVisible();
  await expect(dialog.locator('#queue-next')).toBeHidden();
  await dialog.getByRole('button', {name:'Ajouter un fichier'}).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#tab-files')).toBeVisible();
});
