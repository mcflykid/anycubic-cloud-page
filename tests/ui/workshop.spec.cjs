const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
test('déconnexion au clavier et révocation effective',async({page})=>{await login(page);const button=page.getByRole('button',{name:'Se déconnecter',exact:true});await expect(page.locator('.portal-nav').getByRole('link',{name:'Anycubic Cloud Page'})).toHaveAttribute('href','/imprimante.html');await expect(page.getByText('Atelier autonome',{exact:true})).toHaveCount(0);await button.focus();await button.press('Enter');await expect(page).toHaveURL(/\/login$/);const response=await page.request.get('/imprimante-api/status');expect(response.status()).toBe(401);});
module.exports={login};


test('la page française démarre avec une barre compacte sans ressource de traduction',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 const {login}=require('./helpers.cjs');
 const languageRequests=[];
 page.on('request',request=>{if(request.url().includes('/js/ui-language.js'))languageRequests.push(request);});
 await login(page);
 await expect(page.locator('#connection')).toHaveText('En ligne');
 await expect(page.locator('#printer-model')).toHaveText('Anycubic Kobra S1');
 await expect(page.locator('#interface-language')).toHaveCount(0);
 expect(languageRequests).toHaveLength(0);
 const bell=await page.locator('#notifications-toggle').boundingBox();
 expect(bell.width).toBe(44);
 expect(bell.height).toBeGreaterThanOrEqual(44);
 expect(await page.locator('.portal-nav').evaluate(nav=>nav.scrollWidth<=nav.clientWidth)).toBe(true);
});

test('une mise à jour demande le mot de passe web avant toute commande',async({page})=>{
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch();
  const data=await response.json();
  data.printer.firmware_update_available=true;
  data.printer.firmware_available='fixture-version';
  await route.fulfill({response,json:data});
 });
 const commands=[];
 await page.route('**/imprimante-api/command',route=>{
  commands.push(route.request().postDataJSON());
  return route.fulfill({json:{ok:true,message:'Commande fictive'}});
 });
 await login(page);
 await page.getByRole('button',{name:'Réglages',exact:true}).click();
 const update=page.locator('[data-command=firmware]');
 const password=page.locator('#reauth-dialog');
 await update.click();
 await page.locator('#confirm-yes').click();
 await expect(password).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(password).toBeHidden();
 expect(commands).toHaveLength(0);

 await update.click();
 await page.locator('#confirm-yes').click();
 await password.getByLabel('Mot de passe web',{exact:true}).fill('fixture-incorrect');
 await password.getByRole('button',{name:'Confirmer',exact:true}).click();
 await expect(password.getByRole('status')).toHaveText('Mot de passe web incorrect.');
 expect(commands).toHaveLength(0);
 await password.getByLabel('Mot de passe web',{exact:true}).fill('ui-fixture-password');
 await password.getByRole('button',{name:'Confirmer',exact:true}).click();
 await expect.poll(()=>commands.length).toBe(1);
 expect(commands[0].action).toBe('firmware');
 expect(commands[0].confirmation).toMatch(/^[A-Za-z0-9_-]{43}$/);
 expect(commands[0]).not.toHaveProperty('password');
});

test('le journal en lecture seule applique les filtres à l’export',async({page})=>{
 await page.route('**/imprimante-api/journal?**',route=>route.fulfill({json:{
  items:[{action:'light',outcome:'confirmée',time:Date.now()/1000,printer_name:'Imprimante fictive',parameters:{enabled:true}}],
  printers:{fixture:'Imprimante fictive'},actions:['light']
 }}));
 await login(page);
 await page.getByRole('button',{name:'Réglages',exact:true}).click();
 await page.getByText('Journal des commandes',{exact:true}).click();
 await expect(page.locator('#journal-entries')).toContainText('light · confirmée');
 await page.locator('#journal-filters select[name=printer]').selectOption('fixture');
 await expect(page.getByRole('link',{name:'Exporter le journal expurgé'})).toHaveAttribute('href','/imprimante-api/journal?printer=fixture&action=&export=1');
});
