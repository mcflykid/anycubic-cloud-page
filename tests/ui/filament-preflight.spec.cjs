const {test,expect}=require('@playwright/test');
const {login, openSection}=require('./helpers.cjs');

test('les divergences de bobines sont affichées avant le lancement, sans blocage après confirmation',async({page})=>{
  let uploads=0, payload;
  await page.route('**/imprimante-api/upload',route=>{uploads++;payload=route.request().postData();return route.fulfill({json:{ok:true,message:'Envoi fictif accepté'}});});
  await login(page);
  await page.getByRole('button',{name:'Envoyer et imprimer',exact:true}).click();
  await page.locator('#upload-form input[type=file]').setInputFiles({name:'fixture.gcode',mimeType:'text/plain',buffer:Buffer.from('; filament_type = ABS\n; filament_colour = #000000\n; estimated printing time (normal mode) = 14h 15m\n; total filament used [g] = 193.4\n; filament used [mm] = 64850\nG1 X1\n')});
  await page.locator('#upload-form [name=mode]').selectOption('save-print');
  await page.locator('#upload-form [name=slots]').fill('1');
  await page.locator('#upload-form button[type=submit]').click();
  const dialog = page.getByRole('dialog', {name:'Lancer l’impression'});
  await expect(dialog).toContainText('Le matériau du fichier diffère');
  await expect(dialog).toContainText('La couleur du fichier diffère');
  await expect(dialog).toContainText('groupes de température différents');
  await expect(dialog).toContainText('14 h 15 min');
  await expect(dialog).toContainText('193,4 g / 64,85 m');
  const mapping = dialog.getByRole('combobox', {name:'Filament 1 · ABS'});
  await expect(mapping).toHaveValue('1');
  await mapping.selectOption('3');
  expect(uploads).toBe(0);
  await dialog.getByRole('button', {name:'Lancer l’impression',exact:true}).click();
  await expect.poll(()=>uploads).toBe(1);
  expect(payload).toMatch(/name="slots"\r\n\r\n\[3\]/);
});

test('le transfert garde la fenêtre ouverte jusqu’à la réponse Anycubic', async ({page}) => {
  let uploads = 0, release, sending = false;
  const response = new Promise(resolve => { release = resolve; });
  await page.route('**/imprimante-api/status*', async route => {
    const response = await route.fetch(), json = await response.json();
    json.print_sending = sending && new URL(route.request().url()).searchParams.has('print_tracking');
    await route.fulfill({response,json});
  });
  await page.route('**/imprimante-api/upload', async route => {
    uploads++;
    await response;
    await route.fulfill({json:{ok:true,message:'Envoi accepté par Anycubic'}});
  });
  await login(page, 'upload');
  const form = page.locator('#upload-form');
  await form.locator('input[type=file]').setInputFiles({name:'fixture.gcode',mimeType:'text/plain',buffer:Buffer.from('G1 X1\n')});
  await form.locator('[name=mode]').selectOption('temp-print');
  await form.locator('button[type=submit]').click();
  const dialog = page.getByRole('dialog', {name:'Lancer l’impression'});
  try {
    await dialog.getByRole('button',{name:'Lancer l’impression'}).dblclick();
    await expect(dialog.getByRole('progressbar')).toBeVisible();
    await expect(dialog).toContainText('Transfert du fichier en cours');
    await expect(dialog.getByRole('progressbar')).not.toHaveAttribute('value');
    await expect(dialog.getByRole('button',{name:'Annuler'})).toBeHidden();
    await expect.poll(() => uploads).toBe(1);
    sending = true;
    await expect(dialog).toContainText('Envoi de l’ordre d’impression à Anycubic');
  } finally {
    release();
  }
  await expect(dialog).toContainText('Envoi accepté par Anycubic');
  await expect(dialog.getByRole('progressbar')).toBeHidden();
  await dialog.getByRole('button',{name:'Fermer'}).click();
  await expect(dialog).toBeHidden();
  expect(uploads).toBe(1);
});

test('le démarrage exige une nouvelle tâche avec le fichier attendu', async ({page}) => {
  let state = {command_project:'ancien', job_state:'finished', job_in_progress:false, job_file_references:['fichier']}, started = false;
  await page.route('**/imprimante-api/status*', async route => {
    const response = await route.fetch(), json = await response.json();
    Object.assign(json.printer, state);
    json.print_started = started && new URL(route.request().url()).searchParams.get('print_tracking') === 'ordre';
    await route.fulfill({response,json});
  });
  await page.route('**/imprimante-api/command', route => route.fulfill({json:{
    ok:true, message:'Commande acceptée', print_reference:'ordre',
    print_tracking:{previous_project:'ancien', files:['fichier']},
  }}));
  await login(page, 'files');
  await page.locator('[data-source=cloud]').click();
  await page.locator('#file-rows tr').first().getByRole('button',{name:'Imprimer',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Lancer l’impression'});
  await dialog.getByRole('button',{name:'Lancer l’impression'}).click();
  await expect(dialog).toContainText('En attente du démarrage');
  state = {...state, command_project:'autre', job_file_references:['autre'], job_state:'printing', job_in_progress:true};
  await page.waitForResponse(r => r.url().includes('/status?print_tracking=ordre'));
  await expect(dialog).not.toContainText('Démarrage confirmé par l’imprimante');
  state = {...state, command_project:'nouveau', job_file_references:['fichier'], job_state:'preheating'};
  await expect(dialog).toContainText('Préparation en cours sur l’imprimante');
  state = {...state, job_state:'printing'};
  started = true;
  await expect(dialog).toContainText('Démarrage confirmé par l’imprimante');
});

test('un manque estimé par le serveur reste un avertissement', async ({page}) => {
  await page.route('**/imprimante-api/preflight', route => route.fulfill({json:{
    warnings:[], shortfalls:[{slot:3, grams:120, needed:193, relay:[]}],
  }}));
  await login(page, 'upload');
  const form = page.locator('#upload-form');
  await form.locator('input[type=file]').setInputFiles({name:'fixture.gcode',mimeType:'text/plain',buffer:Buffer.from('; filament_type = PLA\n; filament used [g] = 193\nG1 X1\n')});
  await form.locator('[name=mode]').selectOption('temp-print');
  await form.locator('[name=slots]').fill('3');
  await form.locator('button[type=submit]').click();
  const dialog = page.getByRole('dialog',{name:'Lancer l’impression'});
  await expect(dialog).toContainText('Emplacement 3 : environ 120 g restants pour 193 g estimés.');
  await expect(dialog.getByRole('button',{name:'Lancer l’impression'})).toBeEnabled();
});

for (const scenario of ['refus avec code', 'réponse perdue']) {
  test(`la fenêtre conserve le résultat après ${scenario}`, async ({page}) => {
    let orders = 0;
    await page.route('**/imprimante-api/command', route => {
      orders++;
      return scenario === 'réponse perdue' ? route.abort('timedout') : route.fulfill({
        status:409, json:{ok:false,message:'Imprimante non disponible',reason_code:'10115'},
      });
    });
    await login(page, 'files');
    await page.locator('[data-source=cloud]').click();
    await page.locator('#file-rows tr').first().getByRole('button',{name:'Imprimer',exact:true}).click();
    const dialog = page.getByRole('dialog',{name:'Lancer l’impression'});
    await dialog.getByRole('button',{name:'Lancer l’impression'}).click();
    if (scenario === 'réponse perdue') {
      await expect(dialog.locator('#print-result')).toContainText('Vérifiez l’état de la machine');
      await expect(dialog.getByRole('button',{name:'Aide'})).toBeHidden();
    } else {
      await expect(dialog.locator('#print-result')).toContainText('10115');
      await expect(dialog.getByRole('button',{name:'Aide'})).toBeVisible();
    }
    await expect(dialog.getByRole('button',{name:'Lancer l’impression'})).toBeHidden();
    await dialog.getByRole('button',{name:'Fermer'}).click();
    expect(orders).toBe(1);
  });
}

for (const [language, title, theme] of [
  ['fr','Lancer l’impression','light'], ['en','Start print','dark'], ['es','Iniciar impresión','light'],
]) {
  test(`la confirmation mobile garde les actions accessibles en ${language}`, async ({page}) => {
    await page.setViewportSize({width:390,height:640});
    let available = true, uploads = 0;
    await page.route('**/imprimante-api/status', async route => {
      const response = await route.fetch(), json = await response.json();
      json.printer.is_available = available;
      await route.fulfill({response,json});
    });
    await page.route('**/imprimante-api/upload', route => {
      uploads++;
      return route.fulfill({json:{ok:true}});
    });
    await login(page);
    await page.evaluate(({language,theme}) => {
      localStorage.setItem('cloud-page-language',language);
      localStorage.setItem('cloud-page-theme',theme);
    }, {language,theme});
    await page.reload();
    await openSection(page, 'upload');
    const form = page.locator('#upload-form');
    const name = 'Fichier de démonstration avec un nom suffisamment long pour dépasser la largeur sur mobile.gcode';
    await form.locator('input[type=file]').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from('G1 X1\n')});
    await form.locator('[name=mode]').selectOption('temp-print');
    const submit = form.locator('button[type=submit]');
    await submit.click();
    const dialog = page.getByRole('dialog', {name:title});
    await expect(dialog.locator('#print-name')).toHaveAttribute('title',name);
    await expect(dialog.locator('#print-no')).toBeFocused();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(dialog.getByRole('button',{name:title})).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(submit).toBeFocused();
    await submit.click();
    await expect(dialog.getByRole('button',{name:title})).toBeEnabled();
    available = false;
    await expect(dialog.getByRole('button',{name:title})).toBeDisabled({timeout:8000});
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(uploads).toBe(0);
  });
}

for(const [code,see,unload] of [['fr','Voir','Retirer'],['en','View','Unload'],['es','Ver','Retirar']]){
  test(`vocabulaire ACE et dialogue de retrait en ${code}`,async({page})=>{
    await login(page);
    await page.evaluate(code=>localStorage.setItem('cloud-page-language',code),code);
    await page.reload();
    await page.locator('[data-tab=ace]').click();
    await expect(page.locator('#spools .ace-spool-row > button').first()).toHaveText(see);
    await page.locator('#spools .ace-spool-row > button').first().click();
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
