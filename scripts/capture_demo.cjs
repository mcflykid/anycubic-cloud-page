/** Produit les captures publiques avec des données et une authentification de démonstration isolées. */
const {chromium} = require('@playwright/test');
const {execFileSync, spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const desktop = {width: 1440, height: 1000};
const mobile = {width: 390, height: 844};
const password = 'ui-fixture-password';
const styles = [
  ['standard', 'Par défaut'],
  ['aurora', 'Aurore'], ['lab', 'Laboratoire'], ['glasshouse', 'Verrière'],
];

/** Attend uniquement les aperçus visibles pour préserver le chargement différé. */
async function visibleImages(page) {
  await page.locator('img:visible').evaluateAll(images => Promise.race([
    Promise.all(images.map(image => image.decode().catch(() => {}))),
    new Promise(resolve => setTimeout(resolve, 2000)),
  ]));
}

async function photo(page, filename) {
  await visibleImages(page);
  const jpeg = filename.endsWith('.jpg');
  await page.screenshot({
    path: path.resolve('screenshots', filename), animations: 'disabled',
    ...(jpeg ? {type: 'jpeg', quality: 86} : {}),
  });
}

async function signIn(page, base) {
  await page.goto(base + '/login');
  await page.getByLabel('Identifiant').fill('admin');
  await page.getByLabel('Mot de passe', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Se connecter', exact: true}).click();
}

/** La navigation mobile exige l’ouverture du menu avant le choix de section. */
async function openSection(page, key) {
  await page.waitForFunction(() => !document.querySelector('#section-menu-toggle').disabled);
  const toggle = page.locator('#section-menu-toggle');
  if (await toggle.isVisible()) await toggle.click();
  await page.locator('#atelier-tabs [data-tab="' + key + '"]').click();
}

async function captureCloudFolders(page) {
  await page.getByRole('button', {name: 'Cloud Anycubic', exact: true}).click();
  await page.getByRole('combobox', {name: 'Dossier Cloud', exact: true}).selectOption('root');
  await page.getByRole('checkbox', {name: 'Sélectionner Cube de calibration.gcode', exact: true}).check();
  await page.getByRole('combobox', {name: 'Dossier de destination', exact: true}).selectOption('demo-pieces');
  await photo(page, '11-dossiers-cloud.png');
}

/** Utilise une alarme fictive pour que la fiche reste reproductible même sans message de panne dans la démo. */
async function captureError(page) {
  const item = {
    key:'demo-format-refuse', name:'Support de démonstration.gcode', printer:'Kobra S1 · Démonstration',
    result:'Impression arrêtée', kind:'interrupted', unread:true, time:Math.floor(Date.now()/1000),
    reason_code:'10115', reason:'The device cannot parse the file.',
  };
  await page.route('**/imprimante-api/status', async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({response, json:{...data, notifications:{
      source:'slicer', unread:1, has_more:false, items:[item],
    }}});
  });
  await page.reload();
  await page.locator('#notifications-dot').waitFor();
  await page.locator('#notifications-toggle').click();
  await page.getByRole('button', {name:'Code d’erreur : 10115'}).click();
  await photo(page, '16-fiche-erreur.png');
  await page.unroute('**/imprimante-api/status');
}

/** Assemble les six styles sans publier une série d’images redondantes. */
async function captureStyles(page, browser) {
  const samples = [];
  for (const [style, name] of styles) {
    await page.evaluate(value => {
      localStorage.setItem('cloud-page-style', value);
      localStorage.setItem('cloud-page-theme', 'light');
    }, style);
    await page.reload();
    await openSection(page, 'summary');
    await visibleImages(page);
    samples.push({name, jpeg:(await page.screenshot({type:'jpeg', quality:80})).toString('base64')});
  }
  const sheet = await browser.newPage({viewport:desktop});
  await sheet.setContent(`<style>
    *{box-sizing:border-box}body{margin:0;padding:32px;background:#e7edf4;color:#172332;font:20px system-ui}
    main{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}figure{margin:0;background:white;border-radius:14px;overflow:hidden}
    h1{font-size:30px;margin:0 0 24px}img{display:block;width:100%;height:auto}figcaption{padding:14px 16px}
    </style><h1>Les six styles de l’atelier</h1><main>
    ${samples.map(({name,jpeg}) => `<figure><img src="data:image/jpeg;base64,${jpeg}" alt=""><figcaption>${name}</figcaption></figure>`).join('')}
    </main>`);
  await photo(sheet, '17-six-styles.jpg');
  await sheet.close();
}

/** Active un facteur fictif dans le stockage temporaire, puis capture uniquement le formulaire vide de vérification. */
async function captureTotp(page, browser, base) {
  await page.goto(base + '/imprimante-api/security');
  await page.getByLabel('Mot de passe web').fill(password);
  await page.getByRole('button', {name:'Préparer l’activation'}).click();
  const key = await page.locator('main code').textContent();
  const firstCode = execFileSync(process.env.UI_PYTHON || 'python3', [
    '-B', '-c',
    'import sys,time;sys.path.insert(0,"app");from web_totp import code_at;print(code_at(sys.stdin.read().strip(),int(time.time())//30))',
  ], {input:key, encoding:'utf-8'}).trim();
  await page.getByLabel('Mot de passe web').fill(password);
  await page.getByLabel('Premier code temporaire').fill(firstCode);
  await page.getByRole('button', {name:'Activer le facteur', exact:true}).click();
  await page.locator('main li code').first().waitFor();
  const guest = await browser.newPage({viewport:desktop, reducedMotion:'reduce'});
  try {
    await signIn(guest, base);
    await guest.getByRole('heading', {name:'Vérifier la connexion'}).waitFor();
    await photo(guest, '18-code-temporaire.png');
  } finally {
    await guest.close();
  }
}

async function main() {
  const port = process.env.UI_PORT || '8765';
  const base = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, ['scripts/ui_server.cjs'], {stdio:'ignore', env:process.env});
  let browser;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100 && server.exitCode == null; attempt++) {
      try {
        const health = await fetch(base + '/imprimante-api/health');
        ready = health.ok && (await health.json()).demo === true;
      } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Démonstration locale indisponible');
    browser = await chromium.launch();
    const page = await browser.newPage({viewport:desktop, reducedMotion:'reduce', locale:'fr-FR'});
    await page.goto(base + '/login');
    await photo(page, '00-connexion.jpg');
    await signIn(page, base);
    await page.locator('#notifications-dot').waitFor();
    for (const [tab, filename] of [
      ['summary','12-resume.png'], ['overview','01-imprimante.png'], ['ace','02-ace-filaments.png'],
      ['files','03-fichiers.png'], ['upload','04-envoyer-imprimer.png'], ['camera','05-camera.png'],
      ['history','06-historique.png'], ['fleet','13-parc-et-sante.png'], ['statistics','14-statistiques.png'],
      ['settings','07-reglages.png'],
    ]) {
      await openSection(page, tab);
      if (tab === 'history') await page.locator('#tasks-list > li').first().waitFor();
      if (tab === 'fleet') await page.locator('#monitor-grid .monitor-card').first().waitFor();
      await photo(page, filename);
      if (tab === 'files') await captureCloudFolders(page);
    }
    await page.locator('#ai-open').click();
    await page.locator('#ai-form').waitFor();
    await photo(page, '09-detection-ia.png');
    await page.keyboard.press('Escape');
    await openSection(page, 'history');
    await page.locator('#historical-notifications-open').click();
    await page.locator('#history-list .notification-row').first().waitFor();
    await photo(page, '15-journal.png');
    await page.keyboard.press('Escape');
    await openSection(page, 'overview');
    await page.locator('#notifications-toggle').click();
    await page.locator('.notification-row').first().waitFor();
    await photo(page, '08-notifications.png');
    await page.keyboard.press('Escape');
    await captureError(page);
    await page.route('**/imprimante-api/printers', route => route.fulfill({json:{items:[
      {key:'demo-printer', name:'Kobra S1 · Atelier A'}, {key:'demo-second', name:'Kobra S1 · Atelier B'},
    ], default:'demo-printer'}}));
    await page.reload();
    await openSection(page, 'overview');
    await page.locator('#printer-selector-wrap').waitFor();
    await photo(page, '10-session.jpg');
    await page.unroute('**/imprimante-api/printers');
    await captureStyles(page, browser);
    await page.evaluate(() => {
      localStorage.setItem('cloud-page-style','standard');
      localStorage.setItem('cloud-page-theme','dark');
    });
    await page.reload();
    await openSection(page, 'summary');
    await photo(page, '19-resume-sombre.png');
    await openSection(page, 'fleet');
    await page.locator('#monitor-grid .monitor-card').first().waitFor();
    await photo(page, '20-supervision-sombre.png');
    await page.locator('[data-monitor-key="cpu"]').click();
    await page.locator('#monitor-detail [data-monitor-summary]').waitFor();
    await photo(page, '22-detail-supervision.png');
    await page.keyboard.press('Escape');
    await page.setViewportSize(mobile);
    await openSection(page, 'summary');
    await photo(page, '21-resume-mobile.png');
    await captureTotp(page, browser, base);
    console.log('Captures de démonstration produites, sans compte réel.');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
}
main().catch(error => {
  console.error('Échec des captures de démonstration :', error.message.split('\n')[0]);
  process.exitCode = 1;
});
