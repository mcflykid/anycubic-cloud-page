const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('la chronologie regroupe les heures et donne un repère accessible à chaque phase', async ({page}) => {
 const entries=[
  {kind:'preheating',time:Date.parse('2026-11-13T22:50:00Z')/1000},
  {kind:'printing',time:Date.parse('2026-11-13T22:55:00Z')/1000},
  {kind:'paused',time:Date.parse('2026-11-14T00:15:00Z')/1000},
 ];
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch(), data=await response.json();
  data.printer.print_timeline=entries;
  await route.fulfill({json:data});
 });
 await login(page);
 await page.locator('#printer-timeline-open').click();
 const timeline=page.locator('#printer-timeline');
 await expect(timeline.locator('.timeline-day')).toHaveCount(2);
 await expect(timeline.locator('ol').first().locator('li')).toHaveCount(2);
 await expect(timeline.locator('ol').last().locator('li')).toHaveCount(1);
 await expect(timeline.locator('li time')).toHaveCount(3);
 const markers=timeline.getByRole('button');
 await expect(markers).toHaveCount(3);
 const paths=await markers.locator('svg path').evaluateAll(nodes=>nodes.map(path=>path.getAttribute('d')));
 expect(new Set(paths).size).toBe(3);
 await markers.first().focus();
 await page.keyboard.press('ArrowRight');
 await expect(markers.nth(1)).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(timeline.locator('li').nth(1)).toBeFocused();
});
