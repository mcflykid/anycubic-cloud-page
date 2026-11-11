const {test, expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('le second ACE garde ses bobines et sa cible, puis se replie s’il disparaît', async({page})=>{
  let second=true;
  const orders=[];
  await page.route('**/imprimante-api/status', async route=>{
    const response=await route.fetch(), data=await response.json();
    const first=data.printer.boxes[0];
    data.printer.boxes=second?[first,{...first,box_id:1,index:1,model:'ACE Pro',spools:first.spools.map(s=>({...s,material_type:'PETG',color:[12,34,56,78,90,12]}))}]:[first];
    await route.fulfill({json:data});
  });
  await page.route('**/imprimante-api/command',async route=>{orders.push(route.request().postDataJSON());await route.fulfill({json:{ok:true,message:'Commande fictive acceptée'}});});
  await login(page);
  await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
  await expect(page.locator('#ace-selector')).toBeVisible();
  await page.locator('#go-spool').click();
  await expect(page.locator('#spool-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#ace-selector').selectOption('1');
  await expect(page.locator('#spools .ace-spool-copy strong').first()).toContainText('PETG');
  await expect(page.locator('#spools .ace-spool-row')).toHaveCount(4);

  await page.locator('#go-drying').click();
  await page.locator('#dry-stop').click();
  await page.locator('#confirm-yes').click();
  await expect.poll(()=>orders.length).toBe(1);
  expect(orders[0].box).toBe(1);
  second=false;
  await page.reload();
  await page.getByRole('button',{name:'ACE et filaments',exact:true}).click();
  await expect(page.locator('#ace-selector')).toBeHidden();
  await expect(page.locator('#spools .ace-spool-copy strong').first()).toContainText('PLA');
});
