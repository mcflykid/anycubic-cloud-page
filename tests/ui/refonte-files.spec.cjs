const {test,expect}=require('@playwright/test');
const {login,chooseFileAction}=require('./helpers.cjs');

test('les fichiers gardent les commandes et le tableau dans la largeur disponible',async({page})=>{
  await page.setViewportSize({width:1440,height:800});
  await login(page,'files');
  await page.locator('[data-source=cloud]').click();
  await expect(page.locator('#files-title')).toHaveText('Cloud Anycubic');
  await expect(page.locator('#file-rows tr').first()).toBeVisible();
  await expect(page.locator('#cloud-quota')).toHaveText('184 Mo sur 2 Go');
  const selectors=['#files-form .files-sources','#cloud-folder','#files-search','#files-sort'];
  const controls=await Promise.all(selectors.map(selector=>page.locator(selector).boundingBox()));
  expect(new Set(controls.map(control=>control.height))).toEqual(new Set([36]));
  expect(new Set(controls.map(control=>control.y))).toHaveProperty('size',1);
  await page.setViewportSize({width:390,height:844});
  const trigger = page.locator('#file-rows tr').first().getByRole('button',{name:/Actions du fichier/});
  await trigger.click();
  const menu = page.locator('.files-action-menu:popover-open');
  await expect(menu.getByRole('button',{name:'Télécharger'})).toBeVisible();
  await expect(menu.locator('button:focus')).toHaveCount(1);
  const bounds = await menu.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('le renommage sélectionne le nom seul et refuse un doublon', async ({page}) => {
 await login(page, 'files');
 await page.locator('[data-source=cloud]').click();
 const row = page.locator('#file-rows tr').filter({hasText: 'Cube de calibration.gcode'});
 await chooseFileAction(row, 'Renommer');
 const dialog = page.getByRole('dialog', {name: 'Renommer le fichier'});
 const name = dialog.getByLabel('Nouveau nom');
 const save = dialog.getByRole('button', {name: 'Enregistrer'});
 await expect(name).toHaveValue('Cube de calibration');
 await expect(dialog.locator('#cloud-rename-extension')).toHaveText('.gcode');
 await expect(save).toBeDisabled();
 await name.fill('autre/nom');
 await expect(save).toBeDisabled();
 await name.fill('Boîte de rangement');
 await expect(dialog.locator('#cloud-rename-state')).toHaveText('Ce nom existe déjà dans le dossier.');
 await expect(save).toBeDisabled();
 await name.fill('Cube revisité');
 await expect(save).toBeEnabled();
});

test('un lien de téléchargement expiré peut être renouvelé', async ({page}) => {
 await page.clock.install();
 let issued = 0;
 await page.route('**/imprimante-api/cloud/downloads', route => route.fulfill({json: {
  downloads: [{url: '/imprimante-api/download/fictif-' + (++issued), expires_in: 300}],
 }}));
 await login(page, 'files');
 await page.locator('[data-source=cloud]').click();
 await chooseFileAction(page.locator('#file-rows tr').first(), 'Télécharger');
 const dialog = page.getByRole('dialog', {name: 'Téléchargements'});
 await expect(dialog.getByRole('link', {name: 'Télécharger'})).toBeVisible();
 await page.clock.fastForward(301000);
 await expect(dialog.getByRole('link', {name: 'Télécharger'})).toBeHidden();
 await dialog.getByRole('button', {name: 'Obtenir le lien'}).click();
 await expect(dialog.getByRole('link', {name: 'Télécharger'})).toHaveAttribute('href', '/imprimante-api/download/fictif-2');
});
