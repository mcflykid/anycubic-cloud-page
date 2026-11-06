const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
/** La référence transmise reste celle présentée avant la confirmation, même si le suivi change de tâche. */
test('une confirmation ancienne ne prend pas la référence du nouveau projet',async({page})=>{
 let project='projet-initial';const commands=[];
 let releaseStatus;
 const statusReady=new Promise(resolve=>{releaseStatus=resolve;});
 await page.route('**/imprimante-api/status',async route=>{
   await statusReady;
   const response=await route.fetch(),data=await response.json();
   Object.assign(data.printer,{job_in_progress:true,is_busy:true,job_is_paused:false,job_name:project,command_project:project});
   await route.fulfill({json:data});
 });
 await page.route('**/imprimante-api/command',async route=>{commands.push(route.request().postDataJSON());await route.fulfill({status:400,json:{ok:false,message:'Le projet a changé. Aucune commande envoyée.'}});});
 await login(page);
 const pause=page.getByRole('button',{name:'Pause',exact:true});
 try {
   await expect(pause).toBeDisabled();
 } finally {
   releaseStatus();
 }
 await expect(page.locator('#job-name')).toHaveText('projet-initial');
 await pause.click();
 project='projet-suivant';
 await page.evaluate(async()=> (await import(document.querySelector('#workshop-script').src)).refresh());
 await expect(page.locator('#job-name')).toHaveText('projet-suivant');
 await page.locator('#confirm-yes').click();
 await expect(page.locator('#message-text')).toContainText('Le projet a changé');expect(commands).toHaveLength(1);expect(commands[0].project_key).toBe('projet-initial');
});
