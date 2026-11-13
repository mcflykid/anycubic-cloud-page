const {test,expect}=require('@playwright/test');
const {login,openSection}=require('./helpers.cjs');
test('déconnexion au clavier et révocation effective',async({page})=>{await login(page);const button=page.getByRole('button',{name:'Se déconnecter',exact:true});await expect(page.locator('.portal-nav').getByRole('link',{name:'Anycubic Cloud Page'})).toHaveAttribute('href','/imprimante.html');await expect(page.getByText('Atelier autonome',{exact:true})).toHaveCount(0);await button.focus();await button.press('Enter');await expect(page).toHaveURL(/\/login$/);const response=await page.request.get('/imprimante-api/status');expect(response.status()).toBe(401);});
module.exports={login};


test('un catalogue inaccessible laisse l’atelier fonctionner en français',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 const {login,openSection}=require('./helpers.cjs');
 await page.addInitScript(()=>localStorage.setItem('cloud-page-language','es'));
 const failed=[];
 await page.route('**/js/workshop-translations.json*',route=>{failed.push(route.request().url());return route.fulfill({status:404});});
 await login(page);
 await expect(page.locator('html')).toHaveAttribute('lang','fr');
 await expect(page.locator('#connection')).toHaveText('En ligne');
 await expect(page.locator('#printer-model')).toHaveText('Kobra S1 · Démonstration');
 await expect(page.getByRole('combobox',{name:'Langue de l’interface'})).toHaveValue('fr');
 expect(failed.length).toBeGreaterThanOrEqual(1);
 const bell=await page.locator('#notifications-toggle').boundingBox();
 expect(bell.width).toBe(44);
 expect(bell.height).toBe(44);
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
 await expect(password).toBeVisible();
 await expect(password.locator('#reauth-question')).toContainText('fixture-version');
 await page.keyboard.press('Escape');
 await expect(password).toBeHidden();
 await expect(update).toBeFocused();
 expect(commands).toHaveLength(0);

 await update.click();
 await password.getByLabel('Mot de passe web',{exact:true}).fill('fixture-incorrect');
 await password.getByRole('button',{name:'Installer la mise à jour',exact:true}).click();
 await expect(password.getByRole('status')).toHaveText('Mot de passe web incorrect.');
 expect(commands).toHaveLength(0);
 await password.getByLabel('Mot de passe web',{exact:true}).fill('ui-fixture-password');
 await password.getByRole('button',{name:'Installer la mise à jour',exact:true}).click();
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
 await page.locator('#settings-logs-open').click();
 await expect(page.getByRole('dialog',{name:'Journal des commandes'})).toBeVisible();
 await expect(page.locator('#journal-entries')).toContainText('Éclairage');
 await expect(page.locator('#journal-entries')).toContainText('Confirmée');
 await page.locator('#journal-filters select[name=printer]').selectOption('fixture');
 await page.locator('#journal-filters select[name=outcome]').selectOption('confirmée');
 await expect(page.getByRole('link',{name:'Exporter le journal expurgé'})).toHaveAttribute('href','/imprimante-api/journal?printer=fixture&action=&outcome=confirm%C3%A9e&export=1');
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
  await openSection(page,'settings');
  await page.locator('[data-command=firmware]').click();
  const password=page.locator('#reauth-dialog');
  await expect(password.locator('#reauth-question')).toHaveText(language.confirm);
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

test('un catalogue qui ne répond pas ne bloque pas la connexion',async({page})=>{
 let requests=0;
 await page.addInitScript(()=>localStorage.setItem('cloud-page-language','en'));
 await page.route('**/js/workshop-translations.json*',()=>{requests++;});
 await login(page);
 await expect(page.locator('#connection')).toHaveText('En ligne');
 await expect(page.locator('#interface-language')).toHaveValue('fr');
 expect(requests).toBeGreaterThanOrEqual(1);
});

test('les actualisations simultanées partagent une seule lecture et le rendu masque les données brutes', async ({page}) => {
  const {login} = require('./helpers.cjs');
  let calls = 0;
  let finish;
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.route('**/imprimante-api/status', async (route) => {
    calls++;
    await new Promise((resolve) => { finish = resolve; });
    await route.fulfill({json: {ok: true, printer: {printer_online: true}, events: 'fixture-private'}});
  });
  await login(page);
  await expect.poll(() => typeof finish).toBe('function');
  await page.evaluate(() => {
    for (let i = 0; i < 6; i++) document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(calls).toBe(1);
  finish();
  await expect.poll(() => warnings.some((text) => text.includes('Échec du rendu'))).toBe(true);
  expect(warnings.join(' ')).not.toContain('fixture-private');
});

test('l’apparence suit le système ou garde le choix explicite après rechargement', async ({page}) => {
  const {login} = require('./helpers.cjs');
  await page.emulateMedia({colorScheme: 'dark'});
  await login(page);
  await page.getByRole('button', {name: 'Réglages', exact: true}).click();
  const theme = page.getByLabel('Thème de l’interface');
  await expect(theme).toHaveValue('system');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 21, 26)');
  await theme.selectOption('light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 244, 246)');
  await page.reload();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 244, 246)');
  await page.getByRole('button', {name: 'Réglages', exact: true}).click();
  await theme.selectOption('dark');
  await page.emulateMedia({colorScheme: 'light'});
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 21, 26)');
  await theme.selectOption('system');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 244, 246)');
});

test('le style visuel se mémorise indépendamment du mode sombre', async ({page}) => {
  const {login} = require('./helpers.cjs');
  await login(page);
  const settings = page.getByRole('button', {name: 'Réglages', exact: true});
  await settings.click();
  const style = page.getByLabel('Style de l’interface');
  const theme = page.getByLabel('Thème de l’interface');
  const desktopTheme = await theme.boundingBox();
  const desktopStyle = await style.boundingBox();
  expect(desktopStyle.y).toBeCloseTo(desktopTheme.y);
  expect(desktopStyle.x).toBeGreaterThan(desktopTheme.x + desktopTheme.width);
  await page.getByRole('button', {name: 'Déconnecter', exact:true}).click();
  await expect(page.locator('#confirm-text')).toContainText('Cette action n’arrête pas l’impression.');
  await page.locator('#confirm-no').click();
  await page.setViewportSize({width:360,height:800});
  expect((await style.boundingBox()).y).toBeGreaterThan((await theme.boundingBox()).y);
  await page.setViewportSize({width:1280,height:900});
  await theme.selectOption('dark');
  for (const width of [1280, 800]) {
    await page.setViewportSize({width,height:900});
    const tabs = page.locator('#atelier-tabs');
    await expect(tabs.locator('button')).toHaveCount(10);
    expect(await tabs.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(tabs.locator('[data-tab="settings"]')).toBeVisible();
  }
  await page.setViewportSize({width:360,height:800});
  const tabs = page.locator('#atelier-tabs');
  await expect(tabs).toBeHidden();
  await page.locator('#section-menu-toggle').click();
  await expect(tabs).toHaveAttribute('data-open','true');
  await expect(tabs.locator('button')).toHaveCount(10);
  expect(await tabs.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(tabs.locator('[data-tab="settings"]')).toBeVisible();
  await page.setViewportSize({width:1280,height:900});
  await settings.click();
  await style.selectOption({label: 'Aurore'});
  await expect(page.locator('html')).toHaveAttribute('data-style', 'aurora');
  await page.reload();
  await settings.click();
  await expect(style).toHaveValue('aurora');
  await expect(theme).toHaveValue('dark');
  await style.selectOption({label: 'Par défaut'});
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 21, 26)');
});

test('une suppression nomme son effet et place le focus sur Annuler', async ({page}) => {
 await login(page, 'files');
 const remove = page.locator('#file-rows').getByRole('button', {name: 'Supprimer', exact: true}).first();
 await remove.click();
 const dialog = page.locator('#confirm-dialog');
 await expect(dialog.getByRole('button', {name: 'Supprimer', exact: true})).toBeVisible();
 await expect(dialog.getByRole('button', {name: 'Annuler', exact: true})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(dialog).toBeHidden();
 await expect(remove).toBeFocused();
});

test('la réinitialisation affiche le temps restant et bloque un code expiré', async ({page}) => {
 await page.setViewportSize({width: 390, height: 800});
 await page.addInitScript(() => localStorage.setItem('cloud-page-theme', 'dark'));
 await page.route('**/imprimante-api/extras/device', async route => {
  const response = await route.fetch();
  const json = await response.json();
  await route.fulfill({response, json: {...json, factory_reset: true}});
 });
 await page.route('**/imprimante-api/reset/challenge', route =>
  route.fulfill({json: {ticket: 'fixture-ticket', code: '012345', expires_in: 120}}));
 const actions = [];
 await page.route('**/imprimante-api/{reauth,command}', async route => {
  actions.push(route.request().postDataJSON().action);
  await route.fulfill({json: {}});
 });
 await page.clock.install();
 await login(page, 'settings');
 const trigger = page.locator('#reset-open');
 await trigger.click();
 const dialog = page.locator('#reset-dialog');
 await dialog.locator('#reset-understood').check();
 await dialog.locator('#reset-get-code').click();
 await expect(dialog.locator('#reset-countdown')).toHaveText('2:00');
 const submit = dialog.getByRole('button', {name: 'Confirmer la réinitialisation'});
 await expect(submit).toBeDisabled();
 await dialog.getByLabel('Code de confirmation').fill('012345');
 await dialog.getByLabel('Mot de passe web').fill('ui-fixture-password');
 await expect(submit).toBeEnabled();
 await page.clock.fastForward(121000);
 await expect(submit).toBeDisabled();
 await expect(dialog.locator('#reset-state')).toHaveText('Code expiré. Demandez un nouveau code.');
 await page.keyboard.press('Escape');
 await expect(dialog).toBeHidden();
 await expect(trigger).toBeFocused();
 expect(actions).toEqual([]);
});

test('la réinitialisation garde le refus du mot de passe dans la même fenêtre', async ({page}) => {
 await page.route('**/imprimante-api/extras/device', async route => {
  const response = await route.fetch();
  await route.fulfill({response, json: {...await response.json(), factory_reset: true}});
 });
 await page.route('**/imprimante-api/reset/challenge', route =>
  route.fulfill({json: {ticket: 'fixture-ticket', code: '012345', expires_in: 120}}));
 const commands = [];
 await page.route('**/imprimante-api/command', route => {
  commands.push(route.request().postDataJSON());
  return route.fulfill({json: {ok: true, message: 'Commande fictive'}});
 });
 await login(page, 'settings');
 await page.locator('#reset-open').click();
 const dialog = page.locator('#reset-dialog');
 await dialog.locator('#reset-understood').check();
 await dialog.locator('#reset-get-code').click();
 await dialog.getByLabel('Code de confirmation').fill('012345');
 const password = dialog.getByLabel('Mot de passe web');
 const submit = dialog.locator('#reset-submit');
 await password.fill('fixture-incorrect');
 await submit.click();
 await expect(dialog.locator('#reset-password-state')).toHaveText('Mot de passe web incorrect.');
 await expect(page.locator('#reauth-dialog')).toBeHidden();
 await expect(password).toBeFocused();
 expect(commands).toHaveLength(0);
 await password.fill('ui-fixture-password');
 await submit.click();
 await expect(dialog).toBeHidden();
 expect(commands).toHaveLength(1);
 expect(commands[0]).toMatchObject({action: 'factory-reset', ticket: 'fixture-ticket', code: '012345'});
 expect(commands[0].confirmation).toMatch(/^[A-Za-z0-9_-]{43}$/);
 expect(commands[0]).not.toHaveProperty('password');
});
