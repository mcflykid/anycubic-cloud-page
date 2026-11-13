const {test,expect}=require('@playwright/test');
const {login,openSection}=require('./helpers.cjs');
const {version}=require('../../package.json');

test('le pied de page affiche la version construite et ses quatre notices sur mobile',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await page.route('**/imprimante-api/status',route=>route.fulfill({json:{ok:false,message:'Cloud indisponible'}}));
 await login(page);
 const versionLink = page.getByRole('link',{name:'Version '+version,exact:true});
 await expect(versionLink).toHaveAttribute('href','https://github.com/mcflykid/anycubic-cloud-page/releases/tag/v'+version);
 await expect(versionLink).toHaveCSS('border-top-width','0px');
 await expect(versionLink).toHaveCSS('padding-left','0px');
 const links=page.locator('.printer-footer nav a');
 await expect(links).toHaveText(['Confidentialité','Conditions','Cookies','Crédits']);
 for(const [path,title] of [['/about','Confidentialité'],['/conditions','Conditions d’utilisation'],['/cookies','Cookies et stockage local'],['/credits','Crédits']]){
  await expect(page.locator('#connection')).toHaveText('Cloud indisponible');
  await page.locator(`.printer-footer a[href="/imprimante-api/ui${path}"]`).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText(title);
  await page.getByRole('link',{name:'Retour à l’atelier'}).click();
 }
 expect(await page.locator('.printer-footer').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 const offset=await page.locator('.printer-footer').evaluate(footer=>{
  const legal=footer.querySelector('nav a').getBoundingClientRect();
  const credit=footer.querySelector('.footer-credits').getBoundingClientRect();
  return Math.abs(legal.y-credit.y);
 });
 expect(offset).toBeLessThan(2);
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
 const inset=await page.locator('.printer-footer').evaluate(el=>parseFloat(getComputedStyle(el).paddingRight)+el.clientLeft);
 expect(Math.abs(credit.x+credit.width-footer.x-footer.width+inset)).toBeLessThan(2);
});

test('la fiche terminée expose l’évaluation et la confirmation de réimpression explicite',async({page})=>{
 await login(page);
 await openSection(page,'history');
 await page.getByRole('button',{name:'Voir le détail',exact:true}).first().click();
 await expect(page.locator('#past-task-data')).toContainText('Dimensions');
 await expect(page.locator('#past-task-materials')).toContainText('Filaments estimés par matière');
 await page.getByRole('button',{name:'Évaluer',exact:true}).click();
 await expect(page.locator('#rating-form fieldset')).toBeEnabled();
 const three=page.getByRole('radio',{name:'3 ★',exact:true});
 await expect(three).toBeEnabled();
 await three.check();
 await expect(three).toBeChecked();
 await three.focus();
 await expect(three).toBeFocused();
 await expect(page.locator('.rating-stars label').nth(1).locator('svg')).toHaveCSS('fill-opacity','1');
 await expect(page.locator('.rating-stars label').nth(3).locator('svg')).toHaveCSS('fill-opacity','0');
 await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('radio',{name:'4 ★',exact:true})).toBeChecked();
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

test('l’historique affiche les états et interdit la réimpression d’une tâche active',async({page})=>{
 await login(page,'history');
 await expect(page.locator('.history-status-2').first()).toHaveText('Terminée');
 await expect(page.locator('.history-status-3').first()).toHaveText('Arrêtée');
 const active=page.locator('#tasks-list tr').filter({has:page.locator('.history-status-1')}).first();
 await expect(active.locator('.history-status-1')).toContainText('50 %');
 await expect(active.getByRole('button',{name:'Réimprimer'})).toBeDisabled();
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
 await openSection(page,'settings');
 await expect(page.locator('#summary-printer-image')).toHaveAttribute('src','/imprimante-api/ui/icons/kobra-s1.svg');
});

test('les axes conservent leurs directions et les pictogrammes restent sur les libellés',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await login(page);
 await expect(page.locator('#details')).toContainText('Impressions');
 await expect(page.locator('#temperatures thead')).toContainText('Actuelle');
 await expect(page.locator('#temperatures dd svg,#details dd svg')).toHaveCount(0);
 await openSection(page,'camera');
 await expect(page.getByRole('button',{name:'Lire les coordonnées',exact:true})).toHaveCount(0);
 const steps=page.getByRole('radiogroup',{name:'Pas',exact:true});
 await expect(steps.getByRole('radio',{name:'1 mm',exact:true})).toBeChecked();
 await steps.getByRole('radio',{name:'15 mm',exact:true}).check();
 await expect(steps.getByRole('radio',{name:'15 mm',exact:true})).toBeChecked();
 await expect(page.getByText('Surveillez la distance buse-plateau',{exact:false})).toBeVisible();
 const grid=page.locator('.camera-axis-grid');
 await expect(grid.getByRole('group',{name:'Déplacement XY'})).toBeVisible();
 await expect(grid.getByRole('group',{name:'Déplacement Z'})).toBeVisible();
 await expect(grid.getByRole('button',{name:'Origine de tous les axes'})).toBeVisible();
 for(const name of ['X −','X +','Y −','Y +','Z −','Z +']){
  await expect(grid.getByRole('button',{name,exact:true})).toHaveCSS('justify-content','center');
  await expect(grid.getByRole('button',{name,exact:true})).toHaveCSS('align-items','center');
 }
 await expect(page.getByRole('button',{name:'X −',exact:true})).toHaveAttribute('data-direction','0');
 await expect(page.getByRole('button',{name:'Y +',exact:true})).toHaveAttribute('data-axis','2');
 await expect(page.getByRole('button',{name:'Z +',exact:true})).toHaveAttribute('data-direction','1');
 await expect(page.getByRole('button',{name:'Origine XY',exact:true})).toHaveAttribute('data-axis','4');
 await expect(page.getByRole('button',{name:'Origine Z',exact:true})).toHaveAttribute('data-direction','2');
 const pad=page.getByRole('group',{name:'Déplacement XY'});
 await pad.scrollIntoViewIfNeeded();
 const shape=await pad.evaluate(element=>{
  const bounds=element.getBoundingClientRect();
  const points=[[.5,1/6],[1/6,.5],[5/6,.5],[.5,5/6],[.5,.5]];
  return {width:bounds.width,height:bounds.height,axes:points.map(([x,y])=>document.elementFromPoint(bounds.left+x*bounds.width,bounds.top+y*bounds.height)?.closest('button')?.dataset.axis)};
 });
 expect(shape.width).toBeCloseTo(shape.height);
 expect(shape.axes).toEqual(['2','1','1','2','4']);

 await expect(page.locator('.timelapse-panel')).toBeHidden();
 await openSection(page,'settings');
 await expect(page.locator('#tab-settings')).not.toContainText('Commandes courantes');
 await expect(page.locator('#tab-settings #light-on,#tab-settings #light-off')).toHaveCount(0);
 await expect(page.locator('#tab-settings #settings-form')).toHaveCount(0);
});

test('les pauses regroupées gardent leurs événements individuels',async({page})=>{
 const base={name:'Impression fictive',printer:'Atelier fictif',result:'Impression en pause',kind:'info',unread:true,reason:'Pause demandée par l’utilisateur'};
 const notifications={unread:3,items:[
  {...base,key:'p1',group:'a',time:1750000000},
  {...base,key:'p2',group:'a',time:1750000001},
  {...base,key:'p3',group:'b',printer:'Autre atelier',time:1750000002},
 ]};
 await page.route('**/imprimante-api/history?page=1&source=legacy',route=>route.fulfill({json:{...notifications,source:'legacy'}}));
 await login(page,'history');
 await page.locator('#historical-notifications-open').click();
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
 await openSection(page,'camera');
 await expect(page.locator('.timelapse-panel')).toBeHidden();
 await expect(page.locator('#axis-state')).toHaveText('Commandes disponibles');
 expect(reads).toHaveLength(0);
 const response=await page.request.get('/imprimante-api/extras/videos');
 expect(response.status()).toBe(404);
});

test('les états associent un point à un libellé et l’aide du relais explique la bobine de secours',async({page})=>{
 let drying=true;
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch();
  const data=await response.json();
  data.printer.boxes[0].drying.is_drying=drying;
  await route.fulfill({response,json:data});
 });
 await login(page);
 await expect(page.locator('#printer-status')).toHaveClass(/atelier-status/);
 await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
 await expect(page.locator('#ace-status')).toHaveAttribute('data-state','running');
 for(const width of [1280,360]){
  await page.setViewportSize({width,height:900});
  expect(await page.locator('#ace-status').evaluate(status=>getComputedStyle(status,'::before').width)).toBe('8px');
 }
 await page.setViewportSize({width:1280,height:900});
 await expect(page.locator('#ace-model')).toHaveText('ACE 2 Pro');
 await page.locator('#go-drying').click();
 await expect(page.locator('#drying-state')).toHaveText('Séchage en cours');
 await expect(page.locator('#drying-state')).not.toHaveClass(/inactive/);
 drying=false;
 await expect(page.locator('#drying-state')).toHaveText('Séchage inactif');
 await expect(page.locator('#drying-state')).toHaveClass(/inactive/);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Aide sur le relais automatique des bobines'}).click();
 await expect(page.getByRole('tooltip')).toContainText('même matière et couleur');
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
 await openSection(page,'settings');
 await expect.poll(()=>page.locator('#summary-printer-image').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
 for (const name of ['kobra-s1-ace2pro.png','ace2pro.png']) {
  const asset=await page.request.get('/imprimante-api/ui/icons/'+name);
  expect(asset.status()).toBe(200);
  expect(asset.headers()['content-type']).toContain('image/png');
 }

 for(const [label,heading,route] of [
   ['Conditions','Conditions d’utilisation','conditions'],
   ['Cookies','Cookies et stockage local','cookies'],
   ['Crédits','Crédits','credits'],
 ]){
  const href = '/imprimante-api/ui/' + route;
  await Promise.all([
   page.waitForURL(url=>url.pathname===href),
   page.getByRole('link',{name:label,exact:true}).click(),
  ]);
  const response = await page.request.get(href);
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
 await page.evaluate(async()=> (await import(document.querySelector('#workshop-script').src)).refresh());
 await expect(page.locator('#printer-illustration')).toHaveAttribute('src',icons+'kobra-x.svg');
 await expect(page.locator('#ace-illustration')).toBeHidden();
 await openSection(page,'camera');
 await expect(page.locator('#camera-wrapper')).toContainText('Flux vidéo de la caméra');
 model='Modèle inconnu';
 await page.evaluate(async()=> (await import(document.querySelector('#workshop-script').src)).refresh());
 await expect(page.locator('#summary-printer-image')).toHaveAttribute('src',icons+'printer.svg');
});

test('les illustrations de secours restent visibles si les images du matériel échouent',async({page})=>{
 await page.route(/\/imprimante-api\/ui\/icons\/(kobra-s1-ace2pro|ace2pro)\.png$/,route=>route.abort());
 await login(page);
 const icons='/imprimante-api/ui/icons/';
 await expect(page.locator('#printer-illustration')).toHaveAttribute('src',icons+'kobra-s1.svg');
 await expect(page.locator('#summary-printer-image')).toHaveAttribute('src',icons+'kobra-s1.svg');
 await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
 const ace=page.locator('#ace-illustration');
 await expect(ace).toHaveAttribute('src',icons+'ace.svg');
 await expect.poll(()=>ace.evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
});

test('les commandes courantes gardent la mesure, la confirmation et la cible sur mobile',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch(),data=await response.json();
  Object.assign(data.printer,{job_in_progress:true,curr_nozzle_temp:20,target_nozzle_temp:0,camera_light:false,box_fan_level:0});
  await route.fulfill({response,json:data});
 });
 const commands=[];
 await page.route('**/imprimante-api/command',route=>{
  commands.push({data:route.request().postDataJSON(),target:route.request().headers()['x-printer-key']});
  return route.fulfill({json:{ok:false,message:'Refus fictif'}});
 });
 await login(page);
 await page.getByRole('button',{name:'Commandes courantes',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Commandes courantes'});
 await expect(panel.locator('#current-nozzle-reading')).toContainText('20 °C');
 await expect(panel.locator('#control-light-state')).toHaveText('Éteint');
 await expect(panel.locator('#settings-form')).toBeVisible();
 await panel.getByLabel('Circulation',{exact:true}).fill('100');
 await panel.getByRole('button',{name:'Appliquer les réglages'}).click();
 await page.locator('#confirm-yes').click();
 await expect(panel.locator('#control-feedback')).toHaveText('Refus fictif');
 expect(commands).toHaveLength(1);
 expect(commands[0]).toMatchObject({data:{action:'settings',box_fan_level:'100'},target:'demo-printer'});
 await expect(panel.locator('#control-light-state')).toHaveText('Éteint');
});

test('les cartes des deux appareils s’alignent et se replient sur téléphone', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await login(page);
  await expect(page.locator('#job-preview')).toBeVisible();
  const [machine,heading,thumbnail] = await Promise.all(
    ['#printer-illustration','#job-name','#job-preview'].map(selector=>page.locator(selector).boundingBox()),
  );
  expect(machine.x+machine.width).toBeLessThan(heading.x);
  expect(heading.x+heading.width).toBeLessThan(thumbnail.x);
  await expect(page.locator('#details dd')).toHaveCount(5);
  for(const [section,selector] of [['overview','.printer-workspace'],['ace','.ace-workspace']]){
    await openSection(page,section);
    const cards=page.locator(selector+' > section');
    const [left,right]=await Promise.all([cards.first().boundingBox(),cards.last().boundingBox()]);
    expect(left.width).toBeCloseTo(right.width);
    expect(left.height).toBeCloseTo(right.height);
    await page.setViewportSize({width:390,height:844});
    const [top,bottom]=await Promise.all([cards.first().boundingBox(),cards.last().boundingBox()]);
    expect(top.y+top.height).toBeLessThan(bottom.y);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setViewportSize({width:1440,height:900});
  }
  await expect(page.locator('#spools .ace-spool-row')).toHaveCount(4);
});

test('les statistiques distinguent les boîtiers, le zéro, les lacunes et les changements de bobine', async ({page}) => {
  const stamp = Math.floor(Date.now() / 1000) - 5;
  const periods = [];
  await page.route('**/imprimante-api/status', async route => {
    const response=await route.fetch(), data=await response.json();
    const first=data.printer.boxes[0];
    first.model='ACE 2 Pro';
    data.printer.boxes=[first,{...first,box_id:1,model:'ACE Mini',spools:first.spools.map(spool=>({...spool}))}];
    await route.fulfill({response,json:data});
  });
  await page.route('**/imprimante-api/temperatures?*', async (route) => {
    const hours = new URL(route.request().url()).searchParams.get('hours');
    periods.push(hours);
    const box = (humidity, remaining, material) => ({humidity, slots: {1: {remaining, material}}});
    const readings = hours === '1' ? [
      {time:stamp - 180, nozzle:25, ace:38, ace_boxes:{0:box(18, 10, 'old'), 1:box(24, 47, 'second')}},
      {time:stamp - 120, nozzle:26, ace:39, ace_boxes:{0:box(null, null, 'old')}},
      {time:stamp - 60, nozzle:26, ace:40, ace_boxes:{0:box(0, 0, 'old')}},
      {time:stamp, nozzle:27, ace:40, ace_boxes:{0:box(0, 54, 'new')}},
    ] : [];
    await route.fulfill({json:{readings}});
  });
  await login(page);
  await openSection(page,'ace');
  const secondBox=await page.locator('#ace-selector option').nth(1).getAttribute('value');
  await page.locator('#ace-selector').selectOption(secondBox);
  await openSection(page,'statistics');
  await expect(page.locator('#statistics-printer-name')).toHaveText('Kobra S1 · Démonstration');
  await expect(page.locator('#statistics-ace-name')).toHaveText('ACE 2 Pro');
  await expect(page.locator('#statistics-ace .ace-temperature h4')).toHaveText('Température');
  await expect(page.locator('#chart-humidity strong').first()).toContainText('0 %');
  await expect(page.locator('#chart-humidity h4')).toHaveText('Humidité');
  await expect(page.locator('#statistics-other-ace .ace-chart-group-name')).toHaveText('ACE Mini');
  await expect(page.locator('#statistics-other-ace .temperature-card h4')).toHaveText('Humidité');
  await expect(page.locator('#chart-filament .ace-chart-group-name')).toHaveText(['ACE 2 Pro','ACE Mini']);
  await expect(page.locator('#chart-filament .temperature-card h4')).toHaveText(['Emplacement 1','Emplacement 1']);
  const [aceTemperature, aceHumidity] = await Promise.all([
    page.locator('#chart-ace').boundingBox(),
    page.locator('#chart-humidity').boundingBox(),
  ]);
  expect(aceTemperature.x + aceTemperature.width).toBeLessThan(aceHumidity.x + 2);
  const [temperaturePlot, humidityPlot] = await Promise.all([page.locator('#chart-ace svg').boundingBox(), page.locator('#chart-humidity .temperature-plot svg').first().boundingBox()]);
  expect(Math.abs(temperaturePlot.y - humidityPlot.y)).toBeLessThan(3);
  await page.locator('#statistics-ace').screenshot({path:'test-results/ace-statistics-layout.png'});
  await page.setViewportSize({width:390,height:844});
  const [mobileTemperature, mobileHumidity] = await Promise.all([
    page.locator('#chart-ace').boundingBox(),
    page.locator('#chart-humidity').boundingBox(),
  ]);
  expect(mobileHumidity.y).toBeGreaterThan(mobileTemperature.y + mobileTemperature.height - 2);
  await expect(page.locator('#chart-filament strong').first()).toContainText('54 %');
  const path = await page.locator('#chart-filament svg path').first().getAttribute('d');
  expect(path.match(/M/g)).toHaveLength(3);
  await page.getByLabel('Période des courbes').selectOption('6');
  await expect(page.locator('#chart-humidity')).toHaveText('En attente des premiers relevés.');
  await expect(page.locator('#chart-filament')).toHaveText('En attente des premiers relevés.');
  expect(periods).toEqual(['1','6']);
});

test('la bobine affiche tous les triplets RGB fournis', async ({page}) => {
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), data = await response.json();
    const spools = data.printer.boxes[0].spools;
    spools.forEach(spool => { spool.rfid = false; });
    spools[0].color = [243, 241, 230, 0, 167, 235];
    spools[0].rfid = true;
    Object.assign(spools[1], {material_type:'PLA Glow',color:[236,236,231],rfid:false});
    Object.assign(spools[2], {material_type:'PLA Marble',color:[239,240,241]});
    Object.assign(spools[3], {material_type:'PLA',color:[239,240,241]});
    delete spools[2].rfid;
    await route.fulfill({response, json:data});
  });
  await login(page);
  await page.getByRole('button', {name:'ACE et filaments',exact:true}).click();
  const spools = page.locator('#spools .ace-spool-row');
  const illustration = index => spools.nth(index).locator('.spool-illustration');
  const colors = index => illustration(index).locator('linearGradient[id^="spool-colors-"] stop');
  await expect(colors(0)).toHaveCount(4);
  await expect(colors(0).first()).toHaveAttribute('stop-color', 'rgb(243,241,230)');
  await expect(colors(0).last()).toHaveAttribute('stop-color', 'rgb(0,167,235)');
  await expect(colors(1).last()).toHaveAttribute('stop-color', 'rgb(0,174,239)');
  await expect(illustration(2).locator('path[fill="rgb(239,240,241)"]')).toHaveCount(1);
  await expect(illustration(3).locator('path[fill="rgb(239,240,241)"]')).toHaveCount(1);
  const spool = spools.first();
  await expect(spool).toContainText('RFID reconnu');
  await spool.getByRole('button', {name:'Voir',exact:true}).click();
  const dialog = page.locator('#spool-dialog');
  await expect(dialog.locator('#spool-color-read-value')).toHaveText('#F3F1E6');
  await expect(dialog.locator('#spool-material-value')).toBeVisible();
  await expect(dialog.getByRole('button', {name: 'Enregistrer la bobine'})).toBeDisabled();
  await expect(dialog.getByText('RFID reconnu. Matériau et couleur sont lus sur la bobine.')).toBeVisible();
  for (const theme of ['light','dark']) {
    await page.locator('html').evaluate((element,value)=>element.setAttribute('data-theme',value),theme);
    await expect(dialog.locator('.spool-rfid-mark')).toBeVisible();
    await page.screenshot({path:`test-results/rfid-spool-${theme}.png`,fullPage:false});
  }
  await expect(dialog.getByRole('button', {name:'Charger',exact:true})).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(4);
  await expect(dialog.getByRole('radio').first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio').nth(1)).toBeChecked();
  await expect(dialog.locator('#spool-color-value')).toHaveText('#ECECE7');
  await expect(dialog.locator('#spool-rfid-note')).toHaveText('Réglage manuel de la bobine. Matériau et couleur modifiables.');
  await expect(dialog.locator('#spool-colors-dialog')).toHaveCount(0);
  await expect(dialog.locator('#spool-catalog-color')).toHaveText('Blanc à lueur bleue');
  await dialog.getByRole('radio').nth(2).check();
  await expect(dialog.locator('#spool-catalog-color')).toHaveText('Blanc marbre');
  await expect(dialog.locator('#spool-rfid-note')).toHaveText('Statut RFID inconnu. Les champs restent modifiables.');
  await dialog.getByRole('radio').nth(3).check();
  await expect(dialog.locator('#spool-catalog-color')).toBeHidden();
});

test('les réglages équilibrent les cartes sur ordinateur et les empilent sur mobile', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  await login(page);
  await openSection(page,'settings');
  const connection = page.getByRole('region',{name:'Connexion et suivi'});
  const printer = page.getByRole('region',{name:'Imprimante',exact:true});
  const before = await connection.boundingBox();
  const after = await printer.boundingBox();
  const appearance = await page.getByRole('region',{name:'Apparence'}).boundingBox();
  expect(after.x).toBeGreaterThanOrEqual(before.x + before.width);
  expect(after.y).toBe(before.y);
  expect(appearance.x).toBe(before.x);
  expect(appearance.y).toBeGreaterThanOrEqual(before.y + before.height);
  const save = printer.getByRole('button', {name: 'Enregistrer le nom'});
  const detection = printer.getByRole('button', {name: 'Détection IA'});
  const diagnostic = connection.getByRole('link', {name: 'Télécharger le diagnostic'});
  const [desktopSave, desktopDetection, desktopDiagnostic] = await Promise.all(
    [save,detection,diagnostic].map(control=>control.boundingBox()),
  );
  expect(desktopDetection.y).toBeGreaterThan(desktopSave.y);
  expect(desktopDetection.y).toBeCloseTo(desktopDiagnostic.y);
  await page.setViewportSize({width: 390, height: 800});
  const [mobileConnection, mobilePrinter] = await Promise.all([connection.boundingBox(), printer.boundingBox()]);
  expect(mobilePrinter.x).toBe(mobileConnection.x);
  expect(mobilePrinter.y).toBeGreaterThan(mobileConnection.y + mobileConnection.height);
  expect((await detection.boundingBox()).y).toBeGreaterThan((await save.boundingBox()).y);
  expect(await connection.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('les détails de la tâche partagent trois bandes et trois axes sans défilement', async ({browser}) => {
  const baseURL = 'http://127.0.0.1:' + (process.env.UI_PORT || '8765');
  const page = await browser.newPage({baseURL, viewport:{width:1440,height:860}});
  const longFileName = '1108-1151-Support montre petit 1_plate(01)_PLA_0.2_3h21m55s '.repeat(4);
  const fullParameters = {layer_height:0.2, perimeters:3, perimeter_extrusion_width:0.42, fill_density:15, enable_support:false, brim_type:'outer_only', temperature:215, bed_temperature:55, fan_max_speed:100, filament_retract_length:0, outer_wall_speed:65, travel_speed:390};
  let activeParameters = fullParameters;
  await page.route('**/imprimante-api/status', async route => { const response = await route.fetch(); const data = await response.json(); Object.assign(data.printer,{job_name:longFileName,job_progress:100,job_current_layer:178,job_total_layers:178,job_time_remaining:0}); Object.assign(data.printer.task_details,{dimensions:[236.2,82,35.6],layers:178,estimated_time:'3h21m55s',material_grams:92.1,parameters:activeParameters}); await route.fulfill({response,json:data}); });
  await page.route('**/imprimante-api/extras/task?*', async route => { const response = await route.fetch(); const data = await response.json(); Object.assign(data,{dimensions:{length:236.2,width:82,height:35.6},layers:178,estimated_seconds:12115,material_grams:92.1,parameters:activeParameters}); await route.fulfill({response,json:data}); });
  await login(page);
  const dialog = page.locator('#past-task-dialog');
  for (const [index, [locale, labels]] of [
    ['fr', ['Hauteur de couche', 'Parois', 'Largeur de paroi']],
    ['en', ['Layer height', 'Walls', 'Wall width']],
    ['es', ['Altura de capa', 'Paredes', 'Ancho de pared']],
  ].entries()) {
    if (index) {
      await page.evaluate(locale => localStorage.setItem('cloud-page-language', locale), locale);
      await page.reload({waitUntil:'domcontentloaded'});
    }
    await expect(page.locator('#interface-language')).toHaveValue(locale);
    await openSection(page, 'overview');
    await page.locator('#task-details-open').click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.task-detail-band')).toHaveCount(3);
    await expect(dialog.locator('#past-task-data .task-detail-metric')).toHaveCount(3);
    await expect(dialog.locator('#past-task-parameters .task-detail-parameters-column')).toHaveCount(3);
    await expect(dialog.locator('#past-task-parameters .task-detail-metric')).toHaveCount(12);
    await expect.poll(() => dialog.locator('#past-task-name').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    for (const label of labels) await expect(dialog).toContainText(label);
    expect(await dialog.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth && [...el.querySelectorAll('dt,dd')].every(item => getComputedStyle(item).whiteSpace === 'nowrap'))).toBe(true);
    if (locale === 'fr') {
      await expect(dialog.locator('#past-task-name')).toHaveCSS('text-overflow','ellipsis');
      const axes = await dialog.locator('.task-detail-band').evaluateAll(bands => bands.map(band => [...band.querySelectorAll('.task-detail-metric')].map(row => { const label = row.querySelector('dt').getBoundingClientRect(); const value = row.querySelector('dd').getBoundingClientRect(); return (label.right + value.left) / 2; })));
      const parameterAxes = await dialog.locator('.task-detail-parameters-column').evaluateAll(columns => columns.map(column => [...column.querySelectorAll('.task-detail-metric')].map(row => { const label = row.querySelector('dt').getBoundingClientRect(); const value = row.querySelector('dd').getBoundingClientRect(); return (label.right + value.left) / 2; })));
      for (let column = 0; column < 3; column++) {
        const expected = axes[0][column];
        expect(Math.abs(axes[1][column] - expected)).toBeLessThan(2);
        for (const axis of parameterAxes[column]) expect(Math.abs(axis - expected)).toBeLessThan(2);
      }
      await page.setViewportSize({width:390,height:844});
      expect(await dialog.locator('.task-detail-parameter-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.setViewportSize({width:1440,height:860});
      await dialog.locator('.dialog-close').click();
      await openSection(page, 'history');
      await page.getByRole('button', {name:'Voir le détail',exact:true}).first().click();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#task-dialog-title')).toHaveText('Détails de la tâche');
      await expect(dialog.locator('.task-detail-band')).toHaveCount(3);
      await dialog.locator('.dialog-close').click();
      await openSection(page, 'overview');
    } else {
      await dialog.locator('.dialog-close').click();
    }
  }
  activeParameters = {travel_speed:390};
  await page.reload({waitUntil:'domcontentloaded'});
  await openSection(page, 'overview');
  await page.locator('#task-details-open').click();
  await expect(dialog.locator('.task-detail-parameters-column')).toHaveCount(1);
  await expect(dialog.locator('.task-detail-parameters-column')).toHaveAttribute('data-column','3');
  await expect(dialog.locator('.task-detail-parameters-column .task-detail-metric')).toHaveCount(1);
  await page.close();
});

test('les dossiers Cloud limitent le déplacement à la sélection de la page', async ({page}) => {
 const destination = 'abcdef0123456789abcd';
 const handle = '0123456789abcdef0123';
 const command = [];
 await page.route('**/imprimante-api/files/cloud?*', async (route) => {
  const url = new URL(route.request().url());
  const folder = url.searchParams.get('folder');
  await route.fulfill({json:{
   files: folder === 'root' ? [{handle, name:'Exemple.gcode', size_mb:1, printable:true}] : [],
   has_more:false, store:{used_bytes:1,total_bytes:100},
   ...(folder && {folders:[{reference:'root',path:'/'},{reference:destination,path:'/Atelier'}]}),
  }});
 });
 await page.route('**/imprimante-api/command', async (route) => {
  command.push(route.request().postDataJSON());
  await route.fulfill({json:{ok:true,message:'Fichiers déplacés dans le Cloud'}});
 });
 await login(page);
 await page.getByRole('button',{name:'Fichiers',exact:true}).click();
 await page.getByRole('button',{name:'Cloud Anycubic',exact:true}).click();
 await page.getByRole('combobox',{name:'Dossier Cloud',exact:true}).selectOption('root');
 await page.getByRole('checkbox',{name:'Sélectionner Exemple.gcode',exact:true}).check();
 await page.getByRole('combobox',{name:'Dossier de destination',exact:true}).selectOption(destination);
 await page.getByRole('button',{name:'Déplacer la sélection',exact:true}).click();
 await expect(page.locator('#confirm-text')).toContainText('/Atelier');
 expect(command).toHaveLength(0);
 await page.locator('#confirm-yes').click();
 await expect.poll(() => command.length).toBe(1);
 expect(command[0]).toMatchObject({action:'cloud-move',source:'root',destination,handles:[handle]});
 await page.setViewportSize({width:390,height:800});
 const folder=page.getByRole('combobox',{name:'Dossier Cloud',exact:true});
 await folder.selectOption(destination);
 const parent=page.getByRole('button',{name:'Dossier parent',exact:true});
 await expect(parent).toBeEnabled();
 await parent.click();
 await expect(folder).toHaveValue('root');
 await expect(page.getByRole('checkbox',{name:'Sélectionner Exemple.gcode',exact:true})).not.toBeChecked();
});

test('un préréglage de séchage remplit les champs avant toute confirmation', async ({page}) => {
 const commands = [];
 let active = false;
 await page.route('**/imprimante-api/status', async (route) => {
  const response = await route.fetch();
  const data = await response.json();
  data.printer.boxes[0].drying = {is_drying:active, target_temperature:45, total_duration:240};
  await route.fulfill({response,json:data});
 });
 await page.route('**/imprimante-api/command', async (route) => {
  const data = route.request().postDataJSON();
  commands.push(data);
  active = data.action === 'dry-start';
  await route.fulfill({json:{ok:true,message:'Réponse fictive'}});
 });
 await login(page);
 await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
 await page.locator('#go-drying').click();
 const dialog = page.locator('#dry-dialog');
 const start = dialog.locator('#dry-start');
 const temperature = dialog.locator('[name=temperature]');
 await dialog.locator('#dry-presets input').first().check();
 expect(commands).toHaveLength(0);
 await expect(page.locator('#confirm-dialog')).toBeHidden();
 const selected = Number(await temperature.inputValue());
 await temperature.fill(String(selected === 45 ? 46 : 45));
 await expect(dialog.locator('#dry-presets :checked')).toHaveCount(0);
 await temperature.fill('45');
 await dialog.locator('[name=hours]').fill('4');
 await start.click();
 await expect(page.locator('#confirm-text')).toContainText('ces paramètres');
 await page.locator('#confirm-no').click();
 expect(commands).toHaveLength(0);
 await start.click();
 await page.locator('#confirm-yes').click();
 const stop = dialog.locator('#dry-stop');
 await expect(stop).toBeVisible();
 expect(commands[0]).toMatchObject({action:'dry-start',temperature:'45',hours:'4',box:0});
 await stop.click();
 await page.locator('#confirm-yes').click();
 await expect(stop).toBeHidden();
 expect(commands[1]).toMatchObject({action:'dry-stop',box:0});
});
