const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('les fichiers gardent les commandes et le tableau dans la largeur disponible',async({page})=>{
  await page.setViewportSize({width:1440,height:800});
  await login(page,'files');
  await page.locator('[data-source=cloud]').click();
  await expect(page.locator('#files-title')).toHaveText('Cloud Anycubic');
  await expect(page.locator('#file-rows tr').first()).toBeVisible();
  await expect(page.locator('#cloud-quota')).toHaveText('184 Mo sur 2 Go');
  const selectors=['#files-form .files-sources','#cloud-folder','#files-search','#files-sort'];
  const controls=await Promise.all(selectors.map(selector=>page.locator(selector).boundingBox()));
  expect(new Set(controls.map(control=>control.height))).toEqual(new Set([36]));
  expect(new Set(controls.map(control=>control.y))).toHaveProperty('size',1);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
