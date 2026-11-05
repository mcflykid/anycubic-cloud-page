const {test,expect}=require('@playwright/test');
/** Isole chaque scénario sur le serveur fictif pour ne jamais toucher au cloud. */
async function openWorkshop(page){await page.goto('/login');await page.getByLabel('Identifiant').fill('admin');await page.getByLabel('Mot de passe').fill('ui-fixture-password');await page.getByRole('button',{name:'Se connecter',exact:true}).click();const reset=await page.request.post('/imprimante-api/demo/reset',{data:{},headers:{Origin:new URL(page.url()).origin}});expect(reset.status()).toBe(200);await page.reload();await expect(page.locator('#notifications-dot')).toBeVisible();}
test('cloche, filtres, recherche, lecture et clavier sans boucle supplémentaire',async({page})=>{await openWorkshop(page);let historyReads=0;page.on('request',r=>{if(/\/history\?/.test(r.url()))historyReads++;});const bell=page.locator('#notifications-toggle');await bell.click();await expect(bell).toHaveAttribute('aria-expanded','true');await expect(page.locator('#notifications-title')).toHaveText('Messages (2)');await expect(page.locator('.notification-row')).toHaveCount(3);await page.getByRole('button',{name:'Non lu',exact:true}).click();await expect(page.locator('.notification-row')).toHaveCount(2);await page.getByRole('button',{name:'Lu',exact:true}).click();await expect(page.locator('.notification-row')).toHaveCount(1);await page.getByRole('button',{name:'Tous',exact:true}).click();await page.locator('#notification-search').fill('Boîte');await expect(page.locator('.notification-row')).toHaveCount(1);await page.locator('.notification-open').click();await expect(page.locator('#notification-preview-dialog')).toBeVisible();await expect(page.locator('#notifications-title')).toHaveText('Messages (1)');await page.keyboard.press('Escape');await expect(page.locator('#notification-preview-dialog')).toBeHidden();await page.getByRole('button',{name:'Tout marquer comme lu',exact:true}).click();await expect(page.locator('#notifications-title')).toHaveText('Messages (0)');await expect(page.locator('#notifications-dot')).toBeHidden();await page.keyboard.press('Escape');await expect(bell).toBeFocused();await expect(bell).toHaveAttribute('aria-expanded','false');expect(historyReads).toBe(1);});
test('suppression de messages confirmée et historique des impressions conservé',async({page})=>{await openWorkshop(page);await page.locator('#notifications-toggle').click();await page.getByRole('button',{name:'Supprimer la notification : Cube de calibration.gcode',exact:true}).click();await expect(page.locator('#confirm-dialog')).toBeVisible();await page.locator('#confirm-no').click();await expect(page.locator('.notification-row')).toHaveCount(3);await page.getByRole('button',{name:'Supprimer la notification : Cube de calibration.gcode',exact:true}).click();await page.locator('#confirm-yes').click();await expect(page.locator('.notification-row')).toHaveCount(2);await page.locator('#history-delete-all').click();await page.locator('#confirm-yes').click();await expect(page.getByText('Aucun message',{exact:true})).toBeVisible();await expect(page.locator('.notification-row')).toHaveCount(0);const tasks=await page.request.get('/imprimante-api/extras/tasks');expect((await tasks.json()).items).toHaveLength(3);const physical=await page.request.post('/imprimante-api/command',{data:{action:'cancel'},headers:{Origin:new URL(page.url()).origin}});expect(physical.status()).toBe(403);});
test('panneau mobile sans débordement et fermeture extérieure',async({page})=>{await page.setViewportSize({width:390,height:844});await openWorkshop(page);await page.locator('#notifications-toggle').click();const box=await page.locator('#notifications-panel').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);await page.locator('h1').click();await expect(page.locator('#notifications-panel')).toBeHidden();});

test('un rafraîchissement de l’historique conserve les aperçus de la cloche',async({page})=>{
 await page.addInitScript(()=>{
  const observers=[];
  window.IntersectionObserver=class {
   constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}
   observe(target){this.targets.add(target);}
   unobserve(target){this.targets.delete(target);}
   disconnect(){this.targets.clear();}
  };
  window.deliverVisiblePreviews=()=>{
   for(const observer of observers){
    const targets=[...observer.targets].filter(target=>target.closest('.notification-row'));
    observer.callback(targets.map(target=>({target,isIntersecting:true})),observer);
   }
  };
 });
 await openWorkshop(page);
 await page.locator('#notifications-toggle').click();
 await expect(page.locator('.notification-row')).toHaveCount(3);
 await page.evaluate(()=>{renderTasks();window.deliverVisiblePreviews();});
 await expect(page.locator('.notification-row img').first()).toBeVisible();
});
