const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('l’aperçu courant utilise sa référence de projet pour un lancement depuis la machine',async({page})=>{
  const requests=[];
  await page.route('**/imprimante-api/status',async route=>{
    const response=await route.fetch(),data=await response.json();
    data.printer.job_name='.3mf_temp/fixture.gcode.3mf';
    data.printer.command_project='a'.repeat(20);
    await route.fulfill({json:data});
  });
  await page.route('**/imprimante-api/preview',async route=>{
    requests.push(route.request().postDataJSON());
    const response=await route.fetch();await route.fulfill({response});
  });
  await login(page);
  await expect(page.locator('#job-preview')).toBeVisible();
  expect(requests[0]).toEqual({source:'active',project_key:'a'.repeat(20)});
});

test('Prisme révèle l’aperçu seulement après le chargement de l’image',async({page})=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.addInitScript(()=>localStorage.setItem('cloud-page-style','prism'));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.route('**/imprimante-api/preview', route=>route.fulfill({
    json:{image:'/imprimante-api/ui/icons/fixture-current-preview.svg'},
  }));
  await page.route('**/imprimante-api/ui/icons/fixture-current-preview.svg',async route=>{
    await gate;
    await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="navy"/></svg>'});
  });
  await login(page);
  const preview=page.locator('#job-preview'), state=page.locator('#job-preview-state');
  try {
    await expect(preview).toHaveAttribute('src',/fixture-current-preview/);
    await expect(preview).toBeHidden();
    await expect(state).toHaveAttribute('aria-busy','true');
  } finally {
    release();
  }
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS('animation-name','prism-preview-reveal');
  await expect(state).toBeHidden();
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(preview).toHaveCSS('animation-name','none');
});

test('une image reçue mais illisible reste masquée avec son état d’erreur',async({page})=>{
  await page.route('**/imprimante-api/preview', route=>route.fulfill({
    json:{image:'/imprimante-api/ui/icons/fixture-broken-preview.svg'},
  }));
  await page.route('**/imprimante-api/ui/icons/fixture-broken-preview.svg', route=>route.fulfill({status:404}));
  await login(page);
  await expect(page.locator('#job-preview-state')).toHaveText('Aperçu indisponible');
  await expect(page.locator('#job-preview')).toBeHidden();
  await expect(page.locator('#summary-preview')).toHaveAttribute('hidden','');
});
