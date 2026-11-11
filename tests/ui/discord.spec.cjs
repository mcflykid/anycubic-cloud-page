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

test('Discord et le TOTP partagent le quota des confirmations de session',async({page})=>{
  await login(page, 'summary');
  const origin=new URL(page.url()).origin;
  const headers={Origin:origin};
  for(let attempt=0;attempt<4;attempt+=1){
    const refused=await page.request.post('/imprimante-api/security',{
      headers,form:{stage:'prepare',password:'incorrect'},
    });
    expect(refused.status()).toBe(403);
  }
  const discord=await page.request.post('/imprimante-api/discord',{
    headers,form:{operation:'test',password:'incorrect'},
  });
  expect(discord.status()).toBe(403);
  const blocked=await page.request.post('/imprimante-api/discord',{
    headers,form:{operation:'test',password:'ui-fixture-password'},
  });
  expect(blocked.status()).toBe(429);
  expect(blocked.headers()['retry-after']).toBeTruthy();
});

test('les bilans et les alertes ont des réglages et des webhooks distincts', async ({page})=>{
  const alerts='https://discord.com/api/webhooks/12345678901234567/'+'a'.repeat(64);
  const reports='https://discord.com/api/webhooks/22345678901234567/'+'b'.repeat(64);
  await login(page,'summary');
  const headers={Origin:new URL(page.url()).origin};
  const endpoint='/imprimante-api/discord';
  const password='ui-fixture-password';
  const save=(path,url)=>page.request.post(path,{
    headers,form:{operation:'save',language:'fr',enabled:'on',url,password},
  });
  expect((await save(endpoint,alerts)).ok()).toBeTruthy();
  const duplicate=await save(endpoint+'/reports',alerts.replace(/a{64}$/,'c'.repeat(64)));
  expect(duplicate.status()).toBe(400);
  expect(await duplicate.text()).toContain('Choisissez deux webhooks Discord distincts.');
  expect((await save(endpoint+'/reports',reports)).ok()).toBeTruthy();
  await page.goto(endpoint);
  await expect(page.getByRole('checkbox',{name:'Activer les notifications Discord'})).toBeChecked();
  await page.getByRole('link',{name:'Configurer les bilans Discord'}).click();
  await expect(page.getByRole('heading',{name:'Bilans Discord'})).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'Activer les bilans Discord'})).toBeChecked();
  await expect(page.getByLabel('Adresse du webhook Discord')).toBeEmpty();
  expect(await page.content()).not.toContain(reports);
  expect(await page.content()).not.toContain(alerts);
  await page.getByLabel('Mot de passe web').fill(password);
  await page.getByRole('button',{name:'Envoyer un test'}).click();
  await expect(page.getByRole('status')).toHaveText('Message de test confirmé.');
  await page.getByLabel('Mot de passe web').fill(password);
  await page.getByRole('button',{name:'Supprimer le webhook'}).click();
  await expect(page.getByRole('checkbox',{name:'Activer les bilans Discord'})).not.toBeChecked();
  await page.getByRole('link',{name:'Configurer les notifications Discord'}).click();
  await expect(page.getByRole('checkbox',{name:'Activer les notifications Discord'})).toBeChecked();
  await page.getByLabel('Mot de passe web').fill(password);
  await page.getByRole('button',{name:'Supprimer le webhook'}).click();
});
