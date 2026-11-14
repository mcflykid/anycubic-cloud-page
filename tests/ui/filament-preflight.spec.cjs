const {test,expect}=require('@playwright/test');
const {login, openSection,chooseFileAction}=require('./helpers.cjs');

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

test('les affectations Cloud suivent les couleurs et les changements de l’ACE', async ({page}) => {
  let slotAvailable = true, order;
  await page.route('**/imprimante-api/files/cloud?*', async route => {
    const response = await route.fetch(), json = await response.json();
    json.files[0].details = {filaments:[
      {material:'PLA', color:[235,235,235], grams:10},
      {material:'PLA', color:[38,91,145], grams:8},
    ]};
    await route.fulfill({response,json});
  });
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), json = await response.json();
    json.printer.boxes[0].spools[1].spool_loaded = slotAvailable;
    await route.fulfill({response,json});
  });
  await page.route('**/imprimante-api/command', route => {
    order = route.request().postDataJSON();
    return route.fulfill({json:{ok:true,message:'Ordre fictif accepté'}});
  });
  await login(page, 'files');
  await page.locator('[data-source=cloud]').click();
  await chooseFileAction(page.locator('#file-rows tr').first(), 'Imprimer');
  const dialog = page.getByRole('dialog',{name:'Lancer l’impression'});
  const first = dialog.getByRole('combobox',{name:'Filament 1 · PLA'});
  const second = dialog.getByRole('combobox',{name:'Filament 2 · PLA'});
  const submit = dialog.getByRole('button',{name:'Lancer l’impression'});
  await first.selectOption('1');
  await expect(submit).toBeDisabled();
  await second.selectOption('2');
  await expect(submit).toBeEnabled();
  slotAvailable = false;
  await expect(second).toHaveValue('', {timeout:8000});
  await expect(second.getByRole('option',{name:/Emplacement 2 · Emplacement vide/})).toHaveAttribute('disabled', '');
  await expect(submit).toBeDisabled();
  await second.selectOption('3');
  await submit.click();
  await expect(dialog).toContainText('Ordre fictif accepté');
  expect(order.slots).toEqual([1,3]);
  expect(order).not.toHaveProperty('drying');
  expect(order).not.toHaveProperty('task_settings');
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
  await chooseFileAction(page.locator('#file-rows tr').first(), 'Imprimer');
  const dialog = page.getByRole('dialog',{name:'Lancer l’impression'});
  await dialog.getByRole('button',{name:'Lancer l’impression'}).click();
  await expect(dialog).toContainText('En attente du démarrage');
  state = {...state, command_project:'autre', job_file_references:['autre'], job_state:'printing', job_in_progress:true};
  await page.waitForResponse(r => r.url().includes('/status?print_tracking=ordre'));
  await expect(dialog).not.toContainText('Démarrage confirmé par l’imprimante');
  state = {...state, command_project:'nouveau', job_file_references:['fichier'],
    job_state:'downloading', job_download_progress:13};
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('value', '13');
  state = {...state, job_state:'preheating'};
  await expect(dialog).toContainText('Préparation en cours sur l’imprimante');
  await expect(dialog.getByRole('progressbar')).not.toHaveAttribute('value');
  state = {...state, job_state:'printing'};
  started = true;
  await expect(dialog).toContainText('Démarrage confirmé par l’imprimante');
});

test('le transfert peut annuler le lancement avant l’envoi de l’ordre', async ({page}) => {
  let finish, reference, cancelled = false;
  const transfer = new Promise(resolve => { finish = resolve; });
  await page.route('**/imprimante-api/status*', async route => {
    const response = await route.fetch(), json = await response.json();
    json.print_cancellable = !!reference && !cancelled &&
      new URL(route.request().url()).searchParams.get('print_tracking') === reference;
    await route.fulfill({response,json});
  });
  await page.route('**/imprimante-api/upload', async route => {
    reference = route.request().postData().match(/name="request_id"\r\n\r\n([^\r]+)/)?.[1];
    await transfer;
    await route.fulfill({json:{ok:true,cancelled,message:'Lancement annulé avant l’envoi de l’ordre.'}});
  });
  await page.route('**/imprimante-api/print/cancel-transfer', route => {
    cancelled = route.request().postDataJSON().reference === reference;
    return route.fulfill({json:{cancelled}});
  });
  await login(page, 'upload');
  const form = page.locator('#upload-form');
  await form.locator('input[type=file]').setInputFiles({name:'fixture.gcode',mimeType:'text/plain',buffer:Buffer.from('G1 X1\n')});
  await form.locator('[name=mode]').selectOption('temp-print');
  await form.locator('button[type=submit]').click();
  const dialog = page.getByRole('dialog',{name:'Lancer l’impression'});
  await dialog.getByRole('button',{name:'Lancer l’impression'}).click();
  try {
    await dialog.getByRole('button',{name:'Annuler le lancement'}).click();
    await expect(dialog).toContainText('Lancement annulé. Le transfert se termine.');
  } finally {
    finish();
  }
  await expect(dialog).toContainText('Lancement annulé avant l’envoi de l’ordre.');
  expect(cancelled).toBe(true);
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

test('le Résumé et l’ACE signalent la même bobine pendant l’impression', async ({page}) => {
  let shortfall = true;
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), json = await response.json();
    json.printer.filament_shortfalls = shortfall ? [{slot:3, grams:120, needed:193, relay:[]}] : [];
    await route.fulfill({response,json});
  });
  const warning = 'Emplacement 3 : environ 120 g restants pour 193 g estimés.';
  await login(page, 'summary');
  await expect(page.locator('#summary-ace-boxes .filament-shortfall')).toHaveText(warning);
  await openSection(page, 'ace');
  await expect(page.locator('#spools .filament-shortfall')).toHaveText(warning);
  shortfall = false;
  await expect(page.locator('#spools .filament-shortfall')).toHaveCount(0, {timeout:8000});
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
    await chooseFileAction(page.locator('#file-rows tr').first(), 'Imprimer');
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
    const preparation = dialog.locator('#print-options input[type=checkbox]:enabled');
    await expect(preparation).toHaveCount(5);
    await expect(dialog.locator('#print-auto-leveling')).toBeChecked();
    await expect(dialog.locator('#print-drying-mode option:disabled')).toHaveCount(2);
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

test('consulter les nouveautés du firmware ne déclenche aucune mise à jour', async ({page}) => {
  let commands = 0;
  await page.route('**/imprimante-api/command', route => { commands++; return route.abort(); });
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), data = await response.json();
    Object.assign(data.printer, {firmware_update_available:true, firmware_available:'2.8.0',
      firmware_notes:{text:'Correctifs fictifs',published:1794000000,required:true}});
    await route.fulfill({response,json:data});
  });
  await login(page,'settings');
  await page.getByRole('button',{name:'Voir les nouveautés'}).first().click();
  const dialog = page.getByRole('dialog',{name:'Nouveautés · Anycubic Kobra S1'});
  await expect(dialog).toContainText('Correctifs fictifs');
  await expect(dialog.locator('#firmware-notes-required')).toHaveText('Obligatoire');
  // Fermer par « Plus tard » ne doit envoyer aucun ordre.
  await dialog.getByRole('button',{name:'Plus tard'}).click();
  await expect(dialog).toBeHidden();
  expect(commands).toBe(0);
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
