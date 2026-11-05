const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
/** Une interruption de transfert garde sa référence, sans répétition automatique ni message de succès. */
test('envoi lent : budget adapté et même demande après résultat incertain',async({page})=>{
 await page.addInitScript(()=>{window.uploadBudgets=[];const original=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=ms=>{window.uploadBudgets.push(ms);return original(ms);};});
 const ids=[];await page.route('**/imprimante-api/upload',async route=>{ids.push(route.request().postData().match(/name="request_id"\r\n\r\n([^\r]+)/)[1]);await route.abort('timedout');});
 await login(page);await page.getByRole('button',{name:'Envoyer et imprimer',exact:true}).click();await page.locator('#upload-form input[type=file]').setInputFiles({name:'fixture.gcode',mimeType:'text/plain',buffer:Buffer.from('G28\n')});
 for(let attempt=0;attempt<2;attempt++){
  await page.locator('#upload-form button[type=submit]').click();await page.locator('#confirm-yes').click();await expect(page.locator('#upload-state')).toContainText('Vérifiez les fichiers du cloud');
 }
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect(await page.evaluate(()=>window.uploadBudgets.filter(ms=>ms>300000).length)).toBe(2);
});
