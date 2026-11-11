const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

for(const change of ['period','printer']){
 test(`un CSV retardé est annulé après changement de ${change}`,async({page})=>{
  let release,observed;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{observed=resolve;});
  let downloads=0;
  page.on('download',()=>downloads++);
  await page.route('**/imprimante-api/temperatures?*format=csv',async route=>{
   observed();await gate;
   await route.fulfill({json:{csv:'time_utc,nozzle_c\n2026-01-01T00:00:00Z,20\n',hours:24,resolution_seconds:10}});
  });
  await login(page);
  await page.locator('[data-tab=statistics]').click();
  await page.locator('#temperature-hours').selectOption('24');
  await page.locator('#temperature-export').click();
  await started;
  if(change==='period')await page.locator('#temperature-hours').selectOption('1');
  else await page.locator('#printer-selector').evaluate(select=>{
   select.add(new Option('Autre machine fictive','fixture-other'));
   select.value='fixture-other';
  });
  release();
  await expect(page.locator('#temperature-export')).toBeEnabled();
  await expect(page.locator('#temperature-export-state')).toContainText('Export annulé');
  expect(downloads).toBe(0);
 });
}
