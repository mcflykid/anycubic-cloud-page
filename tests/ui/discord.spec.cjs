/** Vérifie les réglages Discord avec le transport fictif de l’atelier. */
const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('Discord se configure, se teste et se retire sans réafficher le webhook',async({page})=>{
  const fixture='https://discord.com/api/webhooks/12345678901234567/'+'a'.repeat(64);
  await login(page);
  await page.locator('[data-tab=settings]').click();
  await page.getByRole('link',{name:'Configurer les notifications Discord'}).click();
  const password=page.getByLabel('Mot de passe web');
  const address=page.getByLabel('Adresse du webhook Discord');
  const enabled=page.getByRole('checkbox',{name:'Activer les notifications Discord'});
  await expect(enabled).not.toBeChecked();
  await address.fill(fixture);
  await password.fill('ui-fixture-password');
  await page.getByRole('button',{name:'Envoyer un test'}).click();
  await expect(page.getByRole('status')).toHaveText('Message de test confirmé.');
  await expect(address).toBeEmpty();
  await expect(enabled).not.toBeChecked();
  await address.fill(fixture);
  await enabled.check();
  await password.fill('ui-fixture-password');
  await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Réglage Discord enregistré.');
  await expect(enabled).toBeChecked();
  await expect(address).toBeEmpty();
  expect(await page.content()).not.toContain(fixture);
  await password.fill('ui-fixture-password');
  await page.getByRole('button',{name:'Supprimer le webhook'}).click();
  await expect(page.getByRole('status')).toHaveText('Webhook supprimé.');
  await expect(enabled).not.toBeChecked();
});
