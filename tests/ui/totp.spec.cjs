/** Vérifie les formulaires de sécurité sur le serveur de démonstration. */
const {createHmac}=require('node:crypto');
const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

/** Calcule le code d’activation de la clé fictive affichée dans le test. */
function activationCode(secret) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits=[...secret].map(char=>alphabet.indexOf(char).toString(2).padStart(5,'0')).join('');
  const key=Buffer.from(bits.match(/.{8}/g).map(byte=>parseInt(byte,2)));
  const step=Buffer.alloc(8);
  step.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1',key).update(step).digest();
  return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1_000_000).padStart(6,'0');
}

test('l’atelier active le facteur et se reconnecte avec un secours',async({page})=>{
  await login(page);
  await page.locator('[data-tab=settings]').click();
  await page.getByRole('link',{name:'Configurer la connexion à deux facteurs'}).click();
  await page.getByLabel('Mot de passe web').fill('ui-fixture-password');
  await page.getByRole('button',{name:'Préparer l’activation'}).click();
  await expect(page.getByRole('img',{name:'QR d’activation du facteur temporaire'})).toHaveJSProperty('complete',true);
  const key=await page.locator('main code').textContent();
  await page.getByLabel('Mot de passe web').fill('ui-fixture-password');
  await page.getByLabel('Premier code temporaire').fill(activationCode(key));
  await page.getByRole('button',{name:'Activer le facteur',exact:true}).click();
  await expect(page.locator('main li code')).toHaveCount(10);
  const recovery=await page.locator('main li code').first().textContent();

  const visitor=await page.context().browser().newContext({baseURL:new URL(page.url()).origin});
  try {
    const guest=await visitor.newPage();
    await guest.goto('/login');
    await guest.getByLabel('Identifiant').fill('admin');
    await guest.getByLabel('Mot de passe',{exact:true}).fill('ui-fixture-password');
    await guest.getByRole('button',{name:'Se connecter',exact:true}).click();
    await expect(guest.getByRole('heading',{name:'Vérifier la connexion'})).toBeVisible();
    const card = guest.locator('.login-card');
    for (const width of [1440, 390]) {
      await guest.setViewportSize({width, height:844});
      const bounds = await card.boundingBox();
      expect(bounds.x + bounds.width / 2).toBeCloseTo(width / 2, 0);
    }
    expect((await guest.request.get('/imprimante-api/status')).status()).toBe(401);
    await guest.getByLabel('Code temporaire ou de secours').fill(recovery);
    await guest.getByRole('button',{name:'Vérifier le code'}).click();
    await expect(guest.locator('#printer-model')).toBeVisible();
  } finally {
    await visitor.close();
    // Rétablit l’état initial du serveur de démonstration partagé par la suite Playwright.
    await page.goto('/imprimante-api/security');
    await page.getByLabel('Mot de passe web').fill('ui-fixture-password');
    await page.getByRole('button',{name:'Désactiver le facteur'}).click();
    await expect(page.getByText('La connexion à deux facteurs est désactivée.')).toBeVisible();
  }
});
