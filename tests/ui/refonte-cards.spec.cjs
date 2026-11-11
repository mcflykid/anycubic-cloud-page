const {test,expect}=require('@playwright/test');
const {login,openSection}=require('./helpers.cjs');

test('les paires de cartes partagent les mêmes largeurs, hauteurs et séparations', async ({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await login(page,'summary');
  await expect(page.locator('#summary-ace-boxes .summary-ace-device')).toBeVisible();
  const pairs=[
    ['summary', '#tab-summary .atelier-summary-grid'],
    ['settings', '#tab-settings .atelier-settings-row'],
  ];
  for(const [section,selector] of pairs){
    if(section==='settings')await openSection(page,section);
    const groups=page.locator(selector);
    for(const group of await groups.all()){
      const cards=await group.locator(':scope > .atelier-card').evaluateAll(items=>items.map(item=>{
        const r=item.getBoundingClientRect();
        return {
          width:r.width,height:r.height,y:r.y,
          header:item.querySelector('header').getBoundingClientRect().bottom,
          footer:item.querySelector('footer')?.getBoundingClientRect().top,
        };
      }));
      expect(cards[0]).toEqual(cards[1]);
    }
  }
  const buttons=await page.locator('.settings-follow-actions button').evaluateAll(items=>items.map(item=>{
    const {width,height,y}=item.getBoundingClientRect();
    return {width,height,y};
  }));
  expect(buttons.every(button=>button.height===36&&Math.abs(button.width-buttons[0].width)<1&&button.y===buttons[0].y)).toBe(true);
});

test('le résumé garde le nom long et les huit bobines dans les limites de la page', async ({page})=>{
  await page.route('**/imprimante-api/status', async route=>{
    const response=await route.fetch(), json=await response.json();
    json.printer.job_name='fichier_'+('exempleTrèsLong'.repeat(14))+'.gcode';
    const first = json.printer.boxes[0];
    json.printer.boxes.push({
      ...first,
      box_id: 1,
      spools: first.spools.map((spool) => ({ ...spool, display_slot: spool.display_slot + 4 })),
    });
    await route.fulfill({response,json});
  });
  await login(page,'summary');
  await expect(page.locator('.summary-spools > li')).toHaveCount(8);
  await expect(page.locator('.summary-spools > li').last()).toContainText('8 · PLA');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
