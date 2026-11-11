const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('le préchauffage respecte les limites reçues et demande confirmation',async({page})=>{
  const sent=[];
  await page.route('**/imprimante-api/command',r=>{sent.push(r.request().postDataJSON());return r.fulfill({json:{ok:true,message:'Réglage fictif reçu'}});});
  await login(page);
  await page.locator('#controls-open').click();
  await expect(page.locator('#idle-controls')).toBeVisible();
  const bed=page.locator('#idle-temperature-form [name=target_hotbed_temp]');
  await expect(bed).toHaveAttribute('max','120');
  await bed.fill('30');
  await page.locator('#idle-temperature-form button').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  expect(sent).toHaveLength(0);
  await page.locator('#confirm-yes').click();
  await expect.poll(()=>sent.length).toBe(1);
  expect(sent[0].action).toBe('idle-settings');
  expect(sent[0].target_hotbed_temp).toBe('30');
});

for(const problem of ['busy','missing']){
 test(`les réglages au repos restent absents si ${problem}`,async({page})=>{
  await page.route('**/imprimante-api/status',async r=>{
   const response=await r.fetch(),d=await response.json();
   if(problem==='busy')d.printer.is_busy=true;
   else d.printer.idle_limits={};
   await r.fulfill({json:d});
  });
  await login(page);await page.locator('#controls-open').click();
  await expect(page.locator('#idle-controls')).toBeHidden();
 });
}
