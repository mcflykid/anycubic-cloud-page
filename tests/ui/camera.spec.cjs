const {test,expect}=require('@playwright/test');
test('diagnostics caméra distincts, sans secret ni répétition automatique',async({page})=>{await page.route('**/js/agora-rtc.js',route=>route.fulfill({contentType:'application/javascript',body:"window.AgoraRTC={setLogLevel(){},createClient(){throw new Error('fixture-private-sdk-secret')}};"}));let reason='missing_credentials',calls=0;const messages={missing_credentials:'La réponse cloud ne contient pas les identifiants Agora nécessaires à la vidéo.',invalid_format:'Le cloud a renvoyé une session caméra de format invalide.',unsupported_transport:'Cette caméra utilise un transport vidéo non pris en charge par l’atelier (KVS).'};await page.route('**/imprimante-api/camera-session',route=>{calls++;return route.fulfill({status:reason?409:200,json:reason?{ok:false,message:messages[reason],camera_error:reason}:{appid:'fixture-app'}});});await page.goto('/login');await page.getByLabel('Identifiant').fill('admin');await page.getByLabel('Mot de passe').fill('ui-fixture-password');await page.getByRole('button',{name:'Se connecter',exact:true}).click();await page.getByRole('button',{name:'Caméra',exact:true}).click();for(const [key,text] of Object.entries(messages)){reason=key;await page.locator('#camera-start').click();await expect(page.locator('#camera-state')).toHaveText(text);}expect(calls).toBe(3);reason='';await page.locator('#camera-start').click();await expect(page.locator('#camera-state')).toHaveText('Caméra indisponible');await expect(page.locator('#camera-state')).not.toHaveAttribute('data-tooltip',/fixture-private/);expect(calls).toBe(4);});

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
