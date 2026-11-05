const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
test('déconnexion au clavier et révocation effective',async({page})=>{await login(page);const button=page.getByRole('button',{name:'Se déconnecter',exact:true});await expect(page.locator('.portal-nav').getByRole('link',{name:'Anycubic Cloud Page'})).toHaveAttribute('href','/imprimante.html');await expect(page.getByText('Atelier autonome',{exact:true})).toHaveCount(0);await button.focus();await button.press('Enter');await expect(page).toHaveURL(/\/login$/);const response=await page.request.get('/imprimante-api/status');expect(response.status()).toBe(401);});
module.exports={login};
