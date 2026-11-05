const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
test('déconnexion au clavier et révocation effective',async({page})=>{await login(page);const button=page.getByRole('button',{name:'Se déconnecter',exact:true});await expect(page.locator('.portal-nav').getByRole('link',{name:'Anycubic Cloud Page'})).toHaveAttribute('href','/imprimante.html');await expect(page.getByText('Atelier autonome',{exact:true})).toHaveCount(0);await button.focus();await button.press('Enter');await expect(page).toHaveURL(/\/login$/);const response=await page.request.get('/imprimante-api/status');expect(response.status()).toBe(401);});
module.exports={login};


test('la page française démarre avec une barre compacte sans ressource de traduction',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 const {login}=require('./helpers.cjs');
 const languageRequests=[];
 page.on('request',request=>{if(request.url().includes('/js/ui-language.js'))languageRequests.push(request);});
 await login(page);
 await expect(page.locator('#connection')).toHaveText('En ligne');
 await expect(page.locator('#printer-model')).toHaveText('Anycubic Kobra S1');
 await expect(page.locator('#interface-language')).toHaveCount(0);
 expect(languageRequests).toHaveLength(0);
 const bell=await page.locator('#notifications-toggle').boundingBox();
 expect(bell.width).toBe(44);
 expect(bell.height).toBeGreaterThanOrEqual(44);
 expect(await page.locator('.portal-nav').evaluate(nav=>nav.scrollWidth<=nav.clientWidth)).toBe(true);
});
