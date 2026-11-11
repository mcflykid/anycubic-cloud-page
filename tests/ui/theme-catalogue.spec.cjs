const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
const themes=['standard', 'apple', 'blueprint', 'aurora', 'lab', 'glasshouse', 'prism'];
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

test('les sept styles se choisissent dans la liste, se mémorisent et gardent le mode sombre',async({page})=>{
  await login(page);await openSettings(page);
  await expect(page.locator('#interface-style option')).toHaveCount(themes.length);
  await page.locator('#interface-theme').selectOption('dark');
  await expect(page.locator('.theme-browser')).toHaveCount(0);
  for(const style of themes){
    await page.locator('#interface-style').selectOption(style);
    await expect(page.locator('html')).toHaveAttribute('data-style',style);
    await expect(page.locator('#interface-theme')).toHaveValue('dark');
    await expect(page.locator('#theme-description')).not.toBeEmpty();
  }
  await page.reload();await openSettings(page);
  await expect(page.locator('#interface-style')).toHaveValue('prism');
  await expect(page.locator('#interface-theme')).toHaveValue('dark');
});

for (const previous of ['terminal', 'detailed', 'ocean', 'studio', 'observatory']) {
  test(`le style retiré ${previous} revient à Par défaut et garde le mode sombre`, async ({page}) => {
    await page.addInitScript(value => {
      localStorage.setItem('cloud-page-style', value);
      localStorage.setItem('cloud-page-theme', 'dark');
    }, previous);
    await login(page);
    await expect(page.locator('#interface-style')).toHaveValue('standard');
    await expect(page.locator('html')).toHaveAttribute('data-style', 'standard');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
}

test('le changement de mode conserve le focus et respecte le mouvement réduit',async({page})=>{
  await page.addInitScript(()=>{
    const start=document.startViewTransition?.bind(document);
    window.themeTransitions=0;
    if(start)document.startViewTransition=callback=>{
      window.themeTransitions+=1;
      return start(callback);
    };
  });
  await login(page);await openSettings(page);
  const theme=page.locator('#interface-theme');
  await theme.focus();
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await page.evaluate(()=>window.themeTransitions)).toBe(1);
  await expect(theme).toBeFocused();
  await page.emulateMedia({reducedMotion:'reduce'});
  await theme.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  expect(await page.evaluate(()=>window.themeTransitions)).toBe(1);
  await expect(theme).toBeFocused();
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

test('Prisme montre les relevés en tuiles et replie les deux appareils sur téléphone',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  await login(page);
  await openSettings(page);
  await page.locator('#interface-style').selectOption('prism');
  await page.locator('#interface-theme').selectOption('dark');
  await openSection(page,'summary');
  const printer=page.locator('.summary-printer');
  const ace=page.locator('.summary-ace');
  await expect(printer.locator('.summary-values')).toHaveCSS('display','grid');
  await expect(printer.locator('dt')).toHaveText(['Temps restant','Buse','Plateau']);
  await expect(ace.locator('dt')).toHaveText(['Température','Humidité']);
  await expect(printer.locator('[data-summary-open]')).toHaveCSS('transition-duration','0s');
  const desktop=[await printer.boundingBox(),await ace.boundingBox()];
  expect(desktop[0].x+desktop[0].width).toBeLessThan(desktop[1].x);
  await page.setViewportSize({width:390,height:844});
  const mobile=[await printer.boundingBox(),await ace.boundingBox()];
  expect(mobile[0].y+mobile[0].height).toBeLessThan(mobile[1].y);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
