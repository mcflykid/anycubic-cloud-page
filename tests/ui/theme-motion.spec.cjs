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

test('les six styles gardent leurs compositions propres en clair, sombre et sur mobile',async({page})=>{
  await login(page);
  await openSettings(page);
  const themes=['standard', 'apple', 'blueprint', 'aurora', 'lab', 'glasshouse'];
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
  await expect(panel.locator('.statistics-grid > section').nth(1)).toHaveCSS('animation-delay','0.045s');
  await openSection(page,'overview');
  await page.locator('#controls-open').click();
  const dialog=page.locator('#controls-dialog');
  await expect(dialog).toHaveCSS('animation-name','dialog-pop');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(dialog).toHaveCSS('animation-name','none');
});

for (const theme of ['apple']) {
  test(`${theme} garde le repère de sélection sur une rangée de navigation`,async({page})=>{
    await page.setViewportSize({width:1249,height:800});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.addInitScript(value=>localStorage.setItem('cloud-page-style',value),theme);
    await login(page);
    await openSection(page,'settings');
    const tabs=page.locator('#atelier-tabs');
    const rows=await tabs.locator('[data-tab]').evaluateAll(buttons=>buttons.map(button=>Math.round(button.getBoundingClientRect().top)));
    expect(new Set(rows).size).toBe(1);
    const active=tabs.locator('[aria-current="page"]'), indicator=tabs.locator('.atelier-active-indicator');
    await expect.poll(async()=>{
      const [button,marker]=await Promise.all([active.boundingBox(),indicator.boundingBox()]);
      return Math.abs(button.x-marker.x)+Math.abs(button.y-marker.y);
    }).toBeLessThan(3);
  });
}

test('Blueprint replie son panneau sans perdre les noms accessibles',async({page})=>{
  await login(page);
  await openSettings(page);
  await page.locator('#interface-style').selectOption('blueprint');
  const toggle=page.getByRole('button',{name:'Replier le plan'});
  await expect(toggle).toBeVisible();
  const files=page.locator('#atelier-tabs').getByRole('button',{name:'Fichiers'});
  await expect(files).toBeVisible();
  const [icon,label]=await Promise.all([files.locator('svg').boundingBox(),files.locator('span').boundingBox()]);
  expect(label.x).toBeGreaterThan(icon.x+icon.width);
  expect(Math.abs(label.y+label.height/2-icon.y-icon.height/2)).toBeLessThan(3);
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
  const lock = page.locator('#tab-overview [data-layout-action="lock"]');
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await lock.click();
  await first.getByRole('button',{name:'Déplacer après'}).press('Enter');
  await expect(bento.locator('.aurora-widget').nth(1)).toHaveAttribute('data-widget',firstName);
  await page.reload();
  await openSection(page,'overview');
  await expect(lock).toHaveAttribute('aria-pressed','false');
  await expect(bento.locator('.aurora-widget').nth(1)).toHaveAttribute('data-widget',firstName);
  await openSettings(page);
  await page.locator('#layout-reset').click();
  await openSection(page,'overview');
  await expect(bento.locator('.aurora-widget').first()).toHaveAttribute('data-widget',firstName);
});
