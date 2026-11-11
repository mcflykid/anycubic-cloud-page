/** Vérifie l’accueil Résumé, l’ordre des appareils et la navigation par usage. */
const {test,expect}=require('@playwright/test');

test('l’atelier ouvre Résumé et termine par Statistiques puis Réglages',async({page})=>{
  await page.goto('/login');
  await page.getByLabel('Identifiant').fill('admin');
  await page.getByLabel('Mot de passe',{exact:true}).fill('ui-fixture-password');
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await expect(page.locator('#tab-summary')).toBeVisible();
  await expect(page.locator('#summary-job')).toHaveText('Cube de calibration · PLA');
  await expect(page.locator('#summary-ace-boxes')).toContainText('ACE 2 Pro');
  await expect(page.locator('.nav-actions .quick-open')).toHaveCount(0);
  const tabs=await page.locator('#atelier-tabs [data-tab]').evaluateAll(buttons=>buttons.map(button=>button.dataset.tab));
  expect(tabs).toEqual(['summary','overview','ace','files','upload','camera','history','fleet','statistics','settings']);
  await page.getByRole('button',{name:'Ouvrir l’imprimante'}).click();
  await expect(page.locator('#tab-overview')).toBeVisible();
  await expect(page.locator('#atelier-tabs [data-tab=overview]')).toHaveAttribute('aria-current','page');
  await page.locator('#atelier-tabs [data-tab=settings]').click();
  await expect(page.locator('#settings-container')).toBeVisible();
});

test('les groupes restent lisibles en clair, sombre et sur téléphone',async({page})=>{
  const {login}=require('./helpers.cjs');
  await page.emulateMedia({reducedMotion:'reduce'});
  await login(page,'summary');
  for (const width of [1366,900,390]) {
    await page.setViewportSize({width,height:844});
    for (const style of ['standard', 'aurora', 'lab', 'glasshouse']) {
      for (const theme of ['light','dark']) {
        await page.evaluate(({style,theme})=>Object.assign(document.documentElement.dataset,{style,theme}),{style,theme});
        const toggle=page.locator('#section-menu-toggle');
        if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded')!=='true') await toggle.click();
        const nav=page.locator('#atelier-tabs');
        await expect(nav.getByRole('group',{name:'Appareils'})).toBeVisible();
        await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-tab','summary');
        expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    }
  }
});
