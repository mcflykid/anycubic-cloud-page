const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
const {version}=require('../../package.json');

test('le pied de page affiche la version construite et ses quatre notices sur mobile',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await page.route('**/imprimante-api/status',route=>route.fulfill({json:{ok:false,message:'Cloud indisponible'}}));
 await login(page);
 await expect(page.getByRole('link',{name:'Version '+version,exact:true})).toHaveAttribute('href','https://github.com/mcflykid/anycubic-cloud-page');
 const links=page.locator('.printer-footer nav a');
 await expect(links).toHaveText(['Confidentialité','Conditions','Cookies']);
 for(const [path,title] of [['/about','Confidentialité'],['/conditions','Conditions d’utilisation'],['/cookies','Cookies et stockage local'],['/credits','Crédits']]){
  await page.locator(`.printer-footer a[href="/imprimante-api/ui${path}"]`).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText(title);
  await page.getByRole('link',{name:'Retour à l’atelier'}).click();
 }
 expect(await page.locator('footer').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 const legal=await links.first().boundingBox();
 const credit=await page.locator('.footer-credits').boundingBox();
 expect(Math.abs(legal.y-credit.y)).toBeLessThan(2);
});

test('les crédits restent alignés à droite sur ordinateur',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await login(page);
 const [footer,versionLabel,credit]=await Promise.all([
  page.locator('.printer-footer').boundingBox(),
  page.locator('#app-version').boundingBox(),
  page.getByRole('link',{name:'Crédits',exact:true}).boundingBox(),
 ]);
 expect(Math.abs(credit.y+credit.height/2-versionLabel.y-versionLabel.height/2)).toBeLessThan(4);
 expect(Math.abs(credit.x+credit.width-footer.x-footer.width)).toBeLessThan(2);
});

test('la fiche terminée expose l’évaluation et la confirmation de réimpression explicite',async({page})=>{
 await login(page);
 await page.getByRole('button',{name:'Historique d’impression',exact:true}).click();
 await page.getByRole('button',{name:'Voir le détail',exact:true}).first().click();
 await expect(page.locator('#past-task-data')).toContainText('Durée rapportée');
 await expect(page.locator('#past-task-parameters')).toContainText('Filaments estimés par matière');
 await page.getByRole('button',{name:'Évaluer',exact:true}).click();
 await expect(page.locator('#rating-form fieldset')).toBeEnabled();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Voir le détail',exact:true}).first().click();
 await page.getByRole('button',{name:'Imprimer à nouveau',exact:true}).click();
 await page.locator('#task-reprint-form [name=slots]').fill('1, 3');
 await page.locator('#task-reprint-form button[type=submit]').click();
 await expect(page.locator('#confirm-text')).toContainText('Kobra S1 · Démonstration');
 await expect(page.locator('#confirm-text')).toContainText('emplacements 1, 3');
 await page.locator('#confirm-no').click();
 await expect(page.locator('#task-reprint-dialog')).toBeVisible();
});

test('les pastilles Terminé et Arrêté sont centrées dans leurs cartes',async({page})=>{
 await login(page);
 await page.getByRole('button',{name:'Historique d’impression',exact:true}).click();
 for(const kind of ['Terminé','Arrêté']){
  const badge=page.locator('.history-badge').filter({hasText:new RegExp('^'+kind+'$')}).first();
  await expect(badge).toBeVisible();
  const rect=await badge.evaluate(el=>{
   const tag=el.getBoundingClientRect(),card=el.closest('.history-card-body').getBoundingClientRect();
   return Math.abs(tag.left+tag.width/2-card.left-card.width/2);
  });
  expect(rect).toBeLessThan(2);
 }
});

test('la Kobra S1 garde un visuel dédié et un ACE générique si la génération manque',async({page})=>{
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch();
  const data=await response.json();
  for(const box of data.printer.boxes)delete box.model;
  await route.fulfill({response,json:data});
 });
 await login(page);
 await expect(page.locator('#printer-illustration')).toHaveAttribute('src','/imprimante-api/ui/icons/kobra-s1.svg');
 await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
 await expect(page.locator('#ace-illustration')).toHaveAttribute('src','/imprimante-api/ui/icons/ace.svg');
 await expect(page.locator('#ace-model')).toHaveText('Module ACE');
 await expect(page.locator('#ace-display-model')).toHaveCount(0);
 await page.getByRole('button',{name:'Réglages',exact:true}).click();
 await expect(page.locator('#settings-printer-illustration')).toHaveAttribute('src','/imprimante-api/ui/icons/kobra-s1.svg');
});

test('les axes conservent leurs directions et les pictogrammes restent sur les libellés',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await login(page);
 await expect(page.locator('#details')).toContainText('Nombre d’impressions');
 await expect(page.locator('#temperatures dt svg').first()).toHaveAttribute('aria-hidden','true');
 await expect(page.locator('#temperatures dd svg,#details dd svg')).toHaveCount(0);
 await page.getByRole('button',{name:'Caméra',exact:true}).click();
 await page.getByLabel('Pas',{exact:true}).selectOption('15');
 await expect(page.getByLabel('Pas',{exact:true})).toHaveValue('15');
 await expect(page.locator('.camera-control-group h3')).toHaveText(['Caméra','Affichage','Éclairage']);
 await expect(page.getByRole('button',{name:'X −',exact:true})).toHaveAttribute('data-direction','0');
 await expect(page.getByRole('button',{name:'Y +',exact:true})).toHaveAttribute('data-axis','2');
 await expect(page.getByRole('button',{name:'Z +',exact:true})).toHaveAttribute('data-direction','1');
 await expect(page.locator('.timelapse-panel')).toBeHidden();
 await page.getByRole('button',{name:'Réglages',exact:true}).click();
 await expect(page.locator('#tab-settings')).not.toContainText('Commandes courantes');
 await expect(page.locator('#tab-settings #light-on,#tab-settings #light-off')).toHaveCount(0);
 await expect(page.locator('#settings-form')).toBeVisible();
});

test('les pauses regroupées gardent leurs événements individuels',async({page})=>{
 const base={name:'Impression fictive',printer:'Atelier fictif',result:'Impression en pause',kind:'info',unread:true,reason:'Pause demandée par l’utilisateur'};
 const notifications={unread:3,items:[
  {...base,key:'p1',group:'a',time:1750000000},
  {...base,key:'p2',group:'a',time:1750000001},
  {...base,key:'p3',group:'b',printer:'Autre atelier',time:1750000002},
 ]};
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch();
  await route.fulfill({response,json:{...await response.json(),notifications}});
 });
 await login(page);
 await page.locator('#notifications-toggle').click();
 const group=page.locator('.notification-group');
 await expect(group).toHaveCount(1);
 await expect(group.locator('summary')).toContainText('2 événements');
 await group.locator('summary').click();
 await expect(group.locator('time')).toHaveCount(2);
 await expect(group.locator('.notification-delete')).toHaveCount(2);
 await expect(page.locator('#history-list')).toContainText('Autre atelier');
});

test('ouvrir Caméra ne consulte pas la galerie Timelapse désactivée',async({page})=>{
 const reads=[];
 page.on('request',request=>{if(request.url().includes('/extras/videos'))reads.push(request);});
 await login(page);
 await page.getByRole('button',{name:'Caméra',exact:true}).click();
 await expect(page.locator('.timelapse-panel')).toBeHidden();
 await expect(page.locator('#axis-state')).toHaveText('Commandes disponibles');
 expect(reads).toHaveLength(0);
 const response=await page.request.get('/imprimante-api/extras/videos');
 expect(response.status()).toBe(404);
});

test('les états utilisent les pastilles et l’aide du relais explique la bobine de secours',async({page})=>{
 let drying=true;
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch();
  const data=await response.json();
  data.printer.boxes[0].drying.is_drying=drying;
  await route.fulfill({response,json:data});
 });
 await login(page);
 await expect(page.locator('#printer-status')).toHaveClass(/badge/);
 await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
 await expect(page.locator('#ace-status')).toHaveClass(/badge/);
 for(const width of [1280,360]){
  await page.setViewportSize({width,height:900});
  const extraWidth=await page.locator('#ace-status').evaluate(badge=>{
   const text=document.createRange();
   text.selectNodeContents(badge);
   const {paddingLeft,paddingRight}=getComputedStyle(badge);
   return badge.getBoundingClientRect().width-text.getBoundingClientRect().width-parseFloat(paddingLeft)-parseFloat(paddingRight);
  });
  expect(Math.abs(extraWidth)).toBeLessThan(1);
 }
 await page.setViewportSize({width:1280,height:900});
 await expect(page.locator('#ace-model')).toHaveText('ACE 2 Pro');
 await page.locator('#go-drying').click();
 await expect(page.locator('#drying-state')).toHaveText('Séchage actif');
 await expect(page.locator('#drying-state')).not.toHaveClass(/inactive/);
 await page.getByRole('button',{name:'Aide sur le relais automatique des bobines'}).click();
 await expect(page.getByRole('tooltip')).toContainText('même matière et couleur');
 drying=false;
 await expect(page.locator('#drying-state')).toHaveText('Séchage inactif');
 await expect(page.locator('#drying-state')).toHaveClass(/inactive/);
});

test('un proxy qui conserve ses anciens chemins sert toute l’interface',async({page,baseURL})=>{
 const origin=new URL(baseURL).origin;
 const oldPaths=new Set(['/imprimante.html','/login','/logout','/about','/css/landing.css','/css/imprimante.css','/js/imprimante.js','/js/agora-rtc.js','/icons/cloud-page.svg','/icons/kobra-s1-ace2pro.png','/icons/ace2pro.png']);
 const blocked=[];
 await page.route(url=>url.origin===origin,async route=>{
  const path=new URL(route.request().url()).pathname;
  if(oldPaths.has(path)||path.startsWith('/imprimante-api/'))return route.fallback();
  blocked.push(path);
  return route.fulfill({status:404,contentType:'application/octet-stream',body:'Site statique'});
 });
 await login(page);
 await expect(page.locator('#printer-illustration')).toBeVisible();
 await expect.poll(()=>page.locator('#printer-illustration').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
 await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
 await expect.poll(()=>page.locator('#ace-illustration').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
 for(const [label,heading] of [['Conditions','Conditions d’utilisation'],['Cookies','Cookies et stockage local'],['Crédits','Crédits']]){
  const [response]=await Promise.all([
   page.waitForResponse(response=>response.request().isNavigationRequest()&&response.url().includes('/imprimante-api/ui/')),
   page.getByRole('link',{name:label,exact:true}).click(),
  ]);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  expect(response.headers()['content-disposition']).toBeUndefined();
  await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Retour à l’atelier'}).click();
 }
 expect(blocked).toEqual([]);
});

test('les visuels suivent le modèle constructeur et la présence réelle de l’ACE',async({page})=>{
 let model='Anycubic Kobra 3',box='ACE Pro';
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch(),data=await response.json();
  data.printer.machine_name=model;data.printer.name='Anycubic Kobra S1';
  if(box)data.printer.boxes[0].model=box;else data.printer.boxes=[];
  await route.fulfill({response,json:data});
 });
 await login(page);
 const icons='/imprimante-api/ui/icons/';
 await expect(page.locator('#printer-illustration')).toHaveAttribute('src',icons+'kobra-3.svg');
 await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
 await expect(page.locator('#ace-illustration')).toHaveAttribute('src',icons+'ace-pro.svg');
 model='Anycubic Kobra X';box=null;
 await page.evaluate(()=>refresh());
 await expect(page.locator('#printer-illustration')).toHaveAttribute('src',icons+'kobra-x.svg');
 await expect(page.locator('#ace-illustration')).toBeHidden();
 model='Modèle inconnu';
 await page.evaluate(()=>refresh());
 await expect(page.locator('#settings-printer-illustration')).toHaveAttribute('src',icons+'printer.svg');
});
