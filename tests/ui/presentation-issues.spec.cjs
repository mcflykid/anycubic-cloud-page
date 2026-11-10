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
 await expect(page.locator('#interface-style option')).toHaveCount(20);
 await expect(page.locator('#interface-style')).toHaveValue('standard');
});

test('Apple Design conserve les neuf onglets sur une rangée défilable au clavier',async({page})=>{
 await useStyle(page,'apple'); await page.setViewportSize({width:390,height:800}); await login(page);
 const tabs=page.locator('.atelier-tabs');
 await expect(tabs.locator('button')).toHaveCount(9);
 expect(await tabs.locator('button').evaluateAll(buttons=>new Set(buttons.map(button=>Math.round(button.getBoundingClientRect().top))).size)).toBe(1);
 expect(await tabs.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
 await page.getByRole('button',{name:'Réglages',exact:true}).focus();
 await expect(page.getByRole('button',{name:'Réglages',exact:true})).toBeInViewport();
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

test('le thème détaillé place les mesures en trois rangées et centre les commandes',async({page})=>{
 await useStyle(page,'detailed'); await login(page);
 const metrics=page.locator('#temperatures');
 await expect(metrics.locator('div')).toHaveCount(5);
 await expect(metrics.locator('dd').first()).not.toHaveText('—');
 const tops=await metrics.locator('div').evaluateAll(items=>items.map(item=>Math.round(item.getBoundingClientRect().top)));
 expect(new Set(tops).size).toBe(3);
 const button=await page.locator('#controls-open').boundingBox(), card=await metrics.locator('..').boundingBox();
 expect(Math.abs(button.x+button.width/2-card.x-card.width/2)).toBeLessThan(2);
 const speedCards=await page.locator('#details>div').evaluateAll(items=>Object.fromEntries(items.map(item=>[item.querySelector('dt').textContent,{x:item.getBoundingClientRect().x,y:item.getBoundingClientRect().y,width:item.getBoundingClientRect().width}])));
 if(speedCards['Mode de vitesse']&&speedCards.Vitesse){
  expect(Math.abs(speedCards['Mode de vitesse'].y-speedCards.Vitesse.y)).toBeLessThan(2);
  expect(speedCards.Vitesse.x).toBeGreaterThan(speedCards['Mode de vitesse'].x);
  expect(Math.abs(speedCards.Vitesse.width-speedCards['Mode de vitesse'].width)).toBeLessThan(2);
 }
});

test('les mesures absentes gardent les cartes et leur disposition détaillée',async({page})=>{
 await useStyle(page,'detailed');
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch(),data=await response.json();
  for(const key of ['curr_nozzle_temp','target_nozzle_temp','curr_hotbed_temp','target_hotbed_temp','fan_speed_pct','aux_fan_speed_pct','box_fan_level'])delete data.printer[key];
  await route.fulfill({response,json:data});
 });
 await login(page);
 const metrics=page.locator('#temperatures');
 await expect(metrics.locator('dd')).toHaveCount(5);
 await expect(metrics).toContainText('—');
 const rows=await metrics.locator('div').evaluateAll(items=>new Set(items.map(item=>Math.round(item.getBoundingClientRect().top))).size);
 expect(rows).toBe(3);
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
 const bg=await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundImage);
 expect(bg).toContain('radial-gradient');
 const glass=await page.locator('.atelier-tabs').evaluate(el=>({blur:getComputedStyle(el).backdropFilter,bg:getComputedStyle(el).backgroundColor}));
 expect(glass.blur).toContain('blur');
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
