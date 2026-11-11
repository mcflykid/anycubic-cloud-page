const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

/** Le laboratoire doit déplacer les boutons réels et retrouver chaque parcours après changement de thème. */
test('Laboratoire regroupe neuf sections et restitue la navigation standard',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('cloud-page-style','lab'));
 await login(page);
 await expect(page.locator('.lab-nav-group')).toHaveCount(5);
 // Le rail reste un bloc compact, indépendant de la hauteur du tableau de bord.
 await expect(page.locator('.atelier-navigation')).toHaveCSS('display','block');
 const menu=await page.locator('#atelier-tabs').boundingBox();
 expect(menu.height).toBeLessThan(650);
 const tabs=page.locator('#atelier-tabs [data-tab]');
 await expect(tabs).toHaveCount(9);
 for(const key of ['overview','ace','files','upload','camera','history','statistics','fleet','settings']){
  await page.locator(`#atelier-tabs [data-tab=${key}]`).click();
  await expect(page.locator(`#tab-${key}`)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),key).toBe(true);
  await page.mouse.move(5,5);
  await page.screenshot({path:`test-results/lab-${key}-desktop.png`,fullPage:true});
 }
 await page.locator('#interface-style').selectOption('standard');
 await expect(page.locator('.lab-nav-group')).toHaveCount(0);
 await expect(page.locator('#atelier-tabs > [data-tab]')).toHaveCount(9);
 await page.locator('[data-tab=camera]').click();await expect(page.locator('#tab-camera')).toBeVisible();
});

/** La navigation groupée reste utilisable en mode téléphone et après interruption de fermeture. */
test('Laboratoire mobile ouvre les groupes et reste sans débordement',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>localStorage.setItem('cloud-page-style','lab'));
 await login(page);
 for(const key of ['files','fleet','settings']){
  await page.locator('#section-menu-toggle').click();
  await page.locator(`#atelier-tabs [data-tab=${key}]`).click();
  await expect(page.locator(`#tab-${key}`)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),key).toBe(true);
 }
 await page.screenshot({path:'test-results/lab-settings-mobile.png',fullPage:true});
});

/** Les ressources du thème doivent être accessibles avant authentification, sans publier celles de l’atelier. */
test('Laboratoire habille aussi la connexion et ses champs restent utilisables',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('cloud-page-style','lab'));
 await page.goto('/login');
 await expect(page.locator('html')).toHaveAttribute('data-style','lab');
 await expect(page.locator('.login-card')).toHaveCSS('border-top-width','3px');
 await expect(page.getByRole('button',{name:'Afficher',exact:true})).toBeEnabled();
 await page.screenshot({path:'test-results/login-lab.png',fullPage:true});
 await page.getByLabel('Mot de passe',{exact:true}).fill('fixture-only');
 await page.getByRole('button',{name:'Afficher',exact:true}).click();
 await expect(page.locator('#password')).toHaveAttribute('type','text');
});
