const {expect}=require('@playwright/test');
/** Les identifiants correspondent au serveur de démonstration isolé, jamais à un compte réel. */
async function login(page){await page.goto('/login');await page.getByLabel('Identifiant').fill('admin');await page.getByLabel('Mot de passe').fill('ui-fixture-password');await page.getByRole('button',{name:'Se connecter',exact:true}).click();await expect(page).toHaveURL(/imprimante\.html$/);}
module.exports={login};
