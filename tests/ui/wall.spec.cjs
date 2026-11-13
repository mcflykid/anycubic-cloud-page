const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('la vue mur affiche les relevés et ne déclenche aucune commande', async ({page}) => {
 const writes = [];
 await login(page,'summary');
 page.on('request', request => {
  if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
 });
 await page.getByRole('link',{name:'Vue mur'}).click();
 await expect(page).toHaveURL(/\/imprimante-api\/ui\/mur$/);
 await expect(page.locator('#wall-printer')).toHaveText('Kobra S1 · Démonstration');
 await expect(page.locator('#wall-ace')).toContainText('ACE 2 Pro');
 await expect(page.locator('#wall-progress-text')).toHaveText('100 %');
 await expect(page.locator('#wall-preview')).toBeVisible();
 await page.setViewportSize({width:800,height:1280});
 expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(800);
 expect([...new Set(writes)]).toEqual(['/imprimante-api/preview']);
});

test('la vue mur revient à l’aperçu après l’arrêt du lecteur partagé', async ({page}) => {
 await login(page,'summary');
 const publisher = await page.context().newPage();
 await publisher.goto('/imprimante.html');
 await publisher.evaluate(() => {
  const channel = new BroadcastChannel('cloud-page-wall-camera');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  channel.onmessage = ({data}) => {
   if (data.kind === 'request') channel.postMessage({...data, kind:'frame', image:canvas.toDataURL('image/jpeg')});
  };
 });
 await page.goto('/mur');
 await expect(page.locator('#wall-camera')).toBeVisible();
 await expect(page.locator('#wall-preview')).toBeHidden();
 await publisher.close();
 await expect(page.locator('#wall-camera')).toBeHidden();
 await expect(page.locator('#wall-preview')).toBeVisible();
});
