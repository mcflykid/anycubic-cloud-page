const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
const {version}=require('../../package.json');

test('le pied de page affiche la version construite et ses quatre notices sur mobile',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await page.route('**/imprimante-api/status',route=>route.fulfill({json:{ok:false,message:'Cloud indisponible'}}));
 await login(page);
 await expect(page.locator('#app-version')).toHaveText('Version '+version);
 const links=page.locator('.printer-footer nav a');
 await expect(links).toHaveText(['Confidentialité','Conditions','Cookies']);
 for(const [path,title] of [['/about','Confidentialité'],['/conditions','Conditions d’utilisation'],['/cookies','Cookies et stockage local'],['/credits','Crédits']]){
  await page.locator(`.printer-footer a[href="${path}"]`).click();
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

test('la Kobra S1 retrouve ses illustrations d’origine quand la génération ACE manque',async({page})=>{
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch();
  const data=await response.json();
  for(const box of data.printer.boxes)delete box.model;
  await route.fulfill({response,json:data});
 });
 await login(page);
 await expect(page.locator('#printer-illustration')).toHaveAttribute('src','/icons/kobra-s1-ace2pro.png');
 await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
 await expect(page.locator('#ace-illustration')).toHaveAttribute('src','/icons/ace2pro.png');
 await expect(page.locator('#ace-model')).toHaveText('Module ACE');
 await expect(page.locator('#ace-display-model')).toHaveCount(0);
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
 await expect(page.locator('#timelapse-state')).toContainText('Aucun flux ni timelapse');
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

test('la galerie timelapse conserve la recherche sur la page suivante',async({page})=>{
 let queries=[];
 await page.route('**/imprimante-api/extras/videos?**',route=>{
  const params=new URL(route.request().url()).searchParams;
  const pageNumber=params.get('page');
  queries.push([pageNumber,params.get('keyword')]);
  return route.fulfill({json:{available:true,has_more:pageNumber==='1',items:[
   {name:'Vidéo fictive '+pageNumber,size:1024,duration:4,created:1750000000},
  ]}});
 });
 await login(page);
 await page.getByRole('button',{name:'Caméra',exact:true}).click();
 await expect(page.locator('#timelapse-list')).toContainText('Vidéo fictive 1');
 await page.getByLabel('Rechercher une vidéo').fill('cube');
 await page.locator('#timelapse-search button').click();
 await expect.poll(()=>queries.at(-1)).toEqual(['1','cube']);
 await page.locator('#timelapse-next').click();
 await expect(page.locator('#timelapse-list')).toContainText('Vidéo fictive 2');
 expect(queries.at(-1)).toEqual(['2','cube']);
 await expect(page.locator('#timelapse-next')).toBeDisabled();
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
