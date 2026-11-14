const {test,expect}=require('@playwright/test');
const {login,chooseFileAction}=require('./helpers.cjs');

test('la préparation en démo permet de décocher le nivellement sans envoyer de commande', async ({page}) => {
 const commands=[];
 await page.route('**/imprimante-api/command', route => {
  commands.push(route.request().method());
  return route.abort();
 });
 await page.route('**/imprimante-api/files/local?**', route => route.fulfill({json:{
  files:[{name:'fixture.gcode'}],path:'/'
 }}));
 await login(page,'files');
 const row=page.locator('#file-rows');
 const options=page.locator('#print-options');
 const leveling=options.getByRole('checkbox',{name:'Mise à niveau du plateau'});
 await chooseFileAction(row, 'Imprimer');
 await expect(leveling).toBeChecked();
 await leveling.uncheck();
 await expect(leveling).not.toBeChecked();
 for(const name of ['Compensation de résonance','Détection IA (BETA)','Timelapse','Calibration du débit']){
  const option=options.getByRole('checkbox',{name});
  await expect(option).not.toBeChecked();
  await option.check();
 }
 await page.locator('#print-no').click();
 await chooseFileAction(row, 'Imprimer');
 await expect(leveling).toBeChecked();
 await expect(options.getByRole('checkbox',{checked:true})).toHaveCount(1);
 expect(commands).toEqual([]);
});

test('la confirmation hors démo garde les options non qualifiées indisponibles', async ({page}) => {
 await page.route('**/imprimante-api/files/local?**', route => route.fulfill({json:{
  files:[{name:'fixture.gcode'}],path:'/'
 }}));
 await login(page,'files');
 await page.locator('.demo-banner').evaluate(banner=>banner.remove());
 await chooseFileAction(page.locator('#file-rows'), 'Imprimer');
 const options=page.locator('#print-options');
 await expect(options.locator('input[type=checkbox]:disabled')).toHaveCount(5);
 await expect(options.locator('.print-options-live-note')).toBeVisible();
 await page.locator('#print-no').click();
});

test('le lancement mémoire envoie le nivellement décoché et seulement les options annoncées', async ({page}) => {
 const commands=[];
 await page.route('**/imprimante-api/status**', async route => {
  const response=await route.fetch(), json=await response.json();
  json.printer.stored_print_options=['auto_leveling','camera_timelapse'];
  return route.fulfill({response,json});
 });
 await page.route('**/imprimante-api/files/local?**', route => route.fulfill({json:{
  files:[{name:'fixture.gcode'}],path:'/'
 }}));
 await page.route('**/imprimante-api/command', route => {
  commands.push(route.request().postDataJSON());
  return route.fulfill({json:{ok:true,message:'Ordre fictif'}});
 });
 await login(page,'files');
 await page.locator('.demo-banner').evaluate(banner=>banner.remove());
 await chooseFileAction(page.locator('#file-rows'), 'Imprimer');
 const dialog=page.locator('#print-dialog');
 await expect(dialog.locator('#print-destination-spools li')).toHaveCount(4);
 await expect(dialog.locator('#print-auto-leveling')).toBeChecked();
 await dialog.locator('#print-auto-leveling').uncheck();
 await dialog.getByRole('checkbox',{name:'Timelapse'}).check();
 await expect(dialog.getByRole('checkbox',{name:'Calibration du débit'})).toBeDisabled();
 await dialog.locator('#print-ace-rows select').selectOption('1');
 await dialog.locator('#print-yes').click();
 await expect.poll(()=>commands.map(order=>order.preparation)).toEqual([{auto_leveling:false,camera_timelapse:true}]);
});

test('la confirmation mémoire reçoit les capacités qui arrivent après son ouverture', async ({page}) => {
 let ready = false;
 await page.route('**/imprimante-api/status**', async route => {
  const response = await route.fetch(), json = await response.json();
  json.printer.stored_print_options = ready ? ['auto_leveling','ai_detect','camera_timelapse'] : ['auto_leveling'];
  return route.fulfill({response,json});
 });
 await page.route('**/imprimante-api/files/local?**', route =>
  route.fulfill({json:{files:[{name:'fixture.gcode'}],path:'/'}}));
 await login(page,'files');
 await page.locator('.demo-banner').evaluate(banner=>banner.remove());
 await chooseFileAction(page.locator('#file-rows'), 'Imprimer');
 const dialog = page.locator('#print-dialog');
 const leveling = dialog.locator('#print-auto-leveling');
 const ai = dialog.getByRole('checkbox',{name:'Détection IA (BETA)',exact:true});
 await expect(ai).toBeDisabled();
 await leveling.uncheck();
 ready = true;
 await expect(ai).toBeEnabled();
 await expect(dialog.getByRole('checkbox',{name:'Timelapse'})).toBeEnabled();
 await expect(leveling).not.toBeChecked();
});

test('la recherche filtre les fichiers sans filtres avancés', async ({page}) => {
 await page.route('**/imprimante-api/files/cloud?**', route => route.fulfill({json:{files:[
  {handle:'a',name:'PLA court.gcode',details:{material:'PLA',seconds:1800}},
  {handle:'b',name:'PETG long.gcode',details:{material:'PETG',seconds:18000}},
 ],has_more:false}}));
 await login(page,'files');
 await page.locator('[data-source=cloud]').click();
 await expect(page.locator('#file-rows tr')).toHaveCount(2);
 // Les filtres avancés ont été retirés : la recherche par nom reste le seul filtre.
 await expect(page.locator('#file-advanced')).toHaveCount(0);
 await page.locator('#files-search').fill('petg');
 await expect(page.locator('#file-rows tr')).toHaveCount(1);
 await expect(page.locator('#file-rows')).toContainText('PETG long.gcode');
});
/** Une liste lente ne doit jamais être appliquée à la source choisie entre-temps. */
test('les fichiers tardifs ne changent pas de source et la dernière lecture repart',async({page})=>{
 let release,entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const commands=[];
 await page.route('**/imprimante-api/files/local?**',async route=>{entered();await gate;await route.fulfill({json:{files:[{name:'ancien-local.gcode',size_mb:1}],path:'/test_model'}});});
 await page.route('**/imprimante-api/files/usb?**',route=>route.fulfill({json:{files:[{name:'courant-usb.gcode',size_mb:1}],path:'/test_model'}}));
 await page.route('**/imprimante-api/command',async route=>{commands.push(route.request().postDataJSON());await route.fulfill({json:{ok:true,message:'Simulation uniquement'}});});
 await login(page);await page.getByRole('button',{name:'Fichiers',exact:true}).click();await waiting;
 await expect(page.locator('#file-rows')).toHaveAttribute('aria-busy','true');
 await expect(page.locator('#files-loading')).toBeVisible();
 await page.getByRole('button',{name:'Clé USB',exact:true}).click();await expect(page.getByText('ancien-local.gcode',{exact:true})).toHaveCount(0);release();
 await expect(page.getByText('courant-usb.gcode',{exact:true})).toBeVisible();
 await expect(page.locator('#files-loading')).toBeHidden();await expect(page.getByText('ancien-local.gcode',{exact:true})).toHaveCount(0);
 await chooseFileAction(page.locator('#file-rows'), 'Supprimer');await page.locator('#confirm-yes').click();await expect.poll(()=>commands.length).toBe(1);
 expect(commands[0].action).toBe('delete-usb');expect(commands[0].name).toBe('courant-usb.gcode');
});
/** Le chemin et le cloud courants sont relus après une consultation en attente. */
test('un changement de dossier puis de cloud ne perd pas la nouvelle lecture',async({page})=>{
 let release,entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let reads=0;
 await page.route('**/imprimante-api/files/local?**',async route=>{reads++;if(reads===1){entered();await gate;}const path=new URL(route.request().url()).searchParams.get('path');await route.fulfill({json:{files:[{name:path==='/nouveau'?'nouveau.gcode':'ancien.gcode'}],path}});});
 await login(page);await page.getByRole('button',{name:'Fichiers',exact:true}).click();await waiting;await page.locator('#file-path').fill('/nouveau');await page.locator('#files-form').evaluate(f=>f.requestSubmit());release();
 await expect(page.getByText('nouveau.gcode',{exact:true})).toBeVisible();await expect(page.getByText('ancien.gcode',{exact:true})).toHaveCount(0);expect(reads).toBe(2);
 await page.getByRole('button',{name:'Cloud Anycubic',exact:true}).click();await expect(page.locator('#file-rows')).not.toContainText('nouveau.gcode');await expect(page.locator('#files-state')).toContainText(/\d+ fichiers?/);
});
/** Un choix Cloud effectué pendant la réponse locale doit déclencher sa propre lecture. */
test('le cloud choisi pendant une lecture locale est chargé après la réponse tardive',async({page})=>{
 let release,entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let cloudReads=0;
 await page.route('**/imprimante-api/files/local?**',async route=>{entered();await gate;await route.fulfill({json:{files:[{name:'ancien-local.gcode'}],path:'/'}});});
 await page.route('**/imprimante-api/files/cloud?**',async route=>{cloudReads++;await route.fulfill({json:{files:[{name:'cloud-seul.gcode',handle:'fake-file'}],store:{used_bytes:0,total_bytes:1024}}});});
 await login(page);await page.getByRole('button',{name:'Fichiers',exact:true}).click();await waiting;await page.getByRole('button',{name:'Cloud Anycubic',exact:true}).click();release();
 await expect(page.getByText('cloud-seul.gcode',{exact:true})).toBeVisible();await expect(page.getByText('ancien-local.gcode',{exact:true})).toHaveCount(0);expect(cloudReads).toBe(1);
});

test('les fichiers non imprimables et la dernière page désactivent les actions',async({page})=>{
 await page.route('**/imprimante-api/files/cloud?**',route=>route.fulfill({json:{
  files:[{name:'fixture.3mf',handle:'fixture',printable:false}],
  has_more:false,
  store:{used_bytes:0,total_bytes:1024}
 }}));
 await login(page);
 await page.getByRole('button',{name:'Fichiers',exact:true}).click();
 await page.getByRole('button',{name:'Cloud Anycubic',exact:true}).click();
 await expect(page.locator('#file-rows')).toContainText('3MF · à trancher');
 const row = page.locator('#file-rows');
 await expect(row.getByRole('button',{name:'Imprimer',exact:true})).toHaveCount(0);
 await expect(row.getByRole('button',{name:'Télécharger',exact:true})).toHaveCount(0);
 const trigger = row.getByRole('button',{name:/Actions du fichier/});
 await trigger.focus();
 await page.keyboard.press('Enter');
 await expect(trigger).toHaveAttribute('aria-expanded','true');
 await expect(row.getByRole('button',{name:'Télécharger',exact:true})).toBeVisible();
 await expect(row.getByRole('button',{name:'Imprimer',exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');
 await expect(trigger).toBeFocused();
 await expect(trigger).toHaveAttribute('aria-expanded','false');
 await trigger.click();
 await row.locator('.files-row-actions').getByRole('button',{name:'Détails du fichier'}).click();
 await expect(page.getByRole('dialog',{name:'fixture.3mf'})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.locator('#next-page')).toBeDisabled();
});

test('la sélection Cloud ne comprend que les fichiers visibles après une recherche',async({page})=>{
 let reads=0;
 await page.route('**/imprimante-api/files/cloud?**',route=>{
  reads++;
  return route.fulfill({json:{files:[
   {name:'Alpha.3mf',handle:'alpha',size_mb:1},
   {name:'Beta.3mf',handle:'beta',size_mb:2}
  ],has_more:false}});
 });
 await login(page);
 await page.getByRole('button',{name:'Fichiers',exact:true}).click();
 await page.getByRole('button',{name:'Cloud Anycubic',exact:true}).click();
 await expect(page.locator('#file-rows tr')).toHaveCount(2);
 await page.locator('#files-sort').selectOption('size');
 await expect(page.locator('#file-rows tr').first()).toContainText('Beta.3mf');
 await page.getByLabel('Sélectionner Beta.3mf',{exact:true}).check();
 await page.locator('#files-search').fill('Alpha');
 await expect(page.locator('#cloud-selected-count')).toHaveText('0 sélection');
 await page.locator('#cloud-select-page').check();
 await expect(page.locator('#cloud-selected-count')).toHaveText('1 sélection');
 await expect(page.locator('#file-rows')).not.toContainText('Beta.3mf');
 expect(reads).toBe(1);
});

test('un aperçu indisponible est redemandé après le délai',async({page})=>{
 let reads=0;
 await page.route('**/imprimante-api/preview',async route=>{
  reads++;
  if(reads===1)await route.fulfill({status:503,json:{ok:false,message:'Aperçu indisponible'}});
  else await route.continue();
 });
 await login(page);
 await expect.poll(()=>page.evaluate(async()=>{const {previewJob}=await import(document.querySelector('#workshop-script').src);return previewJob?.attempts===1&&!previewJob.pending;})).toBe(true);
 await expect(page.locator('#job-preview')).toBeHidden();
 const now=await page.evaluate(()=>Date.now());
 await page.clock.setSystemTime(now+11000);
 await page.evaluate(async()=> (await import(document.querySelector('#workshop-script').src)).refresh());
 await expect(page.locator('#job-preview')).toBeVisible();
 expect(reads).toBe(2);
});


test('les miniatures précèdent les noms et se chargent une à la fois',async({page})=>{
 let concurrent=0,maxConcurrent=0,reads=0,release;
 const firstPreview=new Promise(resolve=>release=resolve);
 await page.route('**/imprimante-api/preview',async route=>{
  const file=route.request().postDataJSON();
  if(!file.path)return route.continue();
  const index=++reads;
  concurrent++;
  maxConcurrent=Math.max(concurrent,maxConcurrent);
  if(index===1)await firstPreview;
  concurrent--;
  if(index===2)return route.fulfill({json:{image:'data:image/png;base64,AAAA'}});
  return route.fulfill({json:{image:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>')}});
 });
 await login(page);
 await page.getByRole('button',{name:'Fichiers',exact:true}).click();
 const rows=page.locator('#file-rows');
 const thumbnails=rows.locator('.file-thumbnail');
 const first=thumbnails.first();
 try{
  await expect(first).toHaveAttribute('aria-busy','true');
  expect(await first.evaluate(el=>getComputedStyle(el,'::before').animationName)).toBe('file-thumbnail-spin');
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await first.evaluate(el=>getComputedStyle(el,'::before').animationName)).toBe('none');
 }finally{release();}
 await expect(first.locator('img')).toBeVisible();
 await expect(first).not.toHaveAttribute('aria-busy');
  await expect(thumbnails.nth(1)).toHaveAttribute('role','group');
  await expect(thumbnails.nth(1)).toHaveAttribute('aria-label','Aperçu indisponible');
 await expect(thumbnails.nth(1)).toHaveAttribute('title','Aperçu indisponible');
 await expect(thumbnails.nth(1)).not.toHaveAttribute('aria-busy');
 await expect(rows.getByRole('button',{name:'Aperçu',exact:true})).toHaveCount(0);
 await expect.poll(()=>reads).toBeGreaterThanOrEqual(2);
 expect(maxConcurrent).toBe(1);
 await rows.getByRole('button',{name:/Agrandir l’aperçu/}).first().click();
 await expect(page.locator('.file-preview-dialog')).toBeVisible();
 await expect(page.locator('.file-preview-dialog img')).toBeVisible();
 expect(maxConcurrent).toBe(1);
 await page.keyboard.press('Escape');
 await expect(page.locator('.file-preview-dialog')).toHaveCount(0);
});

test('l’ordre des bobines se règle dans la confirmation du fichier choisi', async ({ page }) => {
 const commands = [];
 await page.route('**/imprimante-api/command', route => {
  commands.push(route.request().postDataJSON());
  return route.fulfill({json:{ok:true,message:'Simulation uniquement'}});
 });
 await page.route('**/imprimante-api/files/local?**', route => route.fulfill({json:{files:[{name:'piece.gcode.3mf'}],path:'/'}}));
 await login(page, 'files');
 const row = page.locator('#file-rows tr').first();
 await chooseFileAction(row, 'Imprimer');
 const dialog = page.getByRole('dialog', {name:'Lancer l’impression'});
 await expect(dialog).toContainText('Kobra S1 · Démonstration');
 await expect(dialog).toContainText('Aperçu indisponible');
 await expect(dialog).toContainText('Vérifiez que le plateau est libre.');
 const choices = dialog.locator('#print-ace-rows select');
 await expect(choices.first().locator('option[value="1"]')).toContainText('Emplacement 1');
 await expect(dialog.locator('#print-yes')).toBeDisabled();
 await choices.first().selectOption('1');
 await dialog.locator('#print-add-slot').click();
 await expect(dialog.locator('#print-yes')).toBeDisabled();
 await choices.nth(1).selectOption('3');
 await dialog.locator('#print-add-slot').click();
 await choices.nth(2).selectOption('2');
 expect(commands).toHaveLength(0);
 await dialog.getByRole('button', {name:'Lancer l’impression',exact:true}).click();
 await expect.poll(() => commands.length).toBe(1);
 expect(commands[0]).toMatchObject({action:'print-local',name:'piece.gcode.3mf',slots:[1,3,2]});
});

test('une nouvelle tâche mémoire corrélée remplace l’attente sans accusé MQTT', async ({page}) => {
 let accepted = false;
 await page.route('**/imprimante-api/status**', async route => {
  const response = await route.fetch();
  const data = await response.json();
  Object.assign(data.printer, accepted
   ? {job_name:'piece.gcode.3mf', command_project:'nouvelle', job_in_progress:true, job_state:'preheating', is_available:false}
   : {job_name:'piece.gcode.3mf', command_project:'ancienne', job_in_progress:false, is_available:true});
  await route.fulfill({json:data});
 });
 await page.route('**/imprimante-api/files/local?**', route => route.fulfill({json:{files:[{name:'piece.gcode.3mf'}],path:'/'}}));
 await page.route('**/imprimante-api/command', route => {
  accepted = true;
  return route.fulfill({json:{ok:true,message:'Confirmation machine en attente'}});
 });
 await login(page, 'files');
 await chooseFileAction(page.locator('#file-rows tr').first(), 'Imprimer');
 const dialog = page.getByRole('dialog', {name:'Lancer l’impression'});
 await dialog.locator('#print-ace-rows select').first().selectOption('1');
 await dialog.getByRole('button', {name:'Lancer l’impression',exact:true}).click();
 await expect(dialog.getByText('Préparation en cours sur l’imprimante.')).toBeVisible();
 await expect(page.locator('#message')).toBeHidden();
});
