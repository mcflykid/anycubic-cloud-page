const {test, expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('les dix sections restent visibles sans barre horizontale à 1249 px',async({page})=>{
  await page.setViewportSize({width:1249,height:900});
  await login(page);
  const navigation=page.locator('#atelier-tabs');
  await expect(navigation.locator('[data-tab]')).toHaveCount(10);
  for (const style of ['standard', 'apple', 'blueprint', 'aurora', 'lab', 'glasshouse', 'prism']) {
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
