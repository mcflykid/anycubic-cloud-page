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

test('les sept styles gardent leurs compositions propres en clair, sombre et sur mobile',async({page})=>{
  await login(page);
  await openSettings(page);
  const themes=['standard','apple','detailed','blueprint','aurora','ocean','lab'];
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
  expect(await navigation.locator('[data-tab]').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('tile-exit');
  await expect(navigation).toHaveAttribute('data-open','false');
  await expect(navigation).toBeHidden();
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

test('Blueprint replie son panneau sans perdre les noms accessibles',async({page})=>{
  await login(page);
  await openSettings(page);
  await page.locator('#interface-style').selectOption('blueprint');
  const toggle=page.getByRole('button',{name:'Replier le plan'});
  await expect(toggle).toBeVisible();
  await expect(page.locator('#atelier-tabs').getByRole('button',{name:'Fichiers'})).toBeVisible();
  await toggle.click();
  await expect(page.locator('.printer-shell')).toHaveClass(/blueprint-sidebar-collapsed/);
  await expect(page.getByRole('button',{name:'Déplier le plan'})).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#atelier-tabs').getByRole('button',{name:'Fichiers'})).toBeAttached();
});

test('Aurore mémorise les cartes réordonnées et les réinitialise au clavier',async({page})=>{
  await login(page);
  await openSettings(page);
  await page.locator('#interface-style').selectOption('aurora');
  await openSection(page,'overview');
  const bento=page.locator('#aurora-bento');
  await expect(bento.locator('.aurora-widget')).toHaveCount(4);
  const first=bento.locator('.aurora-widget').first();
  const firstName=await first.getAttribute('data-widget');
  await first.getByRole('button',{name:/Déplacer .* vers le bas/}).click();
  await expect(bento.locator('.aurora-widget').nth(1)).toHaveAttribute('data-widget',firstName);
  await page.reload();
  await openSection(page,'overview');
  await expect(bento.locator('.aurora-widget').nth(1)).toHaveAttribute('data-widget',firstName);
  await bento.getByRole('button',{name:'Réinitialiser la disposition'}).click();
  await expect(bento.locator('.aurora-widget').first()).toHaveAttribute('data-widget',firstName);
  const dragHandle=bento.locator(`.aurora-widget[data-widget="${firstName}"] .aurora-drag-handle`);
  const firstCard=bento.locator('.aurora-widget').first();
  await Promise.all([dragHandle.scrollIntoViewIfNeeded(),firstCard.scrollIntoViewIfNeeded()]);
  const [handle,target]=await Promise.all([dragHandle.boundingBox(),firstCard.boundingBox()]);
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
  await page.mouse.down();
  await page.mouse.move(target.x+target.width/2,target.y+8,{steps:12});
  await page.mouse.up();
  await expect(bento.locator('.aurora-widget').first()).toHaveAttribute('data-widget',firstName);
});
