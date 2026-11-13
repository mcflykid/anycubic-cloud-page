const { test, expect } = require('@playwright/test');
const { login, openSection } = require('./helpers.cjs');

/** Choisit un état fictif depuis l’onglet Développeur ; la démonstration seule connaît cette route. */
async function scenario(page, name) {
  await openSection(page, 'developer');
  const tools = page.locator('#tab-developer .developer-card');
  const simulation = tools.locator('[data-simulation]');
  if (!(await simulation.evaluate(element => element.open))) await simulation.locator('summary').click();
  await tools.getByLabel('État fictif de la démo').selectOption(name);
  await tools.getByRole('button', {name:'Appliquer l’état fictif'}).click();
  await expect(tools.getByText('État fictif appliqué au prochain relevé.')).toBeVisible();
  // L’état ne s’affiche qu’au relevé suivant : l’attendre évite de lire l’état précédent.
  await page.waitForResponse(response => response.url().includes('/imprimante-api/status'));
}

test.beforeEach(async ({page}) => {
  await login(page, 'settings');
  const reset = await page.request.post('/imprimante-api/demo/reset', {data:{}, headers:{Origin:new URL(page.url()).origin}});
  expect(reset.status()).toBe(200);
  await page.locator('#developer-mode').click();
});

test.afterEach(async ({page}) => {
  await page.request.post('/imprimante-api/demo/reset', {data:{}, headers:{Origin:new URL(page.url()).origin}});
  await page.evaluate(() => localStorage.removeItem('anycubic-developer-mode'));
});

test('Développeur reste sur la ligne de Réglages', async ({page}) => {
  const settings = await page.locator('#atelier-tabs [data-tab=settings]').boundingBox();
  const developer = await page.locator('#atelier-tabs [data-tab=developer]').boundingBox();
  expect(Math.abs(settings.y - developer.y)).toBeLessThan(2);
  expect(developer.x).toBeGreaterThan(settings.x);
});

test('l’humidité élevée propose un séchage sans le lancer, puis disparaît sans mesure', async ({page}) => {
  const commands = [];
  page.on('request', request => { if (request.url().endsWith('/imprimante-api/command')) commands.push(request.url()); });
  await scenario(page, 'sechage-conseille');
  await openSection(page, 'ace');
  const advice = page.locator('#ace-drying-advice');
  await expect(advice).toBeVisible({timeout:8000});
  await expect(page.locator('#ace-drying-advice-text')).toContainText('48 %');
  await expect(page.locator('#ace-drying-advice-text')).toContainText('PETG');
  await page.locator('#ace-drying-prepare').click();
  await expect(page.locator('#dry-dialog')).toBeVisible();
  await expect(page.locator('#dry-form [name=temperature]')).toHaveValue('45');
  await page.keyboard.press('Escape');
  expect(commands).toEqual([]);
  await scenario(page, 'humidite-absente');
  await openSection(page, 'ace');
  await expect(advice).toBeHidden({timeout:8000});
});

test('une chauffe lente puis une chute en impression affichent l’alerte sur le Résumé et l’Imprimante', async ({page}) => {
  await scenario(page, 'chauffe-lente');
  await openSection(page, 'summary');
  await expect(page.locator('#summary-heat-warning')).toContainText(/plateau.*52.*60/i, {timeout:8000});
  await openSection(page, 'overview');
  await expect(page.locator('#printer-heat-warning')).toBeVisible();
  await expect(page.locator('#printer-bed-row')).toHaveClass(/heat-alert/);
  await expect(page.locator('#printer-nozzle-row')).not.toHaveClass(/heat-alert/);
  await scenario(page, 'chute-en-impression');
  await openSection(page, 'overview');
  await expect(page.locator('#printer-heat-warning')).toContainText(/buse.*196.*210/i, {timeout:8000});
  await scenario(page, 'standard');
  await openSection(page, 'overview');
  await expect(page.locator('#printer-heat-warning')).toBeHidden({timeout:8000});
});

test('les notes de mise à jour s’affichent, ou renvoient au guide officiel quand Anycubic n’en fournit pas', async ({page}) => {
  await scenario(page, 'mise-a-jour-notes');
  await openSection(page, 'settings');
  const notes = page.locator('#firmware-printer-notes');
  await expect(notes).toBeVisible({timeout:8000});
  await notes.click();
  const dialog = page.locator('#firmware-notes-dialog');
  await expect(page.locator('#firmware-notes-title')).toHaveText('Nouveautés · Anycubic Kobra S1');
  await expect(page.locator('#firmware-notes-current')).toHaveText('2.7.2.7');
  await expect(page.locator('#firmware-notes-target')).toHaveText('2.7.3.0');
  await expect(page.locator('#firmware-notes-date')).toHaveText(/^Publiée le \d\d\/\d\d\/\d{4}$/);
  await expect(page.locator('#firmware-notes-optional')).toBeVisible();
  await expect(dialog).toContainText('Texte d’exemple fictif.');
  await expect(page.locator('#firmware-notes-required')).toBeHidden();
  await expect(page.locator('#firmware-notes-empty')).toBeHidden();
  // Au repos, l’installation reprend le bouton de la carte et sa confirmation ; ici on se contente de « Plus tard ».
  await expect(page.locator('#firmware-notes-install')).toBeEnabled();
  await page.locator('#firmware-notes-later').click();
  await expect(dialog).toBeHidden();
  await scenario(page, 'mise-a-jour-obligatoire');
  await openSection(page, 'settings');
  await page.locator('#firmware-printer-notes').click();
  await expect(page.locator('#firmware-notes-required')).toBeVisible();
  await expect(page.locator('#firmware-notes-optional')).toBeHidden();
  await expect(page.locator('#firmware-notes-empty')).toContainText('Anycubic ne fournit pas de notes pour cette version.');
  await expect(page.locator('#firmware-notes-text')).toBeHidden();
  await expect(page.locator('#firmware-notes-official')).toHaveAttribute('href', /firmware-update-guide/);
});

test('une erreur JavaScript ne garde que son type, son module et sa ligne', async ({page}) => {
  const secrets = ['/srv/atelier-fictif/privé', 'piece-secrete.gcode', 'SN-FICTIF-0042', 'exemple.invalid'];
  await openSection(page, 'files');
  await page.evaluate(text => setTimeout(() => { throw new TypeError(text); }),
    `Essai ${secrets[0]}/${secrets[1]} ${secrets[2]} https://${secrets[3]}/x`);
  const dot = page.locator('[data-tab=developer] .developer-unread');
  await expect(dot).toBeVisible();
  await openSection(page, 'developer');
  const tools = page.locator('#tab-developer .developer-card');
  await tools.getByText('Erreurs du navigateur', {exact:true}).click();
  const list = tools.getByLabel('Erreurs du navigateur');
  await expect(list).toContainText('TypeError');
  for (const secret of [...secrets, 'Essai']) await expect(list).not.toContainText(secret);
  await tools.getByText('Rapport expurgé', {exact:true}).click();
  await tools.getByRole('button', {name:'Copier un rapport expurgé'}).click();
  const text = await tools.getByLabel('Aperçu du rapport expurgé').inputValue();
  for (const secret of [...secrets, 'Essai']) expect(text).not.toContain(secret);
  const report = JSON.parse(text);
  expect(report.erreurs_js[0]).toMatchObject({type:'TypeError', module:'module externe'});
  expect(report).toHaveProperty('commande');
  expect(report).toHaveProperty('fin_prévue');
});

test('le journal donne une ligne par requête et garde les incidents', async ({page}) => {
  await page.route('**/imprimante-api/files/local?**', route => route.abort());
  await openSection(page, 'files');
  await page.locator('[data-source=local]').click();
  await openSection(page, 'developer');
  const tools = page.locator('#tab-developer .developer-card');
  const journal = tools.getByLabel('Requêtes');
  await expect(journal).toContainText(/\d\d:\d\d:\d\d\.\d{3} · GET \/status · réponse 200/);
  await expect(journal).not.toContainText('envoi');
  await tools.getByLabel('Statut').selectOption('incident');
  await expect(journal).toContainText('GET /files/local · interruption');
  await expect(journal).not.toContainText('/status · réponse 200');
});
