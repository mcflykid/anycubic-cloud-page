const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('l’aperçu courant utilise sa référence de projet pour un lancement depuis la machine',async({page})=>{
  const requests=[];
  await page.route('**/imprimante-api/status',async route=>{
    const response=await route.fetch(),data=await response.json();
    data.printer.job_name='.3mf_temp/fixture.gcode.3mf';
    data.printer.command_project='a'.repeat(20);
    await route.fulfill({json:data});
  });
  await page.route('**/imprimante-api/preview',async route=>{
    requests.push(route.request().postDataJSON());
    const response=await route.fetch();await route.fulfill({response});
  });
  await login(page);
  await expect(page.locator('#job-preview')).toBeVisible();
  expect(requests[0]).toEqual({source:'active',project_key:'a'.repeat(20)});
});
