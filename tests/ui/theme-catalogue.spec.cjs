const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
const themes=['standard','apple','detailed','halloween','christmas','anchor','turnover','cards','drum','outline','tiles','brutalist','neon','blueprint','paper','terminal','aurora','ocean','solar','mono'];

test('les vingt styles se choisissent dans la galerie, se mémorisent et gardent le mode sombre',async({page})=>{
  await login(page);await page.locator('[data-tab=settings]').click();
  await expect(page.locator('#interface-style option')).toHaveCount(20);
  await page.locator('#interface-theme').selectOption('dark');
  await page.locator('.theme-browser summary').click();
  await expect(page.locator('#theme-gallery button')).toHaveCount(20);
  for(const style of themes){
    await page.locator(`[data-theme-choice=${style}]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-style',style);
    await expect(page.locator(`[data-theme-choice=${style}]`)).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#interface-theme')).toHaveValue('dark');
    await expect(page.locator('#theme-description')).not.toBeEmpty();
  }
  await page.reload();await page.locator('[data-tab=settings]').click();
  await expect(page.locator('#interface-style')).toHaveValue('mono');
  await expect(page.locator('#interface-theme')).toHaveValue('dark');
});

test('les vingt styles restent utilisables en clair, sombre et sur mobile avec animations réduites',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await login(page);
  for(const mode of ['light','dark']){
    await page.locator('[data-tab=settings]').click();await page.locator('#interface-theme').selectOption(mode);
    for(const style of themes){
      await page.locator('#interface-style').selectOption(style);
      await page.locator('[data-tab=overview]').click();
      const background=await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor);
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
      await expect(page.locator('#printer-model')).toBeVisible();
      await page.locator('[data-tab=settings]').click();
    }
  }
  await page.setViewportSize({width:360,height:800});
  for(const style of themes){
    await page.locator('#interface-style').selectOption(style);
    await page.locator('[data-tab=overview]').click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.locator('[data-tab=settings]').click();
    await expect(page.locator('#interface-style')).toBeVisible();
  }
});

test('le style choisi accompagne aussi la connexion et les pages d’information',async({page})=>{
  await login(page);await page.locator('[data-tab=settings]').click();
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
