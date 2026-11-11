const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('le code Slicer est expliqué au survol et au clavier, sa fiche reste indépendante de l’ouverture du message',async({page})=>{
 const slicer={source:'slicer',unread:1,has_more:false,items:[{
  key:'fixture-error',name:'support.3mf_temp/fixture.gcode',printer:'Kobra de démonstration',
  result:'Notification d’impression',kind:'info',unread:true,time:1762340000,
  reason:'The printer cannot parse the file',reason_code:'10115',
  error_title:'L’imprimante ne peut pas lire ce fichier',
  error_description:'Le fichier peut être endommagé à la suite d’un tranchage interrompu ou être dans un format incorrect.',
  help_url:'https://wiki.anycubic.com/en/error-codes',
 }]};
 await page.route('**/imprimante-api/status',async route=>{
  const response=await route.fetch(),data=await response.json();
  await route.fulfill({response,json:{...data,notifications:slicer}});
 });
 await page.route('**/imprimante-api/history?*',route=>route.fulfill({json:slicer}));
 let previews=0;
 await page.route('**/imprimante-api/extras/notification-preview?*',route=>{previews++;return route.fulfill({json:{image:null}})});
 await login(page);
 await page.evaluate(()=>localStorage.setItem('cloud-page-language','en'));
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await page.locator('#notifications-toggle').click();
 const row=page.locator('.notification-row'),codeLink=row.getByRole('button',{name:'Error code: 10115'});
 await expect(codeLink).toContainText('10115');
 await expect(row.locator('.notification-error-title')).toHaveText('The printer cannot parse the file');
 const tooltip=row.locator('[role=tooltip]');
 await expect(codeLink).toHaveAttribute('aria-describedby',await tooltip.getAttribute('id'));
 await codeLink.hover(); await expect(tooltip).toBeVisible();
 await codeLink.focus(); await expect(tooltip).toBeVisible();
 await expect(row.locator('.notification-open')).not.toContainText('10115');
 await expect(row.locator('.notification-open')).toBeVisible();
 await expect.poll(()=>previews).toBeGreaterThan(0);
 const previewCountBeforeClick = previews;
 // Ouvrir l’aide ne charge pas d’aperçu, ne change pas de page et ne marque pas le message comme lu.
 const url=page.url();
 await codeLink.press('Enter');
 const sheet=page.getByRole('dialog',{name:'Error code: 10115'});
 await expect(sheet).toBeVisible();
 await page.screenshot({path:'test-results/notification-error-sheet.png',animations:'disabled'});
 await expect(sheet.getByRole('heading',{name:'The printer cannot parse the file'})).toBeVisible();
 await expect(sheet.getByRole('listitem')).toHaveCount(3);
 const source=sheet.getByRole('link',{name:'Official Anycubic documentation'});
 await expect(source).toHaveAttribute('href',/wiki\.anycubic\.com.*10115/);
 await expect(source).toHaveAttribute('rel',/noopener/);
 await expect(page).toHaveURL(url);
 await expect(page.locator('#notification-preview-dialog')).toBeHidden();
 expect(previews).toBe(previewCountBeforeClick);
 await page.keyboard.press('Escape');
 await expect(sheet).toBeHidden();
 await expect(codeLink).toBeFocused();
});

test('les codes zéro et 200 ne créent pas de fiche d’erreur',async({page})=>{
 const slicer={source:'slicer',unread:0,has_more:false,items:[{
  key:'fixture-zero',name:'fixture.gcode',printer:'Kobra de démonstration',result:'Notification d’impression',kind:'info',unread:false,time:1762340000,
  reason_code:'0',error_title:'',error_description:'',help_url:null,
 },{
  key:'fixture-success',name:'terminé.gcode',printer:'Kobra de démonstration',result:'Impression terminée',kind:'success',unread:false,time:1762340001,
  reason_code:'200',error_title:'',error_description:'',help_url:null,
 }]};
 await page.route('**/imprimante-api/status',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({response,json:{...data,notifications:slicer}})});
 await page.route('**/imprimante-api/history?*',route=>route.fulfill({json:slicer}));
 await login(page); await page.locator('#notifications-toggle').click();
 await expect(page.locator('.notification-row')).toHaveCount(2);
 await expect(page.locator('.notification-error-link')).toHaveCount(0);
 await expect(page.locator('.notification-open')).not.toContainText('Code');
});

test('sur écran tactile l’explication est lisible et ouvre une fiche dans l’atelier',async({browser})=>{
 const context=await browser.newContext({viewport:{width:360,height:800},hasTouch:true,isMobile:true});
 const page=await context.newPage();
 const notices={source:'slicer',unread:1,has_more:false,items:[{key:'touch-error',name:'fixture.gcode',printer:'Imprimante fictive',result:'Notification d’impression',kind:'info',unread:true,time:1762340000,reason_code:'10115',error_title:'L’imprimante ne peut pas lire ce fichier',error_description:'Le fichier peut être endommagé à la suite d’un tranchage interrompu ou être dans un format incorrect.',help_url:'https://wiki.anycubic.com/en/error-codes'}]};
 await page.route('**/imprimante-api/status',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({json:{...data,notifications:notices}});});
 await page.route('**/imprimante-api/history?*',route=>route.fulfill({json:notices}));
 await login(page);await page.locator('#notifications-toggle').click();
 await expect(page.locator('.notification-error-tooltip')).toBeVisible();
 const code=page.getByRole('button',{name:'Code d’erreur : 10115'});
 await code.tap();
 await expect(page.getByRole('dialog',{name:'Code d’erreur : 10115'})).toBeVisible();
 await page.screenshot({path:'test-results/notification-error-mobile.png',animations:'disabled'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await context.close();
});


test('un code inconnu montre le message constructeur sans inventer une cause ni ouvrir une URL fournie',async({page})=>{
 const notices={source:'slicer',unread:0,has_more:false,items:[{
  key:'unknown-error',name:'fixture.gcode',printer:'Imprimante fictive',result:'Notification d’impression',
  kind:'info',unread:false,time:1762340000,reason_code:'99999',reason:'Message constructeur de démonstration.',
  help_url:'https://wiki.anycubic.com.evil.invalid/en/error-codes',
 }]};
 await page.route('**/imprimante-api/status',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({json:{...data,notifications:notices}});});
 await page.route('**/imprimante-api/history?*',route=>route.fulfill({json:notices}));
 await login(page);
 await page.locator('#notifications-toggle').click();
 await page.getByRole('button',{name:'Code d’erreur : 99999'}).click();
 const sheet=page.getByRole('dialog',{name:'Code d’erreur : 99999'});
 await expect(sheet).toContainText('Ce code n’est pas encore documenté dans l’atelier.');
 await expect(sheet).toContainText('Message constructeur de démonstration.');
 await expect(sheet.getByRole('listitem')).toHaveCount(0);
 await expect(sheet.getByRole('link')).toHaveCount(0);
});
