const {test, expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('les dix sections restent visibles sans barre horizontale à 1249 px',async({page})=>{
  await page.setViewportSize({width:1249,height:900});
  await login(page);
  const navigation=page.locator('#atelier-tabs');
  await expect(navigation.locator('[data-tab]')).toHaveCount(10);
  for (const style of ['standard', 'aurora', 'lab']) {
    await page.locator('html').evaluate((element,value)=>element.setAttribute('data-style',value),style);
    const dimensions=await navigation.evaluate(el=>({viewport:innerWidth,display:getComputedStyle(el).display,width:el.getBoundingClientRect().width,overflow:getComputedStyle(el).overflowX,shellClass:document.querySelector('.printer-shell').className,buttons:[...el.querySelectorAll('button')].map(button=>{const box=button.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(button);const text=[...range.getClientRects()];return {label:button.innerText,left:box.left,right:box.right,width:box.width,display:getComputedStyle(button).display,visible:getComputedStyle(button).visibility!=='hidden'&&box.width>0,textFits:text.every(rect=>rect.left>=box.left-1&&rect.right<=box.right+1)};})}));
    expect(['auto','scroll']).not.toContain(dimensions.overflow);
    expect(dimensions.buttons.every(button=>button.visible&&button.left>=0&&button.right<=1249&&(style==='aurora'||button.textFits)),`${style}: ${JSON.stringify(dimensions)}`).toBe(true);
  }
  await page.screenshot({path:'test-results/navigation-1249.png',fullPage:false});
});

test('le menu mobile ouvre une grille de dix sections accessible et se referme après un choix',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await login(page);
  const toggle=page.getByRole('button',{name:'Sections'});
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  const navigation=page.getByRole('navigation',{name:'Sections de l’atelier'});
  await expect(navigation).toBeVisible();
  await expect(navigation.locator('[data-tab]')).toHaveCount(10);
  await expect(navigation).toHaveAttribute('data-phase','');
  await expect(page.getByRole('button',{name:'Statistiques'})).toBeVisible();
  await page.screenshot({path:'test-results/navigation-mobile-grid.png',fullPage:false});
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.getByRole('button',{name:'Statistiques'}).click();
  await expect(page.locator('#tab-statistics')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#section-menu-current')).toHaveText('Statistiques');
});

test('la barre commune aligne les commandes et suit le mode de couleur', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await login(page, 'summary');
  const toggle = page.locator('#interface-mode-toggle');
  await expect(toggle).toHaveAccessibleName('Activer le mode clair');
  const controls = await page.locator('.portal-nav .atelier-control:visible').evaluateAll(
    items => items.map(item => item.getBoundingClientRect().height),
  );
  expect(controls).toEqual([36, 36, 36, 36]);
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#interface-theme')).toHaveValue('light');
  await expect(toggle).toHaveAccessibleName('Activer le mode sombre');
  const groups = page.locator('#atelier-tabs .atelier-nav-label');
  await expect(groups.first()).toHaveCSS('text-align', 'center');
  const rows = await page.locator('#atelier-tabs [data-tab]').evaluateAll(
    items => items.map(item => Math.round(item.getBoundingClientRect().top)),
  );
  expect(new Set(rows).size).toBe(1);
});

test('le Laboratoire replie son rail en gardant toutes les destinations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('cloud-page-style', 'lab'));
  await login(page, 'summary');
  const toggle = page.locator('#lab-navigation-toggle');
  const before = await page.locator('.atelier-navigation').boundingBox();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const after = await page.locator('.atelier-navigation').boundingBox();
  expect(after.width).toBeLessThan(before.width);
  await expect(page.locator('#atelier-tabs').getByRole('button', { name: 'Fichiers' })).toBeVisible();
});

test('le rail Laboratoire garde sa hauteur entre Résumé et Réglages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('cloud-page-style', 'lab'));
  await login(page, 'summary');
  const rail = page.locator('.atelier-navigation');
  const toggle = page.locator('#lab-navigation-toggle');
  for (const expanded of ['true', 'false']) {
    await expect(toggle).toHaveAttribute('aria-expanded', expanded);
    const before = await rail.boundingBox();
    await page.locator('#atelier-tabs [data-tab=settings]').click();
    await expect(page.locator('#tab-settings')).toBeVisible();
    const after = await rail.boundingBox();
    expect(after.height).toBeCloseTo(before.height, 0);
    await page.locator('#atelier-tabs [data-tab=summary]').click();
    if (expanded === 'true') await toggle.click();
  }
});
