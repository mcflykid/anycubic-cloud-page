const {test,expect}=require('@playwright/test');
const {openSection}=require('./helpers.cjs');

/** Ouvre le journal à partir de l’onglet Historique. */
async function openHistoryJournal(page) {
 await openSection(page,'history');
 await page.getByRole('button',{name:'Journal des notifications',exact:true}).click();
}
/** Isole chaque scénario sur le serveur fictif pour ne jamais toucher au cloud. */
async function openWorkshop(page){await page.goto('/login');await page.getByLabel('Identifiant').fill('admin');await page.getByLabel('Mot de passe').fill('ui-fixture-password');await page.getByRole('button',{name:'Se connecter',exact:true}).click();const reset=await page.request.post('/imprimante-api/demo/reset',{data:{},headers:{Origin:new URL(page.url()).origin}});expect(reset.status()).toBe(200);await page.reload();await expect(page.locator('#notifications-dot')).toBeVisible();}
test('journal historique, filtres et lecture sans changer la cloche Cloud',async({page})=>{await openWorkshop(page);let historyReads=0;page.on('request',r=>{if(/\/history\?/.test(r.url()))historyReads++;});await openHistoryJournal(page);await expect(page.locator('#historical-notifications-dialog')).toBeVisible();await expect(page.locator('#notifications-title')).toHaveText('Messages (2)');await expect(page.locator('.notification-row')).toHaveCount(3);await page.getByRole('button',{name:'Non lu',exact:true}).click();await expect(page.locator('.notification-row')).toHaveCount(2);await page.getByRole('button',{name:'Lu',exact:true}).click();await expect(page.locator('.notification-row')).toHaveCount(1);await page.getByRole('button',{name:'Tous',exact:true}).click();await page.locator('#notification-search').fill('Boîte');await expect(page.locator('.notification-row')).toHaveCount(1);await page.locator('.notification-open').click();await expect(page.locator('#notification-preview-dialog')).toBeVisible();await expect(page.locator('#notifications-title')).toHaveText('Messages (1)');await page.keyboard.press('Escape');await expect(page.locator('#notification-preview-dialog')).toBeHidden();await page.getByRole('button',{name:'Tout marquer comme lu',exact:true}).click();await expect(page.locator('#notifications-title')).toHaveText('Messages (0)');await expect(page.locator('#notifications-dot')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#historical-notifications-open')).toBeFocused();expect(historyReads).toBe(2);});
test('suppression de messages confirmée et historique des impressions conservé',async({page})=>{await openWorkshop(page);await openHistoryJournal(page);await page.getByRole('button',{name:'Supprimer la notification : Cube de calibration.gcode',exact:true}).click();await expect(page.locator('#confirm-dialog')).toBeVisible();await page.locator('#confirm-no').click();await expect(page.locator('.notification-row')).toHaveCount(3);await page.getByRole('button',{name:'Supprimer la notification : Cube de calibration.gcode',exact:true}).click();await page.locator('#confirm-yes').click();await expect(page.locator('.notification-row')).toHaveCount(2);await page.locator('#history-delete-all').click();await page.locator('#confirm-yes').click();await expect(page.getByText('Aucun message',{exact:true})).toBeVisible();await expect.poll(()=>page.locator('#history-state').evaluate(el=>getComputedStyle(el,'::before').backgroundImage)).toContain('/icons/cloud-page.svg');await expect(page.locator('.notification-row')).toHaveCount(0);const tasks=await page.request.get('/imprimante-api/extras/tasks');expect((await tasks.json()).items).toHaveLength(3);const physical=await page.request.post('/imprimante-api/command',{data:{action:'cancel'},headers:{Origin:new URL(page.url()).origin}});expect(physical.status()).toBe(403);});
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
 await page.evaluate(async()=>{const {renderTasks}=await import(document.querySelector('#workshop-script').src);renderTasks();window.deliverVisiblePreviews();});
 await expect(page.locator('.notification-row img').first()).toBeVisible();
});

test('la cloche distingue un journal indisponible d’un journal vide', async ({page}) => {
 await page.route('**/imprimante-api/status', async (route) => {
  const response = await route.fetch();
  const json = await response.json();
  json.notifications = {items:[], unread:0, has_more:false};
  json.notifications_error = 'Messages temporairement indisponibles';
  await route.fulfill({response,json});
 });
 await page.route('**/imprimante-api/history?*', (route) => route.fulfill({
  status:400, json:{message:'Messages temporairement indisponibles'},
 }));
 const {login} = require('./helpers.cjs');
 await login(page);
 await expect(page.locator('#connection')).toHaveText('En ligne');
 await page.locator('#notifications-toggle').click();
 await expect(page.locator('#history-state')).toBeVisible();
 await expect(page.locator('#history-state')).toContainText('Messages temporairement indisponibles');
});

test('la cloche affiche une fin d’impression du slicer et conserve le journal historique', async ({page}) => {
 const writes = [];
 const slicer = {
  source: 'slicer', unread: 1, has_more: false,
  items: [{key:'slicer-fixture',name:'Cube du slicer',printer:'Kobra de démonstration',
   result:'Impression terminée',kind:'success',unread:true,time:1762340000}],
 };
 await page.route('**/imprimante-api/status', async (route) => {
  const response = await route.fetch();
  const data = await response.json();
  await route.fulfill({response,json:{...data,notifications:slicer}});
 });
 await page.route('**/imprimante-api/history?*', async (route) => {
  if (new URL(route.request().url()).searchParams.get('source') === 'legacy') await route.continue();
  else await route.fulfill({json:slicer});
 });
 page.on('request', (req) => {
  if (req.method() === 'POST' && /\/history\/(read|delete)$/.test(req.url())) writes.push(req.url());
 });
 await openWorkshop(page);
 await page.locator('#notifications-toggle').click();
 const row = page.locator('.notification-row');
 await expect(page.locator('#notifications-title')).toHaveText('Messages (1)');
 await expect(row).toContainText('Cube du slicer');
 await expect(row).toContainText('Impression terminée');
 await page.getByRole('button',{name:'Non lu',exact:true}).click();
 await expect(row).toContainText('Cube du slicer');
 await expect(page.locator('#history-read-all')).toBeHidden();
 await expect(page.locator('#history-delete-all')).toBeHidden();
 await row.locator('.notification-open').click();
 await expect(page.locator('#notification-preview-dialog')).toBeVisible();
 await page.keyboard.press('Escape');
 expect(writes).toHaveLength(0);
 await page.getByRole('button',{name:'Tous',exact:true}).click();
 await expect(page.locator('#notifications-panel')).not.toContainText('Journal des notifications');
 await page.keyboard.press('Escape');
 await openHistoryJournal(page);
 await expect(row).toHaveCount(3);
 await expect(page.locator('#history-delete-all')).toBeVisible();
 await page.keyboard.press('Escape');
 await page.locator('#notifications-toggle').click();
 await expect(row).toContainText('Cube du slicer');
});

test('le panneau Burbuja supporte un changement d’avis et le mouvement réduit',async({page})=>{
 const panel=page.locator('#notifications-panel');
 const bell=page.locator('#notifications-toggle');
 const animation=()=>panel.evaluate(element=>element.getAnimations().find(item=>item.id==='notification-bubble')?.playState);
 await openWorkshop(page);
 await bell.click();
 await expect.poll(animation).toBe('running');
 await page.keyboard.press('Escape');
 await expect(bell).toHaveAttribute('aria-expanded','false');
 await bell.click();
 await expect(bell).toHaveAttribute('aria-expanded','true');
 await expect(panel).toBeVisible();
 await expect.poll(animation).toBeUndefined();
 await expect(panel).toBeVisible();

 await page.emulateMedia({reducedMotion:'reduce'});
 await expect.poll(()=>page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
 await bell.click();
 await expect(panel).toBeHidden();
 await expect.poll(animation).toBeUndefined();
});
