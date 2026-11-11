const {test, expect}=require('@playwright/test');
const {login, openSection}=require('./helpers.cjs');

test('le conseil de fichiers s’ouvre au clavier et se masque sans envoyer de commande', async ({page})=>{
  const writes=[];
  await login(page);
  await page.evaluate(()=>localStorage.setItem('cloud-page-language','es'));
  await page.reload();
  page.on('request', request=>{
    const route=new URL(request.url()).pathname;
    // La lecture des miniatures utilise POST sans commande ni écriture.
    if(request.method()==='POST' && route.startsWith('/imprimante-api/') && route!=='/imprimante-api/preview')writes.push(route);
  });
  await openSection(page,'files');
  const help=page.locator('.file-format-help');
  const toggle=help.locator('summary');
  await expect(toggle).toHaveText('¿Cómo reconozco un archivo listo para imprimir?');
  await expect(help.locator('p').first()).toBeHidden();
  await toggle.focus();
  await toggle.press('Enter');
  await expect(help.locator('p').first()).toBeVisible();
  await toggle.press('Space');
  await expect(help.locator('p').first()).toBeHidden();
  await openSection(page,'overview');
  await expect(help).toBeHidden();
  expect(writes).toEqual([]);
});
