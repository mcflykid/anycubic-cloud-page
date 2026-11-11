const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');
/** Une interruption de transfert garde sa référence, sans répétition automatique ni message de succès. */
test('envoi lent : budget adapté et même demande après résultat incertain',async({page})=>{
 await page.addInitScript(()=>{window.uploadBudgets=[];const original=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=ms=>{window.uploadBudgets.push(ms);return original(ms);};});
 const ids=[];await page.route('**/imprimante-api/upload',async route=>{ids.push(route.request().postData().match(/name="request_id"\r\n\r\n([^\r]+)/)[1]);await route.abort('timedout');});
 await login(page);await page.getByRole('button',{name:'Envoyer et imprimer',exact:true}).click();await page.locator('#upload-form input[type=file]').setInputFiles({name:'fixture.gcode',mimeType:'text/plain',buffer:Buffer.from('G28\n')});
 for(let attempt=0;attempt<2;attempt++){
  await page.locator('#upload-form button[type=submit]').click();await page.locator('#confirm-yes').click();await expect(page.locator('#upload-state')).toContainText('Vérifiez les fichiers du cloud');
 }
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect(await page.evaluate(()=>window.uploadBudgets.filter(ms=>ms>300000).length)).toBe(2);
});

test('le dépôt prépare un G-code valide sans déclencher son envoi', async ({page}) => {
  let uploads = 0;
  await page.route('**/imprimante-api/upload', (route) => {
    uploads++;
    return route.fulfill({json: {ok: true, message: 'Envoi accepté'}});
  });
  await login(page);
  await page.getByRole('button', {name: 'Envoyer et imprimer', exact: true}).click();
  const drop = async (name) => {
    const data = await page.evaluateHandle((filename) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['G28\n'], filename));
      return transfer;
    }, name);
    await page.locator('.upload-file').dispatchEvent('drop', {dataTransfer: data});
    await data.dispose();
  };
  await drop('fixture.txt');
  await expect(page.getByText('Choisissez un seul fichier G-code, STL ou 3MF non vide.')).toBeVisible();
  await drop('fixture.gcode');
  expect(await page.locator('#upload-form input[type=file]').evaluate((input) => input.files[0].name))
    .toBe('fixture.gcode');
  expect(uploads).toBe(0);
  await page.locator('#upload-form button[type=submit]').click();
  await page.locator('#confirm-yes').click();
  await expect(page.locator('#upload-state')).toHaveText('Envoi accepté');
  expect(uploads).toBe(1);
});

test('un modèle 3MF ne peut sélectionner que le stockage Cloud', async ({page}) => {
  await login(page);
  await page.getByRole('button',{name:'Envoyer et imprimer',exact:true}).click();
  const form=page.locator('#upload-form');
  const file=form.locator('input[type=file]'), mode=form.locator('select[name=mode]');
  await mode.selectOption('save-print');
  await file.setInputFiles({name:'fixture.3mf',mimeType:'application/zip',buffer:Buffer.from('fixture')});
  await expect(mode).toHaveValue('upload');
  await expect(page.locator('#upload-format-note')).toBeVisible();
  await expect(mode).toHaveAttribute('aria-describedby','upload-format-note');
  await expect(mode.locator('option[value=save-print]')).toHaveJSProperty('disabled', true);
  await expect(form.locator('input[name=slots]')).toBeDisabled();
  await file.setInputFiles({name:'fixture.gcode',mimeType:'text/plain',buffer:Buffer.from('G28')});
  await expect(mode.locator('option[value=save-print]')).toHaveJSProperty('disabled', false);
  await expect(page.locator('#upload-format-note')).toBeHidden();
});

test('l’envoi présente le fichier en premier et limite le repère animé à la requête',async({page})=>{
  await page.setViewportSize({width:1366,height:768});
  let releaseUpload;
  const pending=new Promise(resolve=>{releaseUpload=resolve;});
  await page.route('**/imprimante-api/upload',async route=>{
    await pending;
    await route.fulfill({json:{message:'Envoi fictif terminé.'}});
  });
  await login(page);
  await page.locator('[data-tab=upload]').click();
  const form=page.locator('#upload-form');
  const slots=form.locator('[name=slots]');
  const file=form.locator('input[type=file]');
  const mode=form.locator('[name=mode]');
  await expect(slots).toBeHidden();
  const fileBounds=await file.boundingBox();
  const modeBounds=await mode.boundingBox();
  expect(fileBounds.y+fileBounds.height).toBeLessThan(modeBounds.y);
  await mode.selectOption('save-print');
  await expect(slots).toBeVisible();
  await mode.selectOption('upload');
  await expect(slots).toBeHidden();
  await file.setInputFiles({name:'fixture.gcode',mimeType:'text/plain',buffer:Buffer.from('G28\n')});
  await form.locator('button[type=submit]').click();
  await expect(form.locator('.upload-progress-outline')).toBeHidden();
  await page.locator('#confirm-yes').click();
  try{
    await expect(form.locator('.upload-file')).toHaveAttribute('aria-busy','true');
    await expect(form.locator('.upload-progress-outline')).toBeVisible();
  }finally{
    releaseUpload();
  }
  await expect(page.locator('#upload-state')).toHaveText('Envoi fictif terminé.');
  await expect(form.locator('.upload-file')).not.toHaveAttribute('aria-busy','true');
  await expect(form.locator('.upload-progress-outline')).toBeHidden();
});

test('le relief Arrastre suit la souris et s’arrête avec le mouvement réduit',async({page})=>{
  await login(page);
  await page.locator('[data-tab=upload]').click();
  const zone=page.locator('.upload-file');
  const light=zone.locator('.upload-drop-light');
  const {x,y,width,height}=await zone.boundingBox();
  await page.mouse.move(x+width*.85,y+height*.2);
  await expect.poll(()=>light.evaluate(element=>Number(getComputedStyle(element).opacity))).toBeGreaterThan(.5);
  await expect(zone).not.toHaveCSS('transform','none');

  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(zone).toHaveCSS('transform','none');
  await page.mouse.move(x+width*.4,y+height*.7);
  await expect(light).toHaveCSS('opacity','0');
});
