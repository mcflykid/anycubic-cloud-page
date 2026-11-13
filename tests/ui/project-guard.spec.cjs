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

for (const [action, label, initial, waiting, confirmed] of [
 ['pause', 'Pause', 'printing', 'printing', 'paused'],
 ['resume', 'Reprendre', 'paused', 'preheating', 'printing'],
 ['cancel', 'Arrêter', 'printing', 'printing', 'failed'],
]) {
 test(`le bandeau de ${label} attend la confirmation de la même tâche`, async ({page}) => {
  let state=initial, project='projet-demo', online=true;
  const accepted='Commande acceptée par Anycubic ; confirmation machine en attente';
  await page.route('**/imprimante-api/status',async route=>{
   const response=await route.fetch(), data=await response.json();
   Object.assign(data.printer,{
    printer_online:online, job_state:state, job_is_paused:state==='paused',
    job_in_progress:state!=='failed', is_busy:state!=='failed',
    job_name:project, command_project:project,
   });
   await route.fulfill({json:data});
  });
  let sent;
  await page.route('**/imprimante-api/command',async route=>{
   sent=route.request().postDataJSON();
   await route.fulfill({json:{ok:true,message:accepted}});
  });
  await login(page);
  await expect(page.locator('#job-name')).toHaveText(project);
  await page.getByRole('button',{name:label,exact:true}).click();
  await page.locator('#confirm-yes').click();
  const banner=page.locator('#message-text');
  const refresh=()=>page.evaluate(async()=> (await import(document.querySelector('#workshop-script').src)).refresh());
  await expect(banner).toContainText(accepted);
  expect(sent).toMatchObject({action, project_key:project});
  state=waiting;
  await refresh();
  await expect(banner).toContainText(accepted);
  state=confirmed;
  project='autre-projet';
  await refresh();
  await expect(banner).toContainText(accepted);
  project='projet-demo';
  online=false;
  await refresh();
  await expect(banner).toContainText(accepted);
  online=true;
  await refresh();
  await expect(page.locator('#message')).toBeHidden();
 });
}

test('la confirmation de la pause préserve une alerte plus récente', async ({page}) => {
 let paused=false;
 await page.route('**/imprimante-api/status', async route => {
  const response=await route.fetch(), data=await response.json();
  Object.assign(data.printer,{
   job_in_progress:true, is_busy:true, job_name:'Tâche de démonstration',
   command_project:'projet-demo', job_state:paused?'paused':'printing', job_is_paused:paused,
  });
  await route.fulfill({json:data});
 });
 await page.route('**/imprimante-api/command', route => route.fulfill({
  json:{ok:true,message:'Commande acceptée par Anycubic ; confirmation machine en attente'},
 }));
 await login(page);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 await page.locator('#confirm-yes').click();
 await expect(page.locator('#message-text')).toContainText('confirmation machine en attente');
 await page.evaluate(async()=>{
  const script=new URL(document.querySelector('#workshop-script').src);
  script.pathname=script.pathname.replace(/imprimante\.js$/, 'workshop-ui.mjs');
  const {message}=await import(script.href);
  message('Alerte plus récente.', true);
 });
 paused=true;
 await page.evaluate(async()=> (await import(document.querySelector('#workshop-script').src)).refresh());
 await expect(page.getByRole('button',{name:'Reprendre',exact:true})).toBeEnabled();
 await expect(page.locator('#message-text')).toContainText('Alerte plus récente.');
});
