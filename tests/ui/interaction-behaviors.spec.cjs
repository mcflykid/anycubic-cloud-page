const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('la connexion affiche le mot de passe et attend le vrai retour serveur',async({page})=>{
 await page.goto('/login');
 await page.getByLabel('Identifiant',{exact:true}).fill('admin');
 await page.getByLabel('Mot de passe',{exact:true}).fill('ui-fixture-password');
 await page.getByRole('button',{name:'Afficher',exact:true}).click();
 await expect(page.locator('#password')).toHaveAttribute('type','text');
 await page.getByRole('button',{name:'Masquer',exact:true}).click();
 await expect(page.locator('#password')).toHaveAttribute('type','password');
 let release;
 const gate=new Promise(r=>release=r);
 await page.route('**/login',async route=>{if(route.request().method()==='POST')await gate;await route.continue();});
 await page.getByRole('button',{name:'Se connecter',exact:true}).click({noWaitAfter:true});
 expect(await page.evaluate(()=>document.querySelector('.login-card form').getAttribute('aria-busy'))).toBe('true');
 expect(await page.evaluate(()=>document.querySelector('#login-status').textContent)).toContain('Vérification');
 release();
 await expect(page).toHaveURL(/imprimante\.html$/);
});

test('la connexion refusée annonce une erreur et reste utilisable',async({page})=>{
 await page.goto('/login');
 await page.getByLabel('Identifiant',{exact:true}).fill('admin');
 await page.getByLabel('Mot de passe',{exact:true}).fill('incorrect-fixture');
 await page.getByRole('button',{name:'Se connecter',exact:true}).click();
 await expect(page.locator('.login-error')).toHaveAttribute('role','alert');
 await expect(page.getByRole('button',{name:'Se connecter',exact:true})).toBeEnabled();
});

test('le glissement peint une plage sans ordre et Maj+clic la complète',async({page})=>{
 let commands=0;
 await page.route('**/imprimante-api/command',route=>{commands++;return route.fulfill({json:{ok:true}});});
 await page.route('**/imprimante-api/files/cloud?**',route=>route.fulfill({json:{files:Array.from({length:5},(_,i)=>({name:`Pièce-${i}.gcode`,handle:`fixture-${i}`,size_mb:i+1})),has_more:false}}));
 await login(page);
 await page.locator('[data-tab=files]').click();
 await page.locator('[data-source=cloud]').click();
 const checks=page.locator('#file-rows input[type=checkbox]');
 await expect(checks).toHaveCount(5);
 await checks.nth(0).hover();
 await page.mouse.down();
 await expect(checks.nth(0)).toBeChecked();
 // La première sélection révèle la barre groupée. La cible se mesure après ce changement.
 await checks.nth(2).hover();
 await page.mouse.up();
 await expect(page.locator('#file-rows .file-selected')).toHaveCount(3);
 await expect(page.locator('#cloud-selected-count')).toHaveText('3 sélections');
 await expect(page.locator('#cloud-selection-digits .selection-digit-strip')).toHaveCSS('--d','3');
 await expect(checks.nth(2).locator('xpath=ancestor::tr')).toHaveCSS('--selection-wave-delay','46ms');
 await checks.nth(4).click({modifiers:['Shift']});
 await expect(page.locator('#cloud-selected-count')).toHaveText('5 sélections');
 expect(commands).toBe(0);
 await page.locator('#cloud-clear-selection').click();
 await checks.nth(0).focus();await page.keyboard.press('Space');
 await expect(checks.nth(0)).toBeChecked();
 await page.locator('#files-search').fill('Pièce-4');
 await expect(page.locator('#cloud-selected-count')).toHaveText('0 sélection');
});

test('la palette filtre les sections et ne prend pas le raccourci dans un champ',async({page})=>{
 await login(page);
 await page.keyboard.press('Control+k');
 const search=page.getByRole('combobox',{name:'Rechercher une section'});
 await search.fill('camera');
 await expect(page.locator('.quick-results button')).toHaveCount(1);
 await page.keyboard.press('Enter');
 await expect(page.locator('#tab-camera')).toBeVisible();
 await page.locator('[data-tab=files]').click();
 await page.locator('#files-search').focus();
 await page.keyboard.press('Control+k');
 await expect(page.locator('.quick-palette')).not.toBeVisible();
});

test('la recherche rapide ouvre un réglage sans émettre de commande', async ({page}) => {
 let commands = 0;
 await page.route('**/imprimante-api/command', route => {
  commands++;
  return route.abort();
 });
 await login(page);
 await page.getByRole('button',{name:'Accès rapide'}).click();
 const search = page.getByRole('combobox',{name:'Rechercher une section'});
 await search.fill('detection ia');
 await page.keyboard.press('Enter');
 await expect(page.locator('#ai-dialog')).toBeVisible();
 expect(commands).toBe(0);
});

test('la sélection tactile ne lance aucune action et laisse défiler hors gouttière',async({browser})=>{
 const context=await browser.newContext({baseURL:'http://127.0.0.1:'+(process.env.UI_PORT||'8765'),hasTouch:true,viewport:{width:1280,height:900}});
 const page=await context.newPage();
 await page.route('**/imprimante-api/files/cloud?**',route=>route.fulfill({json:{files:Array.from({length:4},(_,i)=>({name:`Tactile-${i}.gcode`,handle:`touch-${i}`,size_mb:1})),has_more:false}}));
 try {
  await login(page);await page.locator('[data-tab=files]').click();await page.locator('[data-source=cloud]').click();
  const inputs=page.locator('#file-rows input[data-selection]');await expect(inputs).toHaveCount(4);
  await inputs.nth(2).scrollIntoViewIfNeeded();
  const a=await inputs.nth(0).boundingBox(),b=await inputs.nth(2).boundingBox();
  const session=await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('#cloud-selected-count')).toHaveText('3 sélections');
  await expect(page.locator('#cloud-selected-size')).toContainText('3');
  expect(await page.locator('.file-selection-gutter').first().evaluate(el=>getComputedStyle(el).touchAction)).toBe('none');
  expect(await page.locator('.file-row-identity').first().evaluate(el=>getComputedStyle(el).touchAction)).not.toBe('none');
 } finally {await context.close();}
});

/** Une limitation fournisseur ne doit pas déclencher la reprise prévue pour une panne temporaire du proxy. */
test('Retry-After interdit la reprise de lecture',async({page})=>{
 let limited=0;
 await page.route('**/imprimante-api/fixture-limited',route=>{limited++;return route.fulfill({status:503,headers:{'Retry-After':'120'},json:{ok:false,message:'Limitation temporaire'}});});
 await login(page);
 const messages=await page.evaluate(async()=>{
  const {createRequest}=await import('/imprimante-api/ui/js/workshop-api.mjs');
  const request=createRequest(()=>'demo-printer'),errors=[];
  try{await request('/fixture-limited');}catch(error){errors.push(error.message);}
  return errors;
 });
 expect(limited).toBe(1);expect(messages).toHaveLength(1);
});

test('la recherche occupe la barre des fichiers Cloud et les dossiers locaux gardent leurs commandes',async({page})=>{
  await page.setViewportSize({width:1366,height:768});
  await login(page);
  await page.locator('[data-tab=files]').click();
  const form=page.locator('#files-form');
  await page.locator('[data-source=cloud]').click();
  await expect(page.locator('#file-path-label')).toBeHidden();
  await expect(page.locator('#cloud-folder-label')).toBeVisible();
  const search=await page.locator('#files-search').boundingBox();
  const refresh=await form.locator('button[type=submit]').boundingBox();
  const sort=await form.locator('#files-sort').boundingBox();
  expect(search.width).toBeGreaterThan(refresh.width);
  expect(search.x).toBeGreaterThan(refresh.x);
  expect(sort.x).toBeGreaterThan(search.x);
  await page.locator('[data-source=local]').click();
  await expect(page.locator('#file-path-label')).toBeVisible();
});
