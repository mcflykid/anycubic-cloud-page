const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('le parc distingue les machines suivies sans offrir de commande',async({page})=>{
  let commands=0;
  await page.route('**/imprimante-api/command',route=>{commands++;return route.abort();});
  await login(page);
  await page.locator('[data-tab=fleet]').click();
  await expect(page.locator('#fleet-cards article')).toHaveCount(2);
  await expect(page.locator('#fleet-cards')).toContainText('Pas encore suivie');
  await expect(page.locator('#fleet-cards button, #fleet-cards a')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  const summary=page.locator('.fleet-summary').first();
  const centers=await summary.locator(':scope > *').evaluateAll(parts=>parts.map(part=>{
    const rect=part.getBoundingClientRect();
    return rect.top+rect.height/2;
  }));
  expect(Math.max(...centers)-Math.min(...centers)).toBeLessThan(2);
  expect(commands).toBe(0);
});

test('un échec de résumé retire les anciennes cartes',async({page})=>{
  await login(page);
  await page.locator('[data-tab=fleet]').click();
  await expect(page.locator('#fleet-cards article')).toHaveCount(2);
  await page.route('**/imprimante-api/fleet',route=>route.fulfill({status:503,json:{ok:false}}));
  await page.locator('[data-tab=overview]').click();
  await page.locator('[data-tab=fleet]').click();
  await expect(page.locator('#fleet-state')).toContainText('temporairement indisponible');
  await expect(page.locator('#fleet-cards article')).toHaveCount(0);
});

test('la période 30 jours exporte les moyennes affichées en CSV',async({page})=>{
  await login(page);
  await page.locator('[data-tab=statistics]').click();
  await page.locator('#temperature-hours').selectOption('720');
  await expect(page.locator('#temperature-note')).toContainText('moyennes horaires sur 30 jours');
  await page.setViewportSize({width:390,height:844});
  const [period,exportButton]=await Promise.all([
    page.locator('#temperature-hours').boundingBox(),page.locator('#temperature-export').boundingBox(),
  ]);
  expect(Math.abs(period.y-exportButton.y)).toBeLessThan(3);
  expect(period.x+period.width).toBeLessThan(exportButton.x);
  const download=page.waitForEvent('download');
  await page.locator('#temperature-export').click();
  const file=await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  await expect(page.locator('#temperature-export-state')).toContainText('Export CSV téléchargé');
});
