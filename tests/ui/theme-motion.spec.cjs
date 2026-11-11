const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
async function openSettings(page){
  const settings=page.locator('[data-tab=settings]');
  if(await settings.getAttribute('aria-current')==='page')return;
  if(!(await settings.isVisible())){
    await page.getByRole('button',{name:'Sections'}).click();
    await expect(page.locator('#atelier-tabs')).toHaveAttribute('data-open','true');
    await expect(settings).toBeVisible();
  }
  await settings.click();
}
async function openSection(page,name){
  const target=page.locator(`[data-tab=${name}]`);
  if(!(await target.isVisible())){
    await page.getByRole('button',{name:'Sections'}).click();
    await expect(page.locator('#atelier-tabs')).toHaveAttribute('data-open','true');
    await expect(target).toBeVisible();
  }
  await target.click();
}

test('les quatre styles gardent la composition commune en clair, sombre et sur mobile',async({page})=>{
  await login(page);
  await openSettings(page);
  const themes=['standard', 'aurora', 'lab', 'glasshouse'];
  for(const mode of ['light','dark']){
    await page.locator('#interface-theme').selectOption(mode);
    for(const style of themes){
      await page.evaluate(value=>document.documentElement.dataset.style=value,style);
      await expect(page.locator('#printer-model')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    }
  }
  await page.setViewportSize({width:390,height:844});
  for(const style of themes){
    await page.evaluate(value=>document.documentElement.dataset.style=value,style);
    await expect(page.getByRole('button',{name:'Sections'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});

test('Tile Build opens as a staggered tile wave and assembles in reverse on close',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await login(page);
  const toggle=page.getByRole('button',{name:'Sections'}), navigation=page.locator('#atelier-tabs');
  await toggle.click();
  await expect(navigation).toHaveAttribute('data-phase','opening');
  expect(await navigation.locator('[data-tab]').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('tile-enter');
  await expect(navigation).toHaveAttribute('data-phase','');
  await toggle.click();
  await expect(navigation).toHaveAttribute('data-phase','closing');
  await expect(navigation).toHaveAttribute('inert','');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await navigation.evaluate(el=>el.contains(document.activeElement))).toBe(false);
  expect(await navigation.locator('[data-tab]').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('tile-exit');
  await expect(navigation).toHaveAttribute('data-open','false');
  await expect(navigation).toBeHidden();
  await toggle.click();
  await expect(navigation).not.toHaveAttribute('inert','');
  await expect(navigation.locator('[data-tab][aria-current="page"]')).toBeFocused();
});

test('la vague de tuiles suit la préférence de mouvement réduit',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await login(page);
  const toggle=page.getByRole('button',{name:'Sections'}), navigation=page.locator('#atelier-tabs');
  await toggle.click();
  expect(await navigation.locator('[data-tab]').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  await toggle.click();
  await expect(navigation).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('les transitions suivent le style et la préférence de mouvement',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('cloud-page-style','lab'));
  await login(page);
  await openSection(page,'statistics');
  const panel=page.locator('#tab-statistics');
  await expect(panel).toHaveCSS('animation-name','section-fade');
  await openSection(page,'overview');
  await page.locator('#controls-open').click();
  const dialog=page.locator('#controls-dialog');
  await expect(dialog).toHaveCSS('animation-name','dialog-rise');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(dialog).toHaveCSS('animation-name','none');
});

test('Aurore conserve l’ordre commun des cartes de l’imprimante', async ({ page }) => {
  await login(page);
  await openSettings(page);
  await page.locator('#interface-style').selectOption('aurora');
  await openSection(page, 'overview');
  await expect(page.locator('.printer-workspace .atelier-card-header h2'))
    .toHaveText(['Impression', 'Températures et ventilation']);
});
