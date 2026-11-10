const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('chaque modèle reconnu suit la sélection dans Imprimante et Réglages',async({page})=>{
  let model='Anycubic Kobra 1';
  await page.route('**/imprimante-api/status',async route=>{
    const response=await route.fetch(),data=await response.json();
    data.printer.machine_name=model;data.printer.boxes=[];
    await route.fulfill({json:data});
  });
  await login(page);
  for(const name of ['Kobra 1','Kobra 1 Plus','Kobra 1 Max','Kobra 2','Kobra 2 Neo','Kobra 2 Pro','Kobra 2 Plus','Kobra 2 Max','Kobra 3 V2','Kobra 3 Max','Kobra 3 Max V2','Kobra 4','Kobra S1 Max']){
    model='Anycubic '+name;
    await page.reload();
    const filename=name.toLowerCase().replaceAll(' ','-')+'.svg';
    await expect(page.locator('#printer-illustration')).toHaveAttribute('src',new RegExp(filename+'$'));
    await expect(page.locator('#settings-printer-illustration')).toHaveAttribute('src',new RegExp(filename+'$'));
    expect(await page.locator('#printer-illustration').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  }
  model='Modèle inconnu';await page.reload();
  await expect(page.locator('#printer-illustration')).toHaveAttribute('src',/\/printer\.svg$/);
});
