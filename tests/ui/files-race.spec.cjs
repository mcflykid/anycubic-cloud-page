const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
/** Une liste lente ne doit jamais être appliquée à la source choisie entre-temps. */
test('les fichiers tardifs ne changent pas de source et la dernière lecture repart',async({page})=>{
 let release,entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const commands=[];
 await page.route('**/imprimante-api/files/local?**',async route=>{entered();await gate;await route.fulfill({json:{files:[{name:'ancien-local.gcode',size_mb:1}],path:'/test_model'}});});
 await page.route('**/imprimante-api/files/usb?**',route=>route.fulfill({json:{files:[{name:'courant-usb.gcode',size_mb:1}],path:'/test_model'}}));
 await page.route('**/imprimante-api/command',async route=>{commands.push(route.request().postDataJSON());await route.fulfill({json:{ok:true,message:'Simulation uniquement'}});});
 await login(page);await page.getByRole('button',{name:'Fichiers',exact:true}).click();await waiting;
 await page.getByRole('button',{name:'Clé USB',exact:true}).click();await expect(page.getByText('ancien-local.gcode',{exact:true})).toHaveCount(0);release();
 await expect(page.getByText('courant-usb.gcode',{exact:true})).toBeVisible();await expect(page.getByText('ancien-local.gcode',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Supprimer',exact:true}).click();await page.locator('#confirm-yes').click();await expect.poll(()=>commands.length).toBe(1);
 expect(commands[0].action).toBe('delete-usb');expect(commands[0].name).toBe('courant-usb.gcode');
});
/** Le chemin et le cloud courants sont relus après une consultation en attente. */
test('un changement de dossier puis de cloud ne perd pas la nouvelle lecture',async({page})=>{
 let release,entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let reads=0;
 await page.route('**/imprimante-api/files/local?**',async route=>{reads++;if(reads===1){entered();await gate;}const path=new URL(route.request().url()).searchParams.get('path');await route.fulfill({json:{files:[{name:path==='/nouveau'?'nouveau.gcode':'ancien.gcode'}],path}});});
 await login(page);await page.getByRole('button',{name:'Fichiers',exact:true}).click();await waiting;await page.locator('#file-path').fill('/nouveau');await page.locator('#files-form').evaluate(f=>f.requestSubmit());release();
 await expect(page.getByText('nouveau.gcode',{exact:true})).toBeVisible();await expect(page.getByText('ancien.gcode',{exact:true})).toHaveCount(0);expect(reads).toBe(2);
 await page.getByRole('button',{name:'Cloud Anycubic',exact:true}).click();await expect(page.locator('#file-rows')).not.toContainText('nouveau.gcode');await expect(page.locator('#files-state')).toContainText('fichier(s)');
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

test('un aperçu indisponible est redemandé après le délai',async({page})=>{
 let reads=0;
 await page.route('**/imprimante-api/preview',async route=>{
  reads++;
  if(reads===1)await route.fulfill({status:503,json:{ok:false,message:'Aperçu indisponible'}});
  else await route.continue();
 });
 await login(page);
 await expect.poll(()=>page.evaluate(()=>previewJob?.attempts===1&&!previewJob.pending)).toBe(true);
 await expect(page.locator('#job-preview')).toBeHidden();
 const now=await page.evaluate(()=>Date.now());
 await page.clock.setSystemTime(now+11000);
 await page.evaluate(()=>refresh());
 await expect(page.locator('#job-preview')).toBeVisible();
 expect(reads).toBe(2);
});
