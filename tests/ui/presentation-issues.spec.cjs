const {test,expect}=require('@playwright/test');
const {login,openSection}=require('./helpers.cjs');

async function useStyle(page,style){
 await page.addInitScript(value=>localStorage.setItem('cloud-page-style',value),style);
}

test('le thème minimaliste est retiré sans perdre le mode de couleurs choisi',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('cloud-page-style','minimal');localStorage.setItem('cloud-page-theme','dark')});
 await login(page);
 await expect(page.locator('html')).toHaveAttribute('data-style','standard');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.locator('#interface-style option')).toHaveCount(6);
 await expect(page.locator('#interface-style')).toHaveValue('standard');
});

test('Apple Design garde dix sections accessibles sans débordement horizontal',async({page})=>{
 await useStyle(page,'apple'); await page.setViewportSize({width:390,height:800}); await login(page);
 const tabs=page.locator('#atelier-tabs');
 await expect(page.locator('#section-menu-toggle')).toBeVisible();
 await expect(tabs).toBeHidden();
 await page.locator('#section-menu-toggle').click();
 await expect(tabs).toHaveAttribute('data-open','true');
 await expect(tabs.locator('button')).toHaveCount(10);
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
 await expect(page.locator('.statistics-grid > section')).toHaveCount(3);
 await expect(page.locator('#statistics-printer #chart-nozzle')).toBeVisible();
 await expect(page.locator('#statistics-ace #chart-ace')).toBeVisible();
 await expect(page.locator('#statistics-filament #chart-filament .temperature-card')).toHaveCount(4);
 const positions=await page.locator('.statistics-grid > section').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width}}));
 expect(positions[0].y).toBeCloseTo(positions[1].y,0); expect(positions[2].y).toBeGreaterThan(positions[0].y);
 await page.setViewportSize({width:390,height:800});
 expect(await page.locator('.statistics-grid').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('les mesures absentes gardent les cartes',async({page})=>{
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch(),data=await response.json();
  for(const key of ['curr_nozzle_temp','target_nozzle_temp','curr_hotbed_temp','target_hotbed_temp','fan_speed_pct','aux_fan_speed_pct','box_fan_level'])delete data.printer[key];
  await route.fulfill({response,json:data});
 });
 await login(page);
 const metrics=page.locator('#temperatures');
 await expect(metrics.locator('dd')).toHaveCount(5);
 await expect(metrics).toContainText('—');
});

test('l’avertissement des axes reste en bas de la carte sur ordinateur et mobile',async({page})=>{
 await login(page); await page.getByRole('button',{name:'Caméra',exact:true}).click();
 const warning=page.locator('.axis-card>.settings-help'), card=page.locator('.axis-card');
 const measure=()=>warning.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,card:el.closest('.axis-card').getBoundingClientRect()}));
 let result=await measure(); expect(Math.abs(result.bottom-result.card.bottom)).toBeLessThan(40);
 await page.setViewportSize({width:390,height:800}); result=await measure();
 expect(Math.abs(result.bottom-result.card.bottom)).toBeLessThan(40);
});

test('Apple Design aligne les cartes et garde les quatre commandes sur une rangée',async({page})=>{
 await useStyle(page,'apple'); await page.setViewportSize({width:1440,height:900}); await login(page);
 const [buttons,top,bottom]=await Promise.all([
  page.locator('#tab-overview .actions button').evaluateAll(items=>items.map(item=>({y:item.getBoundingClientRect().top,disabled:item.disabled}))),
  page.locator('#tab-overview .overview-grid').boundingBox(),
  page.locator('#tab-overview .printer-lower-grid').boundingBox(),
 ]);
 expect(new Set(buttons.map(button=>Math.round(button.y))).size).toBe(1);
 const topSplit=await page.locator('#tab-overview .overview-grid').evaluate(el=>el.children[0].getBoundingClientRect().right);
 const lowerSplit=await page.locator('#tab-overview .printer-lower-grid').evaluate(el=>el.children[0].getBoundingClientRect().right);
 expect(Math.abs(topSplit-lowerSplit)).toBeLessThan(3);
 expect(Math.abs(top.x-bottom.x)).toBeLessThan(2);
});

test('Apple Design applique fond profond, verre discret et respect des animations réduites',async({page})=>{
 await useStyle(page,'apple'); await login(page);
 // Le changement d’URL précède parfois l’application du thème et de ses styles.
 await expect(page.locator('html')).toHaveAttribute('data-style','apple');
 await expect(page.locator('body')).toHaveCSS('background-image',/radial-gradient/);
 await expect(page.locator('.atelier-tabs')).toHaveCSS('backdrop-filter',/blur/);
 await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
 const [seeButton,configureButton]=await Promise.all([
  page.getByRole('button',{name:'Voir',exact:true}).first().evaluate(el=>getComputedStyle(el).borderRadius),
  page.getByRole('button',{name:'Configurer une bobine',exact:true}).evaluate(el=>getComputedStyle(el).borderRadius),
 ]);
 expect(seeButton).toBe(configureButton);
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(page.locator('body')).toHaveCSS('background-attachment','scroll, scroll, scroll');
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
