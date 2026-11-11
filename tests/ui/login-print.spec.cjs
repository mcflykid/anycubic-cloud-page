// Vérifie la scène de connexion dans les variantes de l’atelier et au changement de visibilité.
const {test,expect}=require('@playwright/test');

const styles=['standard','apple','detailed','blueprint','aurora','ocean','lab'];

for (const color of ['light','dark']) {
  test(`la scène fixe laisse le formulaire utilisable en mode ${color}`,async({page})=>{
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto('/login');
    for (const style of styles) {
      await page.evaluate(({style,color})=>{
        localStorage.setItem('cloud-page-style',style);
        localStorage.setItem('cloud-page-theme',color);
      },{style,color});
      await page.goto('/login');
      await expect(page.locator('html')).toHaveAttribute('data-style',style);
      await expect(page.locator('html')).toHaveAttribute('data-theme',color);
      await expect(page.locator('.login-print-scene')).toHaveAttribute('aria-hidden','true');
      await expect(page.locator('.print-head')).toHaveCSS('animation-name','none');
      await expect(page.locator('.print-layers use').last()).toHaveCSS('opacity','1');
      for (const [width,height] of [[1366,768],[390,844]]) {
        await page.setViewportSize({width,height});
        await expect(page.getByLabel('Mot de passe',{exact:true})).toBeInViewport();
        await expect(page.getByRole('button',{name:'Se connecter',exact:true})).toBeInViewport();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    }
  });
}

test('le dépôt est suspendu dans une page masquée et reprend à son retour',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/login');
  const head=page.locator('.print-head');
  await expect(head).toHaveCSS('animation-name','print-traverse');
  for (const hidden of [true,false]) {
    await page.evaluate(hidden=>{
      Object.defineProperty(document,'hidden',{configurable:true,value:hidden});
      document.dispatchEvent(new Event('visibilitychange'));
    },hidden);
    await expect(head).toHaveCSS('animation-play-state',hidden?'paused':'running');
  }
});
