const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('les six styles d’interaction ont leur effet propre et le mouvement réduit le neutralise',async({page})=>{
 await login(page);
 const cases=[
  ['anchor','button[data-tab="overview"][aria-current]',''],
  ['cards','.printer-lower-grid>section',''],
  ['drum','button[data-tab="overview"][aria-current]',''],
  ['outline','button[data-tab="overview"][aria-current]',''],
  ['tiles','.statistics-panel',''],
 ];
 for(const [style,selector] of cases){
  await page.locator('html').evaluate((el,value)=>el.setAttribute('data-style',value),style);
  const element=page.locator(selector).first();
  const name=await element.evaluate((el,style)=>getComputedStyle(el,style==='outline'?'::after':null).animationName,style);
  const expected={anchor:'anchor-pop',cards:'card-deal',drum:'drum-roll',outline:'outline-trace',tiles:'tile-build'}[style];
  expect(name,style).toContain(expected);
 }
 await page.locator('html').evaluate(el=>el.setAttribute('data-style','turnover'));
 const card=page.locator('.printer-lower-grid>section').first(); await card.hover();
 await expect.poll(()=>card.evaluate(el=>getComputedStyle(el).animationName)).toContain('turnover');
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const style of ['anchor','turnover','cards','drum','outline','tiles']){
  await page.locator('html').evaluate((el,value)=>el.setAttribute('data-style',value),style);
  const name=await page.locator('.atelier-tabs button[aria-current]').evaluate(el=>getComputedStyle(el).animationName);
  expect(name,style).toBe('none');
 }
});

test('Tile Build recompose le tableau bento sans débordement sur mobile, tablette et bureau',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('cloud-page-style','tiles'));
 await login(page);
 const overview=page.locator('#tab-overview');
 for(const [width,height] of [[390,844],[820,1024],[1440,900]]){
  await page.setViewportSize({width,height});
  const layout=await overview.evaluate(el=>{
   const positions=Object.fromEntries(['.overview-content','.product','.printer-lower-grid>section:first-child','.printer-lower-grid>section:last-child'].map(selector=>{
    const rect=el.querySelector(selector).getBoundingClientRect();return [selector,{x:rect.x,y:rect.y,width:rect.width,height:rect.height}];
   }));
   return {overflow:el.scrollWidth>el.clientWidth,positions};
  });
  expect(layout.overflow,`${width}px overflow`).toBe(false);
  expect(layout.positions['.overview-content'].width).toBeGreaterThan(0);
  expect(layout.positions['.printer-lower-grid>section:first-child'].height).toBeGreaterThan(0);
  if(width===1440) expect(layout.positions['.product'].width).toBeGreaterThan(layout.positions['.overview-content'].width*.35);
 }
 await page.getByRole('button',{name:'Statistiques',exact:true}).click();
 await expect(page.locator('.statistics-grid>section')).toHaveCount(3);
});

test('Blueprint et Terminal réservent une vraie colonne de navigation de chaque côté',async({page})=>{
 await login(page);
 for(const [style,side] of [['blueprint','left'],['terminal','right']]){
  await page.locator('html').evaluate((el,value)=>el.setAttribute('data-style',value),style);
  const nav=await page.locator('.atelier-tabs').boundingBox(),main=await page.locator('#atelier').boundingBox();
  expect(nav.width).toBeGreaterThan(150); expect(nav.height).toBeGreaterThan(main.height*.35);
  if(side==='left') expect(nav.x+nav.width).toBeLessThan(main.x+20);
  else expect(nav.x).toBeGreaterThan(main.x+main.width*.7);
 }
 await page.setViewportSize({width:390,height:844});
 for(const style of ['blueprint','terminal']){
  await page.locator('html').evaluate((el,value)=>el.setAttribute('data-style',value),style);
  const nav=page.locator('.atelier-tabs');
  await expect(nav.locator('button')).toHaveCount(8);
  expect(await nav.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
 }
});

test('Aurora garde le nom accessible des icônes et Anchor centre son dock sans recouvrir le bas',async({page})=>{
 await login(page); await page.setViewportSize({width:1440,height:900});
 await page.locator('html').evaluate(el=>el.setAttribute('data-style','aurora'));
 const nav=page.locator('.atelier-tabs'),main=page.locator('#atelier');
 expect((await nav.boundingBox()).x+(await nav.boundingBox()).width).toBeLessThan((await main.boundingBox()).x+20);
 await expect(page.getByRole('button',{name:'Réglages',exact:true})).toBeAttached();
 await page.getByRole('button',{name:'Réglages',exact:true}).focus();
 await expect(page.locator('.atelier-tabs button[data-tab="settings"] span')).toBeVisible();
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('html').evaluate(el=>el.setAttribute('data-style','anchor'));
 const dock=page.locator('.atelier-tabs'),dockBox=await dock.boundingBox();
 expect(dockBox.y+dockBox.height).toBeLessThanOrEqual(900-16);
 expect(await dock.evaluate(el=>getComputedStyle(el).transform)).not.toBe('none');
 const reserve=await page.locator('.printer-shell').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom));
 expect(reserve).toBeGreaterThanOrEqual(100);
 await page.setViewportSize({width:390,height:844});
 expect(await dock.evaluate(el=>getComputedStyle(el).position)).toBe('static');
 expect(await dock.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
});
