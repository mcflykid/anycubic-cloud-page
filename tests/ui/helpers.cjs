const {expect}=require('@playwright/test');
/** Les identifiants correspondent au serveur de démonstration isolé, jamais à un compte réel. */
async function login(page,landing='overview'){await page.goto('/login');await page.getByLabel('Identifiant').fill('admin');await page.getByLabel('Mot de passe').fill('ui-fixture-password');await page.getByRole('button',{name:'Se connecter',exact:true}).click();await expect(page).toHaveURL(/imprimante\.html$/);if(landing!=='summary')await openSection(page,landing);}
/** Ouvre une section via le menu mobile quand la barre de bureau est masquée. */
async function openSection(page, key){
 const toggle=page.locator('#section-menu-toggle');
 if(await toggle.isVisible()){
  await toggle.click();
  await expect(page.locator('#atelier-tabs')).toHaveAttribute('data-open','true');
 }
 const tab=page.locator(`#atelier-tabs [data-tab="${key}"]`);
 await expect(tab).toBeVisible();
 await tab.click();
}
module.exports={login,openSection};
