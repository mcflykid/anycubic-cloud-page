const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('le code Slicer est expliqué au survol et au clavier, son lien reste indépendant de l’ouverture du message',async({page})=>{
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
 await page.locator('#notifications-toggle').click();
 const row=page.locator('.notification-row'),codeLink=row.locator('.notification-error-link');
 await expect(codeLink).toContainText('10115');
 await expect(row.locator('.notification-error-title')).toHaveText('The printer cannot parse the file');
 await expect(codeLink).toHaveAttribute('href','https://wiki.anycubic.com/en/error-codes');
 await expect(codeLink).toHaveAttribute('target','_blank');
 await expect(codeLink).toHaveAttribute('rel',/noopener/);
 const tooltip=row.locator('[role=tooltip]');
 await expect(codeLink).toHaveAttribute('aria-describedby',await tooltip.getAttribute('id'));
 await codeLink.hover(); await expect(tooltip).toBeVisible();
 await codeLink.focus(); await expect(tooltip).toBeVisible();
 await expect(row.locator('.notification-open')).not.toContainText('10115');
 await expect(row.locator('.notification-open')).toBeVisible();
 await expect.poll(()=>previews).toBeGreaterThan(0);
 const previewCountBeforeClick = previews;
 await codeLink.evaluate(el=>el.addEventListener('click',event=>event.preventDefault(),{once:true}));
 await codeLink.click();
 await expect(page.locator('#notification-preview-dialog')).toBeHidden();
 expect(previews).toBe(previewCountBeforeClick);
});

test('un code zéro ne crée pas de lien ni d’alerte visible',async({page})=>{
 const slicer={source:'slicer',unread:0,has_more:false,items:[{
  key:'fixture-zero',name:'fixture.gcode',printer:'Kobra de démonstration',result:'Notification d’impression',kind:'info',unread:false,time:1762340000,
  reason_code:'',error_title:'',error_description:'',help_url:null,
 }]};
 await page.route('**/imprimante-api/status',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({response,json:{...data,notifications:slicer}})});
 await page.route('**/imprimante-api/history?*',route=>route.fulfill({json:slicer}));
 await login(page); await page.locator('#notifications-toggle').click();
 await expect(page.locator('.notification-error-link')).toHaveCount(0);
 await expect(page.locator('.notification-open')).not.toContainText('Code');
});

test('sur écran tactile l’explication est lisible avant de suivre le lien',async({browser})=>{
 const context=await browser.newContext({viewport:{width:360,height:800},hasTouch:true,isMobile:true});
 const page=await context.newPage();
 const notices={source:'slicer',unread:1,has_more:false,items:[{key:'touch-error',name:'fixture.gcode',printer:'Imprimante fictive',result:'Notification d’impression',kind:'info',unread:true,time:1762340000,reason_code:'10115',error_title:'L’imprimante ne peut pas lire ce fichier',error_description:'Le fichier peut être endommagé à la suite d’un tranchage interrompu ou être dans un format incorrect.',help_url:'https://wiki.anycubic.com/en/error-codes'}]};
 await page.route('**/imprimante-api/status',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({json:{...data,notifications:notices}});});
 await page.route('**/imprimante-api/history?*',route=>route.fulfill({json:notices}));
 await login(page);await page.locator('#notifications-toggle').click();
 await expect(page.locator('.notification-error-tooltip')).toBeVisible();
 await expect(page.locator('.notification-error-link')).toHaveText('Code d’erreur : 10115');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await context.close();
});
