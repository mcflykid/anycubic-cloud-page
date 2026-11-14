/** Vérifie les réglages Discord avec le transport fictif de l’atelier. */
const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('Discord se configure, se teste et se retire sans réafficher le webhook',async({page})=>{
  const fixture='https://discord.com/api/webhooks/12345678901234567/'+'a'.repeat(64);
  await login(page);
  await page.locator('[data-tab=settings]').click();
  await page.getByRole('link',{name:'Configurer les notifications Discord'}).click();
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:'dark'});
  const password=page.getByLabel('Mot de passe web');
  const address=page.getByLabel('Adresse du webhook Discord');
  const enabled=page.getByRole('checkbox',{name:'Activer les alertes'});
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
  const saveRequest=page.waitForRequest(request=>request.url().endsWith('/imprimante-api/discord')&&request.method()==='POST');
  await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
  expect(new URLSearchParams((await saveRequest).postData()).get('url')).toBe(fixture);
  await expect(page.getByRole('status')).toHaveText('Réglage Discord enregistré.');
  await expect(enabled).toBeChecked();
  await expect(page.locator('.discord-configured')).toHaveAttribute('data-configured','true');
  await expect(address).toBeEmpty();
  const checkbox=await enabled.boundingBox();
  const label=await page.getByText('Activer les alertes',{exact:true}).boundingBox();
  expect(checkbox.width).toBeLessThan(26);
  expect(label.x-checkbox.x-checkbox.width).toBeLessThan(20);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.content()).not.toContain(fixture);
  await password.fill('ui-fixture-password');
  await page.getByRole('button',{name:'Supprimer le webhook'}).click();
  await expect(page.getByRole('status')).toHaveText('Webhook supprimé.');
  await expect(enabled).not.toBeChecked();
  await expect(page.locator('#discord-reveal')).toBeDisabled();
  expect(await page.locator('.discord-configured').getAttribute('data-configured')).toBe('false');
  const absent=await page.request.post('/imprimante-api/discord?operation=reveal',{
    headers:{Origin:new URL(page.url()).origin},form:{operation:'reveal',password:'ui-fixture-password'},
  });
  expect(absent.status()).toBe(404);
  expect(absent.headers()['cache-control']).toBe('no-store');
  await page.getByRole('link',{name:'Notifications',exact:true}).click();
  await expect(page.locator('#notifications-panel')).toBeVisible();
});

test('un webhook fictif est absent au chargement et sa révélation revalide le mot de passe',async({page})=>{
  const fixture='https://discord.com/api/webhooks/12345678901234567/'+'d'.repeat(64);
  await login(page,'summary');
  const headers={Origin:new URL(page.url()).origin};
  const saved=await page.request.post('/imprimante-api/discord',{
    headers,form:{operation:'save',language:'fr',url:fixture,password:'ui-fixture-password'},
  });
  expect(saved.ok()).toBeTruthy();
  const retained=await page.request.post('/imprimante-api/discord',{
    headers,form:{operation:'save',language:'fr',enabled:'on',password:'ui-fixture-password'},
  });
  expect(retained.ok()).toBeTruthy();
  await page.goto('/imprimante-api/discord');
  const address=page.getByLabel('Adresse du webhook Discord');
  const password=page.getByLabel('Mot de passe web');
  const reveal=page.getByRole('button',{name:'Afficher l’adresse du webhook'});
  await expect(address).toBeEmpty();
  expect(await page.content()).not.toContain(fixture);
  expect((await page.request.get('/imprimante-api/discord')).headers()['cache-control']).toBe('no-store');
  await reveal.click();
  await expect(page.getByRole('status')).toContainText('Saisissez le mot de passe web');
  await password.fill('bad-fixture-password');
  const refused=page.waitForResponse(response=>response.url().includes('operation=reveal'));
  await reveal.click();
  const refusedResponse=await refused;
  expect(refusedResponse.status()).toBe(403);
  expect(refusedResponse.headers()['cache-control']).toBe('no-store');
  await expect(page.getByRole('status')).toContainText('Mot de passe web incorrect.');
  await expect(address).toBeEmpty();
  expect(await page.content()).not.toContain(fixture);
  await password.fill('ui-fixture-password');
  const revealed=page.waitForResponse(response=>response.url().includes('operation=reveal'));
  await reveal.click();
  const revealResponse=await revealed;
  expect(revealResponse.ok()).toBeTruthy();
  expect(revealResponse.headers()['cache-control']).toBe('no-store');
  await expect(address).toHaveValue(fixture);
  await expect(address).toHaveAttribute('type','text');
  await expect(password).toBeEmpty();
  await page.getByRole('button',{name:'Masquer l’adresse du webhook'}).click();
  await expect(address).toHaveAttribute('type','password');
  await expect(address).toBeEmpty();
  expect(await address.getAttribute('placeholder')).toMatch(/^•+$/);
  await password.fill('ui-fixture-password');
  let nextReveal=page.waitForResponse(response=>response.url().includes('operation=reveal'));
  await reveal.click(); await nextReveal;
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(address).toBeEmpty();
  await expect(address).toHaveAttribute('type','password');
  await password.fill('ui-fixture-password');
  nextReveal=page.waitForResponse(response=>response.url().includes('operation=reveal'));
  await reveal.click(); await nextReveal;
  await password.fill('ui-fixture-password');
  const unchangedSaveRequest=page.waitForRequest(request=>request.url().endsWith('/imprimante-api/discord')&&request.method()==='POST');
  await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
  expect(new URLSearchParams((await unchangedSaveRequest).postData()).get('url')).toBe('');
  await expect(page.getByRole('status')).toHaveText('Réglage Discord enregistré.');
  expect(await page.content()).not.toContain(fixture);
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
  await page.goto('/imprimante.html');
  await page.locator('[data-tab=settings]').click();
  const card=page.getByRole('region',{name:'Notifications Discord'});
  // L’état n’est plus écrit à l’écran : seul le témoin reste visible, le texte est conservé pour l’accessibilité.
  const dots = card.locator('.settings-status-dot');
  await expect(dots).toHaveCount(2);
  await expect(dots.nth(0)).toHaveAttribute('data-state','normal');
  await expect(dots.nth(0)).toHaveText('Activées');
  await expect(dots.nth(1)).toHaveAttribute('data-state','normal');
  await expect(dots.nth(1)).toHaveText('Activés');
  await card.getByRole('link',{name:'Configurer les bilans Discord'}).click();
  await expect(page.getByRole('heading',{name:'Bilans Discord'})).toBeVisible();
  await page.getByRole('link',{name:'Configurer les notifications Discord'}).click();
  await expect(page.getByRole('checkbox',{name:'Activer les alertes'})).toBeChecked();
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
  await expect(page.getByRole('checkbox',{name:'Activer les alertes'})).toBeChecked();
  await page.getByLabel('Mot de passe web').fill(password);
  await page.getByRole('button',{name:'Supprimer le webhook'}).click();
});
