const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
test('déconnexion au clavier et révocation effective',async({page})=>{await login(page);const button=page.getByRole('button',{name:'Se déconnecter',exact:true});await expect(page.locator('.portal-nav').getByRole('link',{name:'Anycubic Cloud Page'})).toHaveAttribute('href','/imprimante.html');await expect(page.getByText('Atelier autonome',{exact:true})).toHaveCount(0);await button.focus();await button.press('Enter');await expect(page).toHaveURL(/\/login$/);const response=await page.request.get('/imprimante-api/status');expect(response.status()).toBe(401);});
module.exports={login};


test('un catalogue inaccessible laisse l’atelier fonctionner en français',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 const {login}=require('./helpers.cjs');
 await page.addInitScript(()=>localStorage.setItem('cloud-page-language','es'));
 const failed=[];
 await page.route('**/js/workshop-translations.json*',route=>{failed.push(route.request().url());return route.fulfill({status:404});});
 await login(page);
 await expect(page.locator('html')).toHaveAttribute('lang','fr');
 await expect(page.locator('#connection')).toHaveText('En ligne');
 await expect(page.locator('#printer-model')).toHaveText('Anycubic Kobra S1');
 await expect(page.getByRole('combobox',{name:'Langue de l’interface'})).toHaveValue('fr');
 expect(failed.length).toBeGreaterThanOrEqual(1);
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

test('le choix mémorisé traduit l’atelier, ses confirmations et la connexion',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch(),data=await response.json();
  Object.assign(data.printer,{firmware_update_available:true,firmware_available:'fixture-version',curr_nozzle_temp:20.5});
  await route.fulfill({response,json:data});
 });
 const physical=[];
 await page.route('**/imprimante-api/command',route=>{
  physical.push(route.request().postDataJSON());
  return route.fulfill({json:{ok:true,message:'Commande fictive'}});
 });
 await login(page);
 const choice=page.locator('#interface-language');
 await expect(choice).toHaveValue('fr');
 for(const language of [
  {code:'en',label:'Interface language',online:'Online',settings:'Settings',temperature:'20.5',confirm:'Install version fixture-version on the printer? Keep it powered during the update.',cancel:'Cancel',incorrect:'Incorrect web password.'},
  {code:'es',label:'Idioma de la interfaz',online:'En línea',settings:'Ajustes',temperature:'20,5',confirm:'¿Instalar la versión fixture-version en la impresora? No la apagues durante la actualización.',cancel:'Cancelar',incorrect:'Contraseña web incorrecta.'},
 ]){
  await choice.selectOption(language.code);
  await expect(page.locator('html')).toHaveAttribute('lang',language.code);
  await expect(page.getByRole('combobox',{name:language.label})).toHaveValue(language.code);
  await expect(page.locator('#connection')).toHaveText(language.online);
  await expect(page.locator('#temperatures')).toContainText(language.temperature);
  expect(await page.locator('.portal-nav').evaluate(nav=>nav.scrollWidth<=nav.clientWidth)).toBe(true);
  await page.getByRole('button',{name:language.settings,exact:true}).click();
  await page.locator('[data-command=firmware]').click();
  await expect(page.locator('#confirm-text')).toHaveText(language.confirm);
  await page.locator('#confirm-yes').click();
  const password=page.locator('#reauth-dialog');
  await password.locator('input[type=password]').fill('fixture-incorrect');
  await password.locator('#reauth-submit').click();
  await expect(password.getByRole('status')).toHaveText(language.incorrect);
  await password.getByRole('button',{name:language.cancel,exact:true}).click();
 }
 expect(physical).toHaveLength(0);
 await page.reload();
 await expect(choice).toHaveValue('es');
 await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
 await expect(page.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('lang','es');
});

test('une ancienne préférence inconnue ne déclenche aucun chargement de traduction',async({page})=>{
 const catalogues=[];
 page.on('request',request=>{if(request.url().includes('workshop-translations.json'))catalogues.push(request);});
 await page.addInitScript(()=>localStorage.setItem('cloud-page-language','zz'));
 await login(page);
 await expect(page.locator('#connection')).toHaveText('En ligne');
 await expect(page.getByRole('combobox',{name:'Langue de l’interface'})).toHaveValue('fr');
 expect(catalogues).toHaveLength(0);
});
