const {test, expect}=require('@playwright/test');
const {login,openSection}=require('./helpers.cjs');

test('le second ACE garde ses bobines et sa cible, puis se replie s’il disparaît', async({page})=>{
  let second=true;
  const orders=[];
  await page.route('**/imprimante-api/status', async route=>{
    const response=await route.fetch(), data=await response.json();
    const first=data.printer.boxes[0];
    data.printer.boxes=second?[first,{...first,box_id:1,index:1,model:'ACE Pro',spools:first.spools.map(s=>({...s,material_type:'PETG',color:[12,34,56,78,90,12]}))}]:[first];
    await route.fulfill({json:data});
  });
  await page.route('**/imprimante-api/command',async route=>{orders.push(route.request().postDataJSON());await route.fulfill({json:{ok:true,message:'Commande fictive acceptée'}});});
  await login(page);
  await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
  await expect(page.locator('#ace-selector')).toBeVisible();
  await page.locator('#go-spool').click();
  await expect(page.locator('#spool-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#ace-selector').selectOption('1');
  await expect(page.locator('#spools .ace-spool-copy .ace-profile-open').first()).toContainText('PETG');
  await expect(page.locator('#spools .ace-spool-row')).toHaveCount(4);

  await page.locator('#go-drying').click();
  await page.locator('#dry-stop').click();
  await page.locator('#confirm-yes').click();
  await expect.poll(()=>orders.length).toBe(1);
  expect(orders[0].box).toBe(1);
  second=false;
  await page.reload();
  await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
  await expect(page.locator('#ace-selector')).toBeHidden();
  await expect(page.locator('#spools .ace-spool-copy .ace-profile-open').first()).toContainText('PLA');
});

test('les bobines et les commandes ACE restent alignées en mode sombre', async ({page}) => {
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), data = await response.json();
    data.printer.boxes[0].spools[3].spool_loaded = false;
    await route.fulfill({json: data});
  });
  await page.emulateMedia({reducedMotion: 'reduce'});
  await login(page, 'ace');
  await page.locator('html').evaluate(el => el.dataset.theme = 'dark');
  const spools = page.locator('#spools .spool-illustration');
  await expect(spools).toHaveCount(3);
  await expect(spools.first()).toHaveAttribute('aria-hidden', 'true');
  expect((await spools.first().boundingBox()).width).toBeLessThanOrEqual(32);
  await expect(page.locator('#spools .ace-spool-empty')).toHaveCount(1);
  const drying = page.locator('#go-drying'), spool = page.locator('#go-spool');
  const relay = page.locator('.ace-relay-row > div'), relayButton = page.locator('#ace-relay-open');
  for (const width of [1920, 390]) {
    await page.setViewportSize({width, height: 900});
    expect((await drying.boundingBox()).y).toBeCloseTo((await spool.boundingBox()).y, 0);
    const relayBox = await relay.boundingBox(), relayAction = await relayButton.boundingBox();
    expect(relayAction.x).toBeGreaterThanOrEqual(relayBox.x + relayBox.width);
    expect(Math.abs(relayBox.y + relayBox.height / 2 - (relayAction.y + relayAction.height / 2))).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await drying.click();
  await expect(page.locator('#drying-state')).toHaveText('Séchage en cours');
  await expect(page.locator('#dry-progress')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drying).toBeFocused();
  await expect(relayButton).toHaveText(/Activer|Désactiver/);
  await openSection(page, 'camera');
  const help = page.locator('[data-context-help="camera"]');
  const header = await help.locator('..').boundingBox();
  const button = await help.boundingBox();
  expect(Math.abs(button.x + button.width / 2 - (header.x + header.width / 2))).toBeLessThanOrEqual(1);
});

test('un emplacement ACE ouvre une fiche de filament sans commande', async ({page}) => {
 const commands = [];
 page.on('request', request => {
  if (request.url().endsWith('/imprimante-api/command')) commands.push(request);
 });
 await login(page, 'ace');
 const row = page.locator('#spools .ace-spool-row').first();
 const trigger = row.getByRole('button', {name: /Emplacement 1/});
 await trigger.click();
 const dialog = page.getByRole('dialog', {name: 'Fiche filament'});
 await expect(dialog).toBeVisible();
 await expect(dialog.locator('#filament-slot-title')).toContainText('Emplacement 1');
 await expect(dialog.getByRole('link', {name: 'Catalogue Anycubic'})).toHaveAttribute('href', 'https://3dfilamentprofiles.com/filaments/anycubic');
 await page.keyboard.press('Escape');
 await expect(trigger).toBeFocused();
 expect(commands).toHaveLength(0);
});

test('une fiche personnelle est importée puis retrouvée après rechargement', async ({page}) => {
 await login(page, 'ace');
 const trigger = page.locator('#spools .ace-profile-open').first();
 await trigger.click();
 const dialog = page.getByRole('dialog', {name: 'Fiche filament'});
 await dialog.getByText('Créer sa fiche filament', {exact: true}).click();
 const input = dialog.getByLabel('Importer une fiche JSON');
 const fixture = {name: 'Mon PLA fictif', url: 'https://example.com/pla', density: 1.24, drying: [45, 50]};
 await input.setInputFiles({name: 'pla.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture))});
 await expect(dialog.locator('#filament-profile-import-state')).toHaveText('Fiche personnelle enregistrée dans ce navigateur.');
 await expect(dialog.locator('#filament-profile-facts')).toContainText('1,24 g/cm³');
 await expect(dialog.locator('#filament-profile-facts')).not.toContainText('Température du plateau');
 await input.setInputFiles({name: 'invalid.json', mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({...fixture, url: 'javascript:alert(1)'}))});
 await expect(dialog.locator('#filament-profile-import-state')).toContainText('Import impossible');
 await page.reload();
 await openSection(page, 'ace');
 await trigger.click();
 await dialog.locator('#filament-profile-reference').selectOption({label: 'Mon PLA fictif · Fiche personnelle'});
 await expect(dialog.getByRole('link', {name: 'Source de la fiche'})).toHaveAttribute('href', fixture.url);
 await expect(dialog.locator('#filament-profile-facts')).toContainText('45–50 °C');
});
