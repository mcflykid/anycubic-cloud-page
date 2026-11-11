const {test, expect}=require('@playwright/test');
const {login,openSection}=require('./helpers.cjs');

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

test('les bobines et les commandes ACE restent alignées en mode sombre', async ({page}) => {
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), data = await response.json();
    data.printer.boxes[0].spools[3].spool_loaded = false;
    await route.fulfill({json: data});
  });
  await page.emulateMedia({reducedMotion: 'reduce'});
  await login(page, 'ace');
  await page.locator('html').evaluate(el => el.dataset.theme = 'dark');
  const spools = page.locator('#spools .spool-illustration');
  await expect(spools).toHaveCount(3);
  await expect(spools.first()).toHaveAttribute('aria-hidden', 'true');
  expect((await spools.first().boundingBox()).width).toBeLessThanOrEqual(32);
  await expect(page.locator('#spools .ace-spool-empty')).toHaveCount(1);
  const drying = page.locator('#go-drying'), spool = page.locator('#go-spool');
  const relay = page.locator('.ace-relay-row > div'), relayButton = page.locator('#ace-relay-open');
  for (const width of [1920, 390]) {
    await page.setViewportSize({width, height: 900});
    expect((await drying.boundingBox()).y).toBeCloseTo((await spool.boundingBox()).y, 0);
    const relayBox = await relay.boundingBox(), relayAction = await relayButton.boundingBox();
    expect(relayAction.x).toBeGreaterThanOrEqual(relayBox.x + relayBox.width);
    expect(Math.abs(relayBox.y + relayBox.height / 2 - (relayAction.y + relayAction.height / 2))).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await drying.click();
  const toggle = await page.locator('#dry-toggle').boundingBox();
  const status = await page.locator('#drying-state').boundingBox();
  expect(status.x).toBeGreaterThanOrEqual(toggle.x + toggle.width);
  expect(Math.abs(toggle.y + toggle.height / 2 - (status.y + status.height / 2))).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await openSection(page, 'camera');
  const help = page.locator('[data-context-help="camera"]');
  const header = await help.locator('..').boundingBox();
  const button = await help.boundingBox();
  expect(Math.abs(button.x + button.width / 2 - (header.x + header.width / 2))).toBeLessThanOrEqual(1);
});
