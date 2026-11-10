const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('les divergences de bobines sont affichées avant le lancement, sans blocage après confirmation',async({page})=>{
  let uploads=0;
  await page.route('**/imprimante-api/upload',route=>{uploads++;return route.fulfill({json:{ok:true,message:'Envoi fictif accepté'}});});
  await login(page);
  await page.getByRole('button',{name:'Envoyer et imprimer',exact:true}).click();
  await page.locator('#upload-form input[type=file]').setInputFiles({name:'fixture.gcode',mimeType:'text/plain',buffer:Buffer.from('; filament_type = ABS\n; filament_colour = #000000\nG1 X1\n')});
  await page.locator('#upload-form [name=mode]').selectOption('save-print');
  await page.locator('#upload-form [name=slots]').fill('1');
  await page.locator('#upload-form button[type=submit]').click();
  await expect(page.locator('#confirm-text')).toContainText('Le matériau du fichier diffère');
  await expect(page.locator('#confirm-text')).toContainText('La couleur du fichier diffère');
  await expect(page.locator('#confirm-text')).toContainText('groupes de température différents');
  expect(uploads).toBe(0);
  await page.locator('#confirm-yes').click();
  await expect.poll(()=>uploads).toBe(1);
});

for(const [code,see,unload] of [['fr','Voir','Retirer'],['en','View','Unload'],['es','Ver','Retirar']]){
  test(`vocabulaire ACE et dialogue de retrait en ${code}`,async({page})=>{
    await login(page);
    await page.evaluate(code=>localStorage.setItem('cloud-page-language',code),code);
    await page.reload();
    await page.locator('[data-tab=ace]').click();
    await expect(page.locator('#spools button').first()).toHaveText(see);
    await page.locator('#spools button').first().click();
    await expect(page.locator('#retract')).toHaveText(unload);
    await expect(page.locator('#spool-form [name=material]')).toBeDisabled();
  });
}

test('une mise à jour en cours reste distincte d’une simple proposition',async({page})=>{
  await page.route('**/imprimante-api/status',async route=>{
    const response=await route.fetch(),data=await response.json();
    data.printer.firmware_updating=true;data.printer.firmware_update_available=true;
    await route.fulfill({json:data});
  });
  await login(page);
  await page.locator('[data-tab=settings]').click();
  await expect(page.locator('#firmware-printer-status')).toHaveText('Mise à jour en cours');
  await expect(page.locator('[data-command=firmware]')).toBeDisabled();
});

test('une erreur HTTP fournit une référence pour retrouver le journal du conteneur',async({page})=>{
  await login(page);
  await page.route('**/imprimante-api/preflight',route=>route.fulfill({status:400,headers:{'X-Request-ID':'abcdef0123456789abcdef0123456789'},json:{ok:false,message:'Métadonnées de filament invalides'}}));
  await page.locator('[data-tab=upload]').click();
  await page.locator('#upload-form input[type=file]').setInputFiles({name:'fixture.gcode',mimeType:'text/plain',buffer:Buffer.from('G1 X1\n')});
  await page.locator('#upload-form [name=mode]').selectOption('save-print');
  await page.locator('#upload-form button[type=submit]').click();
  await expect(page.locator('#message-text')).toContainText('Référence de diagnostic : abcdef0123456789abcdef0123456789');
});
