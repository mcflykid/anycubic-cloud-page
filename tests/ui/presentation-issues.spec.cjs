const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

async function useStyle(page,style){
 await page.addInitScript(value=>localStorage.setItem('cloud-page-style',value),style);
}

test('le thème minimaliste est retiré sans perdre le mode de couleurs choisi',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('cloud-page-style','minimal');localStorage.setItem('cloud-page-theme','dark')});
 await login(page);
 await expect(page.locator('html')).toHaveAttribute('data-style','standard');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.locator('#interface-style option')).toHaveCount(3);
 await expect(page.locator('#interface-style')).toHaveValue('standard');
});

test('Le menu mobile garde dix sections accessibles sans débordement horizontal',async({page})=>{
 await page.setViewportSize({width:390,height:800}); await login(page, 'summary');
 const tabs=page.locator('#atelier-tabs');
 await expect(page.locator('#section-menu-toggle')).toBeVisible();
 await expect(tabs).toBeHidden();
 await page.locator('#section-menu-toggle').click();
 await expect(tabs).toHaveAttribute('data-open','true');
 await expect(tabs.locator('button:not([hidden])')).toHaveCount(10);
 await expect(tabs.getByRole('button')).toHaveCount(10);
 expect(await tabs.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 const settings=tabs.locator('[data-tab="settings"]');
 await settings.focus();
 await expect(settings).toBeFocused();
 await expect(settings).toBeInViewport();
});

test('les statistiques regroupent température, ACE et filaments en trois zones adaptatives',async({page})=>{
 await login(page); await page.getByRole('button',{name:'Statistiques',exact:true}).click();
 await expect(page.locator('.atelier-statistics-grid > section')).toHaveCount(3);
 await expect(page.locator('#statistics-printer #chart-nozzle')).toBeVisible();
 await expect(page.locator('#statistics-ace #chart-ace')).toBeVisible();
 await expect(page.locator('#statistics-filament #chart-filament .temperature-card')).toHaveCount(4);
 const positions=await page.locator('.atelier-statistics-grid > section').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width}}));
 expect(positions[0].y).toBeCloseTo(positions[1].y,0); expect(positions[2].y).toBeGreaterThan(positions[0].y);
 await page.setViewportSize({width:390,height:800});
 expect(await page.locator('.atelier-statistics-grid').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('les mesures absentes gardent les cartes',async({page})=>{
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch(),data=await response.json();
  for(const key of ['curr_nozzle_temp','target_nozzle_temp','curr_hotbed_temp','target_hotbed_temp','fan_speed_pct','aux_fan_speed_pct','box_fan_level'])delete data.printer[key];
  await route.fulfill({response,json:data});
 });
 await login(page);
 const metrics=page.locator('#temperatures');
 await expect(metrics.locator('td')).toHaveCount(4);
 await expect(metrics).toContainText('—');
});

test('l’avertissement des axes reste en bas de la carte sur ordinateur et mobile',async({page})=>{
 await login(page); await page.getByRole('button',{name:'Caméra',exact:true}).click();
 const warning=page.locator('.camera-warning > .settings-help'), card=page.locator('.camera-command-card');
 const measure=()=>warning.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,card:el.closest('.camera-command-card').getBoundingClientRect()}));
 let result=await measure(); expect(Math.abs(result.bottom-result.card.bottom)).toBeLessThan(40);
 await page.setViewportSize({width:390,height:800}); result=await measure();
 expect(Math.abs(result.bottom-result.card.bottom)).toBeLessThan(40);
});

test('une fermeture externe de confirmation annule une seule fois',async({page})=>{
 await login(page);
 await page.evaluate(async()=>{
  const {confirmAction}=await import(new URL('/imprimante-api/ui/js/workshop-ui.mjs',location.href));
  const result=confirmAction('Confirmation de démonstration');
  document.querySelector('#confirm-dialog').close();
  window.confirmOutcome=await result;
 });
 await expect.poll(()=>page.evaluate(()=>window.confirmOutcome)).toBe(false);
});

test('Aurore conserve la navigation commune et son onglet actif sur mobile',async({page})=>{
 await useStyle(page,'aurora');
 await page.setViewportSize({width:1366,height:768});
 await login(page,'settings');
 const nav=page.locator('#atelier-tabs');
 const active=nav.locator('[aria-current=page]');
 await expect(active).toHaveText('Réglages');
 await expect(active).toHaveCSS('border-radius','0px');
 await expect(nav.locator('.atelier-navigation-marker')).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await page.locator('#section-menu-toggle').click();
 await expect(active).toBeVisible();
 await expect(active).toHaveCSS('box-shadow',/inset/);
 await expect(nav.locator('.atelier-navigation-marker')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

for (const width of [1920, 390]) {
 for (const theme of ['light', 'dark']) {
  test(`les cartes d’envoi sont centrées (${width}px, ${theme})`, async ({page}) => {
   await page.setViewportSize({width, height: 900});
   await page.addInitScript(value => localStorage.setItem('cloud-page-theme', value), theme);
   await login(page, 'upload');
   await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
   const {panel, file, send} = await page.locator('#tab-upload').evaluate(element => ({
    panel: element.getBoundingClientRect().toJSON(),
    file: element.querySelector('.atelier-card:first-child').getBoundingClientRect().toJSON(),
    send: element.querySelector('.atelier-card:last-child').getBoundingClientRect().toJSON(),
   }));
   const left = file.left - panel.left;
   const right = panel.right - send.right;
   expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
   expect(left).toBeGreaterThanOrEqual(0);
   if (width === 390) {
    expect(send.top).toBeGreaterThanOrEqual(file.bottom);
    expect(send.left).toBeCloseTo(file.left, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   } else {
    expect(send.top).toBeCloseTo(file.top, 0);
    expect(send.left).toBeGreaterThan(file.right);
   }
  });

  test(`l’aide de la mémoire est centrée et accessible (${width}px, ${theme})`, async ({page}) => {
   await page.setViewportSize({width, height: 900});
   await page.addInitScript(value => localStorage.setItem('cloud-page-theme', value), theme);
   await login(page, 'files');
   await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
   const heading = page.locator('.files-card > .atelier-card-header');
   const help = heading.locator('[data-context-help="files"]');
   await expect(heading.getByRole('heading', {name: 'Mémoire imprimante'})).toBeVisible();
   await expect(heading.locator('#files-state')).toBeVisible();
   const headerBox = await heading.boundingBox();
   const helpBox = await help.boundingBox();
   expect(Math.abs(helpBox.x + helpBox.width / 2 - headerBox.x - headerBox.width / 2)).toBeLessThanOrEqual(1);
   await help.click();
   await expect(page.getByRole('dialog', {name: 'Formats de fichiers'})).toBeVisible();
  });
 }
}
