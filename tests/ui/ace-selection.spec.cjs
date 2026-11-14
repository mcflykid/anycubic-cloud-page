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
 await page.route('**/imprimante-api/status', async route => {
  const response = await route.fetch(), json = await response.json();
  Object.assign(json.printer.boxes[0].spools[0], {material_type: 'PLA Glow', rfid: true, filament_profile: 'PLA Glow'});
  await route.fulfill({response, json});
 });
 const commands = [];
 page.on('request', request => {
  if (request.url().endsWith('/imprimante-api/command')) commands.push(request);
 });
 await login(page, 'ace');
 const row = page.locator('#spools .ace-spool-row').first();
 const trigger = row.getByRole('button', {name: /Emplacement 1/});
 await trigger.click();
 const dialog = page.getByRole('dialog', {name: 'Fiche filament', exact: true});
 await expect(dialog).toBeVisible();
 await expect(dialog.locator('#filament-slot-title')).toContainText('Emplacement 1');
 await expect(dialog.locator('#filament-profile-reference')).toHaveText('Valeurs du fabricant pour PLA Glow');
 await expect(dialog.getByRole('link', {name: 'Fiche technique du fabricant (PDF)'}))
  .toHaveAttribute('href', 'https://cdn.shopify.com/s/files/1/0245/5519/2380/files/ANYCUBIC_TDS_PLA_Glow_V3.0.pdf?v=1758527363');
 await page.keyboard.press('Escape');
 await expect(trigger).toBeFocused();
 expect(commands).toHaveLength(0);
});

test('les trois premières fiches ACE ouvrent leurs variantes communautaires', async ({page}) => {
 await page.route('**/imprimante-api/status', async route => {
  const response = await route.fetch(), json = await response.json();
  const profiles = ['PLA Basic', 'PLA Basic', 'PLA Marble'];
  const colors = [[33, 39, 33], [146, 121, 104], [239, 240, 241]];
  profiles.forEach((profile, index) => Object.assign(json.printer.boxes[0].spools[index], {
   material_type: profile, rfid: true, filament_profile: profile, color: colors[index],
  }));
  await route.fulfill({response, json});
 });
 await login(page, 'ace');
 const dialog = page.getByRole('dialog', {name: 'Fiche filament', exact: true});
 for (let slot = 1; slot <= 3; slot++) {
  await page.locator('#spools').getByRole('button', {name: new RegExp('Emplacement ' + slot)}).click();
  await expect(dialog.getByRole('link', {name: '3D Filament Profiles', exact: true}))
   .toHaveAttribute('href', 'https://3dfilamentprofiles.com/filament/details/' + [560, 2830, 15191][slot - 1]);
  await expect(dialog.locator('#filament-profile-facts')).toContainText(slot === 3 ? 'Marble' : 'Basic');
  await page.keyboard.press('Escape');
 }
});

test('le catalogue retrouve une fiche par SKU sans sélectionner de bobine', async ({page}) => {
 await login(page, 'ace');
 await page.getByRole('button', {name:'Catalogue Anycubic'}).click();
 const catalogue = page.getByRole('dialog', {name:'Catalogue Anycubic'});
 await catalogue.getByLabel('Rechercher un filament').fill('HASBK-103');
 await expect(catalogue.locator('#filament-catalogue-list button')).toHaveCount(0);
 await catalogue.getByLabel('Rechercher un filament').fill('AHLSMW-101');
 await catalogue.getByRole('button', {name:/PLA Marble · Marble White · AHLSMW-101/}).click();
 const profile = page.getByRole('dialog', {name:'Fiche filament', exact:true});
 await expect(profile.locator('#filament-profile-facts')).toContainText('AHLSMW-101');
 await expect(profile.getByRole('link', {name:'3D Filament Profiles', exact:true}))
   .toHaveAttribute('href', 'https://3dfilamentprofiles.com/filament/details/15191');
 await expect(profile.locator('#filament-profile-reading')).toBeHidden();
 await page.keyboard.press('Escape');
 await catalogue.getByLabel('Rechercher un filament').fill('AHPLBW-107');
 await catalogue.getByRole('button', {name:/PLA Basic · White · AHPLBW-107/}).click();
 await expect(profile.locator('#filament-profile-facts')).toContainText('#EFF0F1');
 await expect(profile.locator('#filament-profile-properties')).toContainText('48 ± 5 MPa');
 await expect(profile.getByRole('link', {name:'Fiche fabricant'}))
  .toHaveAttribute('href', 'https://store.anycubic.com/products/pla-filament?variant=43845685149858');
});

test('un emplacement inconnu propose uniquement la création et retrouve sa fiche après rechargement', async ({page}) => {
 let color;
 await page.route('**/imprimante-api/status', async route => {
  const response = await route.fetch(), json = await response.json();
  Object.assign(json.printer.boxes[0].spools[0], {material_type: 'PLA Marble', rfid: true});
  if (color) json.printer.boxes[0].spools[0].color = color;
  await route.fulfill({response, json});
 });
 await login(page, 'ace');
 const trigger = page.locator('#spools .ace-profile-open').first();
 const create = page.getByRole('dialog', {name: 'Créer sa fiche filament'});
 const profile = page.getByRole('dialog', {name: 'Fiche filament', exact: true});
 await trigger.click();
 await expect(create).toBeVisible();
 await expect(profile).toBeHidden();
 await page.keyboard.press('Escape');
 await page.locator('#spools .ace-spool-row').first().getByRole('button', {name:'Voir', exact:true}).click();
 await page.locator('#spool-dialog').getByRole('button', {name:'Créer sa fiche filament'}).click();
 await expect(create).toBeVisible();
 await expect(create.getByRole('link', {name: 'Tutoriel : rédiger une fiche filament'})).toBeVisible();
 const input = create.getByLabel('Importer une fiche JSON');
 const fixture = {name: 'Mon PLA fictif', url: 'https://example.com/pla', density: 1.24, drying: [45, 50]};
 const importFile = data => input.setInputFiles({name: 'pla.json', mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(data))});
 await importFile({...fixture, url: 'http://example.com/pla'});
 await expect(create.getByRole('status')).toContainText('Import impossible');
 await importFile(fixture);
 await expect(profile).toBeVisible();
 await expect(profile.locator('#filament-profile-facts')).toContainText('1,24 g/cm³');
 await expect(profile.getByRole('link', {name: 'Fiche technique du fabricant (PDF)'})).toBeHidden();
 await expect(profile.locator('#filament-profile-facts')).not.toContainText('Plateau');
 // La température de séchage rejoint sa durée dans la bande Séchage.
 await expect(profile.locator('#filament-profile-drying')).toContainText('45–50 °C');
 await page.reload();
 await openSection(page, 'ace');
 await trigger.click();
 await expect(profile.getByRole('link', {name: 'Source de la fiche'})).toHaveAttribute('href', fixture.url);
 await expect(profile.locator('#filament-profile-drying')).toContainText('45–50 °C');
 color = [1, 2, 3];
 await page.reload();
 await openSection(page, 'ace');
 await trigger.click();
 await expect(create).toBeVisible();
 await expect(profile).toBeHidden();
});

test('le conseil de séchage préremplit le formulaire sans démarrer le module', async ({page}) => {
  const orders = [];
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), data = await response.json();
    const box = data.printer.boxes[0];
    data.drying_advice = {[box.box_id]: {humidity:48, material:'PETG', temperature:55, hours:6}};
    await route.fulfill({response, json:data});
  });
  await page.route('**/imprimante-api/command', route => {
    orders.push(route.request().postDataJSON());
    return route.abort();
  });
  await login(page, 'ace');
  const advice = page.locator('#ace-drying-advice');
  await expect(advice).toContainText(/48.*PETG/);
  await expect(advice.getByRole('button', {name:'Préparer PETG · 55 °C · 6 h'})).toBeVisible();
  await advice.getByRole('button', {name:/^Préparer PETG/}).click();
  await expect(page.locator('#dry-form [name=temperature]')).toHaveValue('55');
  await expect(page.locator('#dry-form [name=hours]')).toHaveValue('6');
  expect(orders).toHaveLength(0);
  await page.keyboard.press('Escape');
  await advice.getByRole('button', {name:'Masquer 24 h'}).click();
  await page.reload();
  await openSection(page, 'ace');
  await expect(advice).toBeHidden();
});

test('les mesures ACE distinguent un zéro périmé et l’absence de relevé', async ({page}) => {
  await page.route(/\/imprimante-api\/status(?:\?|$)/, async route => {
    const response = await route.fetch();
    const json = await response.json();
    if (json.printer?.boxes?.length) {
      Object.assign(json.printer.boxes[0], {
        humidity: 0, temperature: null,
        measurement_freshness: {
          humidity: {state: 'stale', age_s: 125, source: 'mqtt'},
          temperature: {state: 'missing'},
        },
      });
    }
    await route.fulfill({response, json});
  });
  await login(page, 'ace');
  await expect(page.locator('#ace-stats')).toContainText('0 % · MQTT · 125 s · Périmé');
  await expect(page.locator('#ace-stats')).toContainText('Non relevé');
});

test('le catalogue restaure un export de fiches et conserve son contenu au téléchargement', async ({page}) => {
  await login(page, 'ace');
  await page.getByRole('button', {name:'Catalogue Anycubic'}).click();
  const fixture = {profiles:[{name:'PLA de démonstration',url:'https://example.com/pla'}],assignments:[]};
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#filament-profile-restore').setInputFiles({
    name:'fiches.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator('#filament-profile-transfer-state')).toHaveText('Fiches personnelles restaurées');
  const pending = page.waitForEvent('download');
  await page.locator('#filament-profile-export').click();
  const file = await pending;
  const bytes = require('node:fs').readFileSync(await file.path());
  expect(JSON.parse(bytes)).toEqual(fixture);
});
