const {test,expect}=require('@playwright/test');

for (const failure of ['HTTP 503', 'coupure réseau']) {
  test(`un POST caméra incertain est envoyé une seule fois par clic (${failure})`, async ({page}) => {
    const {login} = require('./helpers.cjs');
    let calls = 0;
    // Le lecteur est chargé avant l’appel de session, même dans la démonstration.
    await page.route('**/imprimante-api/ui/js/agora-rtc.js', route => route.fulfill({
      contentType: 'application/javascript',
      body: 'window.AgoraRTC = { setLogLevel() {} };',
    }));
    await page.route('**/imprimante-api/camera-session', route => {
      expect(route.request().method()).toBe('POST');
      calls++;
      return failure === 'coupure réseau'
        ? route.abort('failed')
        : route.fulfill({status: 503, body: 'Panne simulée'});
    });
    await page.route('**/imprimante-api/camera-close', route => route.fulfill({json: {ok: true}}));
    await login(page);
    await expect(page.locator('#connection')).toHaveText('En ligne');
    await page.getByRole('button', {name: 'Caméra', exact: true}).click();
    await page.locator('#camera-start').click();
    await expect(page.locator('#camera-state')).toHaveText('Caméra indisponible');
    expect(calls).toBe(1);
  });
}

test('diagnostics caméra distincts, sans secret ni répétition automatique',async({page})=>{await page.route('**/js/agora-rtc.js',route=>route.fulfill({contentType:'application/javascript',body:"window.AgoraRTC={setLogLevel(){},createClient(){throw new Error('fixture-private-sdk-secret')}};"}));let reason='missing_credentials',calls=0;const messages={missing_credentials:'La réponse cloud ne contient pas les identifiants Agora nécessaires à la vidéo.',invalid_format:'Le cloud a renvoyé une session caméra de format invalide.',unsupported_transport:'Cette caméra utilise un transport vidéo non pris en charge par l’atelier (KVS).'};await page.route('**/imprimante-api/camera-session',route=>{calls++;return route.fulfill({status:reason?409:200,json:reason?{ok:false,message:messages[reason],camera_error:reason}:{appid:'fixture-app'}});});await page.goto('/login');await page.getByLabel('Identifiant').fill('admin');await page.getByLabel('Mot de passe').fill('ui-fixture-password');await page.getByRole('button',{name:'Se connecter',exact:true}).click();await expect(page.locator('#connection')).toHaveText('En ligne');await page.getByRole('button',{name:'Caméra',exact:true}).click();for(const [key,text] of Object.entries(messages)){reason=key;await page.locator('#camera-start').click();await expect(page.locator('#camera-state')).toHaveText(text);}expect(calls).toBe(3);reason='';await page.locator('#camera-start').click();await expect(page.locator('#camera-state')).toHaveText('Caméra indisponible');await expect(page.locator('#camera-state')).not.toHaveAttribute('data-tooltip',/fixture-private/);expect(calls).toBe(4);});

test('un abonnement vidéo tardif ne réactive pas le lecteur fermé',async({page})=>{
 const {login}=require('./helpers.cjs');
 const closes=[];
 await page.route('**/js/agora-rtc.js',route=>route.fulfill({
  contentType:'application/javascript',
  body:`window.playCalls=0;
   window.AgoraRTC={setLogLevel(){},createClient(){return {
    remoteUsers:[{hasVideo:true,videoTrack:{play(){window.playCalls++},stop(){}}}],
    on(){},setEncryptionConfig(){},async setClientRole(){},async join(){},async leave(){},
    subscribe(){return new Promise(resolve=>{window.releaseSubscribe=resolve;});}
   };}};`
 }));
 await page.route('**/imprimante-api/camera-session',route=>route.fulfill({json:{
  appid:'fixture-app',channel:'fixture-channel',rtc_token:'fixture-token',
  encryption_mode:'aes-128-gcm2',encryption_key:'fixture-key',encryption_kdf_salt:'Zml4dHVyZQ=='
 }}));
 await page.route('**/imprimante-api/camera-close',route=>{
  closes.push(route.request().headers()['x-camera-viewer']);
  return route.fulfill({json:{ok:true}});
 });
 await login(page);
 await page.getByRole('button',{name:'Caméra',exact:true}).click();
 await page.locator('#camera-start').click();
 await expect.poll(()=>page.evaluate(()=>typeof window.releaseSubscribe)).toBe('function');
 await page.getByRole('button',{name:'Fichiers',exact:true}).click();
 await expect.poll(()=>closes.length).toBe(1);
 await page.evaluate(()=>window.releaseSubscribe());
 await page.getByRole('button',{name:'Caméra',exact:true}).click();
 await expect(page.locator('#camera-state')).toHaveText('Caméra éteinte');
 expect(await page.evaluate(()=>window.playCalls)).toBe(0);
});

test('Agora renouvelle uniquement le canal et la session déjà ouverts', async ({page}) => {
  const {login} = require('./helpers.cjs');
  const session = {
    appid: 'fixture-app', channel: 'fixture-channel', client_uid: 1,
    rtc_token: 'fixture-token', encryption_mode: 'aes-128-gcm2',
    encryption_key: 'fixture-key', encryption_kdf_salt: 'Zml4dHVyZQ==',
  };
  let response = session;
  await page.route('**/js/agora-rtc.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.renewals = [];
      window.AgoraRTC = {setLogLevel(){}, createClient(){return {
        remoteUsers: [], setEncryptionConfig(){}, async setClientRole(){}, async join(){},
        async leave(){}, async renewToken(token){window.renewals.push(token);},
        on(event, callback){if(event === 'token-privilege-will-expire') window.expireCamera = callback;}
      };}};`,
  }));
  await page.route('**/imprimante-api/camera-session', (route) => route.fulfill({json: response}));
  await login(page);
  await page.getByRole('button', {name: 'Caméra', exact: true}).click();
  await page.locator('#camera-start').click();
  await expect(page.locator('#camera-state')).toHaveText('En attente de la vidéo');
  response = {...session, rtc_token: 'fixture-renewed'};
  await page.evaluate(() => window.expireCamera());
  expect(await page.evaluate(() => window.renewals)).toEqual(['fixture-renewed']);
  response = {...session, channel: 'other-channel', rtc_token: 'fixture-other'};
  await page.evaluate(() => window.expireCamera());
  await expect(page.locator('#camera-state')).toHaveText('Session caméra expirée');
  expect(await page.evaluate(() => window.renewals)).toEqual(['fixture-renewed']);
});

test('la présence caméra renouvelle le viewer sans redemander une session Cloud', async ({page}) => {
  const {login} = require('./helpers.cjs');
  let sessions = 0;
  const presences = [];
  await page.addInitScript(() => {
    const originalSet = window.setInterval.bind(window);
    const originalClear = window.clearInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      if (delay === 45000) {
        window.__cameraPresenceTick = () => callback(...args);
        return 987654;
      }
      return originalSet(callback, delay, ...args);
    };
    window.clearInterval = id => {
      if (id !== 987654) originalClear(id);
      else window.__cameraPresenceTick = null;
    };
  });
  await page.route('**/imprimante-api/ui/js/agora-rtc.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.AgoraRTC={setLogLevel(){},createClient(){return {
      remoteUsers:[],on(){},setEncryptionConfig(){},async setClientRole(){},async join(){},async leave(){},
    };}};`,
  }));
  await page.route('**/imprimante-api/camera-session', route => {
    sessions++;
    return route.fulfill({json:{
      appid:'fixture-app',channel:'fixture-channel',rtc_token:'fixture-token',
      encryption_mode:'aes-128-gcm2',encryption_key:'fixture-key',encryption_kdf_salt:'Zml4dHVyZQ=='
    }});
  });
  await page.route('**/imprimante-api/camera-presence', route => {
    presences.push(route.request().headers()['x-camera-viewer']);
    return route.fulfill({json:{ok:true}});
  });
  await page.route('**/imprimante-api/camera-close', route => route.fulfill({json:{ok:true}}));
  await login(page);
  await page.getByRole('button',{name:'Caméra',exact:true}).click();
  await page.locator('#camera-start').click();
  await expect(page.locator('#camera-state')).toHaveText('En attente de la vidéo');
  const viewer = await page.locator('#camera-start').evaluate(() => window.__cameraPresenceTick && true);
  expect(viewer).toBe(true);
  await page.evaluate(() => window.__cameraPresenceTick());
  await expect.poll(() => presences.length).toBe(1);
  expect(presences[0]).toMatch(/^[a-f0-9-]{36}$/);
  expect(sessions).toBe(1);
});

test('un viewer expiré se ferme sans réabonnement automatique', async ({page}) => {
  const {login} = require('./helpers.cjs');
  let sessions = 0;
  let releases = 0;
  await page.addInitScript(() => {
    const originalSet = window.setInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      if (delay === 45000) {
        window.__cameraPresenceTick = () => callback(...args);
        return 987654;
      }
      return originalSet(callback, delay, ...args);
    };
  });
  await page.route('**/imprimante-api/ui/js/agora-rtc.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.AgoraRTC={setLogLevel(){},createClient(){return {
      remoteUsers:[],on(){},setEncryptionConfig(){},async setClientRole(){},async join(){},async leave(){},
    };}};`,
  }));
  await page.route('**/imprimante-api/camera-session', route => {
    sessions++;
    return route.fulfill({json:{
      appid:'fixture-app',channel:'fixture-channel',rtc_token:'fixture-token',
      encryption_mode:'aes-128-gcm2',encryption_key:'fixture-key',encryption_kdf_salt:'Zml4dHVyZQ=='
    }});
  });
  await page.route('**/imprimante-api/camera-presence', route =>
    route.fulfill({status:400,json:{ok:false,message:'Session vidéo expirée'}}));
  await page.route('**/imprimante-api/camera-close', route => {
    releases++;
    return route.fulfill({json:{ok:true}});
  });
  await login(page);
  await page.getByRole('button',{name:'Caméra',exact:true}).click();
  await page.locator('#camera-start').click();
  await expect(page.locator('#camera-state')).toHaveText('En attente de la vidéo');
  await page.evaluate(() => window.__cameraPresenceTick());
  await expect(page.locator('#camera-state')).toHaveText('Session caméra expirée');
  expect(sessions).toBe(1);
  expect(releases).toBe(1);
});

test('la déconnexion attend la confirmation de fermeture du viewer caméra',async({page})=>{
 // La réponse différée démontre l’ordre entre la libération du lecteur et la révocation.
 const {login}=require('./helpers.cjs');
 const order=[];
 let finishClose;
 let onCloseStarted;
 const closeStarted=new Promise(resolve=>{onCloseStarted=resolve;});
 const closeGate=new Promise(resolve=>{finishClose=resolve;});
 await page.route('**/imprimante-api/ui/js/agora-rtc.js',route=>route.fulfill({
  contentType:'application/javascript',
  body:`window.AgoraRTC={setLogLevel(){},createClient(){return {
   remoteUsers:[],on(){},setEncryptionConfig(){},async setClientRole(){},async join(){},async leave(){},
  };}};`,
 }));
 await page.route('**/imprimante-api/camera-session',route=>route.fulfill({json:{
  appid:'fixture-app',channel:'fixture-channel',rtc_token:'fixture-token',
  encryption_mode:'aes-128-gcm2',encryption_key:'fixture-key',encryption_kdf_salt:'Zml4dHVyZQ=='
 }}));
 await page.route('**/imprimante-api/camera-close',async route=>{
  order.push('camera-close');
  onCloseStarted();
  await closeGate;
  await route.fulfill({status:202,json:{ok:true}});
  order.push('camera-close-ack');
 });
 await page.route('**/logout',async route=>{
  order.push('logout');
  await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Session terminée</title>'});
 });
 await login(page);
 await page.getByRole('button',{name:'Caméra',exact:true}).click();
 await page.locator('#camera-start').click();
 await expect(page.locator('#camera-state')).toHaveText('En attente de la vidéo');
 await page.locator('#camera-stop').click();
 await closeStarted;
 await expect(page.locator('#camera-state')).toHaveText('Caméra éteinte');
 await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();
 await page.locator('.logout-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 await page.waitForTimeout(150);
 expect(order).toEqual(['camera-close']);
 finishClose();
 await expect.poll(()=>order.includes('logout')).toBe(true);
 expect(order).toEqual(['camera-close','camera-close-ack','logout']);
 await expect(page).toHaveTitle('Session terminée');
});
