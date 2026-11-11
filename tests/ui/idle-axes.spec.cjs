const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('le préchauffage respecte les limites reçues et demande confirmation',async({page})=>{
  const sent=[];
  await page.route('**/imprimante-api/command',r=>{sent.push(r.request().postDataJSON());return r.fulfill({json:{ok:true,message:'Réglage fictif reçu'}});});
  await login(page);
  await page.locator('#controls-open').click();
  await expect(page.locator('#idle-controls')).toBeHidden();
  await page.locator('#control-view-idle').click();
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
  await expect(page.locator('#control-view-idle')).toBeHidden();
  await expect(page.locator('#idle-controls')).toBeHidden();
 });
}

test('la vue de repos tient sur ordinateur et mobile et distingue mesure et cible', async ({page}) => {
  const sent = [];
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch(), data = await response.json();
    data.printer.fan_speed_pct = 10;
    data.printer.aux_fan_speed_pct = 20;
    await route.fulfill({json: data});
  });
  await page.route('**/imprimante-api/command', route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({json: {ok: true, message: 'Réglage fictif reçu'}});
  });
  await login(page);
  await page.locator('#controls-open').click();
  await expect(page.locator('#controls-monitor')).toBeVisible();
  await page.locator('#control-view-idle').click();
  await expect(page.locator('#controls-monitor')).toBeHidden();
  const dialog = page.locator('#controls-dialog');
  for (const viewport of [{width: 1280, height: 720}, {width: 390, height: 760}]) {
    await page.setViewportSize(viewport);
    const overflow = await dialog.evaluate(el => Math.max(el.scrollWidth - el.clientWidth, el.scrollHeight - el.clientHeight));
    expect(overflow).toBeLessThanOrEqual(1);
    const bed = await page.getByLabel('Plateau au repos (°C)').boundingBox();
    const speed = await page.getByLabel('Vitesse cible (%)').boundingBox();
    expect(bed.x).toBeCloseTo(speed.x, 0);
  }
  await expect(page.locator('#idle-fan-current')).toContainText('10 %');
  await page.locator('#idle-fan-form select').selectOption('aux_fan_speed_pct');
  await expect(page.locator('#idle-fan-current')).toContainText('20 %');
  const target = page.getByLabel('Vitesse cible (%)');
  await expect(target).toHaveValue('');
  await target.fill('35');
  await page.getByRole('button', {name: 'Appliquer la ventilation'}).click();
  await expect(page.locator('#confirm-dialog')).toContainText('Régler le ventilateur « Auxiliaire » à 35 % ?');
  expect(sent).toHaveLength(0);
  await page.locator('#confirm-yes').click();
  await expect.poll(() => sent[0]).toMatchObject({action: 'idle-settings', aux_fan_speed_pct: '35'});
});
