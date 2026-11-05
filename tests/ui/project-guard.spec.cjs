const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
/** La référence transmise reste celle présentée avant la confirmation, même si le suivi change de tâche. */
test('une confirmation ancienne ne prend pas la référence du nouveau projet',async({page})=>{
 let project='projet-initial';const commands=[];
 await page.route('**/imprimante-api/status',async route=>{const response=await route.fetch(),data=await response.json();Object.assign(data.printer,{job_in_progress:true,is_busy:true,job_is_paused:false,command_project:project});await route.fulfill({json:data});});
 await page.route('**/imprimante-api/command',async route=>{commands.push(route.request().postDataJSON());await route.fulfill({status:400,json:{ok:false,message:'Le projet a changé. Aucune commande envoyée.'}});});
 await login(page);await page.getByRole('button',{name:'Pause',exact:true}).click();project='projet-suivant';await page.evaluate(()=>refresh());await page.locator('#confirm-yes').click();
 await expect(page.locator('#message-text')).toContainText('Le projet a changé');expect(commands).toHaveLength(1);expect(commands[0].project_key).toBe('projet-initial');
});
