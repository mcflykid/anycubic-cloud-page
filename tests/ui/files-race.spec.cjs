const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
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
 await page.locator('#file-rows').getByRole('button',{name:'Supprimer',exact:true}).click();await page.locator('#confirm-yes').click();await expect.poll(()=>commands.length).toBe(1);
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
 await expect(page.locator('#file-rows').getByRole('button',{name:'Imprimer',exact:true})).toBeDisabled();
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
 await login(page, 'files');
 await page.locator('[data-source=cloud]').click();
 const row = page.locator('#file-rows tr').first();
 await row.getByRole('button', {name:'Imprimer',exact:true}).click();
 const dialog = page.getByRole('dialog', {name:'Lancer l’impression'});
 await expect(dialog).toContainText('Kobra S1 · Démonstration');
 await expect(dialog).toContainText('Aperçu indisponible');
 await expect(dialog).toContainText('Vérifiez que le plateau est libre.');
 await dialog.locator('#print-slots').fill('1, 3, 2');
 expect(commands).toHaveLength(0);
 await dialog.getByRole('button', {name:'Lancer l’impression',exact:true}).click();
 await expect.poll(() => commands.length).toBe(1);
 expect(commands[0]).toMatchObject({action:'print-cloud',slots:[1,3,2]});
});
