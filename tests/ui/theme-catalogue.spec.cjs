const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
const themes=['standard','apple','detailed','blueprint','aurora','ocean','lab'];
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

test('les sept styles se choisissent dans la galerie, se mémorisent et gardent le mode sombre',async({page})=>{
  await login(page);await openSettings(page);
  await expect(page.locator('#interface-style option')).toHaveCount(7);
  await page.locator('#interface-theme').selectOption('dark');
  await page.locator('.theme-browser summary').click();
  await expect(page.locator('#theme-gallery button')).toHaveCount(7);
  for(const style of themes){
    await page.locator(`[data-theme-choice=${style}]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-style',style);
    await expect(page.locator(`[data-theme-choice=${style}]`)).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#interface-theme')).toHaveValue('dark');
    await expect(page.locator('#theme-description')).not.toBeEmpty();
  }
  await page.reload();await openSettings(page);
  await expect(page.locator('#interface-style')).toHaveValue('lab');
  await expect(page.locator('#interface-theme')).toHaveValue('dark');
});

test('un ancien thème retiré revient au style standard',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('cloud-page-style','terminal'));
  await login(page);
  await expect(page.locator('#interface-style')).toHaveValue('standard');
  await expect(page.locator('html')).toHaveAttribute('data-style','standard');
  expect(await page.evaluate(()=>localStorage.getItem('cloud-page-style'))).toBe('standard');
});

test('les sept styles restent utilisables en clair, sombre et sur mobile avec animations réduites',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await login(page);
  for(const mode of ['light','dark']){
    await openSettings(page);await page.locator('#interface-theme').selectOption(mode);
    for(const style of themes){
      await page.locator('#interface-style').selectOption(style);
      await openSection(page,'overview');
      const background=await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor);
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
      await expect(page.locator('#printer-model')).toBeVisible();
      await openSettings(page);
    }
  }
  await page.setViewportSize({width:360,height:800});
  for(const style of themes){
    await openSettings(page);await page.locator('#interface-style').selectOption(style);
    await openSection(page,'overview');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await openSettings(page);
    await expect(page.locator('#interface-style')).toBeVisible();
  }
});

test('le style choisi accompagne aussi la connexion et les pages d’information',async({page})=>{
  await login(page);await openSettings(page);
  await page.locator('#interface-style').selectOption('aurora');
  await page.locator('#interface-theme').selectOption('dark');
  await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('html')).toHaveAttribute('data-style','aurora');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.getByLabel('Identifiant')).toBeVisible();
  await page.goto('/imprimante-api/ui/privacy');
  await expect(page.locator('html')).toHaveAttribute('data-style','aurora');
});
