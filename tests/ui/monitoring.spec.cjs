const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

function fixture(){
  const history=Array.from({length:40},(_,i)=>({
    at:new Date(Date.UTC(2026,0,1,0,0,i*5)).toISOString(),
    uptime_seconds:300+i*5,
    cpu_percent:15+i%9,
    memory_bytes:80000000+i*1000,
    data_free_bytes:900000000-i*10000,
    requests_total:200+i*2,
    errors_total:8+Math.floor(i/10),
    average_latency_ms:20+i%12,
  }));
  return {
    data_mode:'live_local',
    collected_at:history.at(-1).at,
    system:{uptime_seconds:495,cpu_percent:22,memory_bytes:80039000,data_free_bytes:899610000},
    http:{requests_total:278,errors_total:11,window_seconds:300,requests_window:150,errors_window:3,average_latency_ms:27},
    services:{cloud:'connected',mqtt:'disconnected',printers:{monitored:3,online:2,offline:1,unknown:0}},
    history,
  };
}

test('supervision affiche neuf métriques locales et actualise les cartes sans perdre le focus',async({page})=>{
  let requests=0;
  await page.route('**/imprimante-api/monitoring',route=>{
    const data=fixture();
    data.system.cpu_percent=requests++===0?22:23;
    return route.fulfill({json:data});
  });
  await login(page);
  await page.locator('[data-tab="fleet"]').click();
  const cards=page.locator('#monitor-grid [data-monitor-key]');
  await expect(page.locator('#monitor-window')).toHaveValue('120');
  await expect(cards).toHaveCount(9);
  await expect(page.locator('#monitor-grid')).toContainText('Requêtes par seconde');
  await expect(page.locator('#monitor-grid')).toContainText('Mémoire locale');
  await expect(page.locator('#monitor-grid')).toContainText('2 / 3');
  await expect(page.locator('#monitor-state')).toContainText('Données locales');
  const cpu=page.locator('#monitor-grid [data-monitor-key="cpu"]');
  const value=cpu.locator('.monitor-card-value');
  await expect(value).not.toHaveAttribute('data-motion-change');
  await cpu.focus();
  const before=requests;
  await page.waitForTimeout(5500);
  expect(requests).toBeGreaterThan(before);
  await expect(value).toContainText('23');
  await expect(value).toHaveAttribute('data-motion-change','a');
  await expect(cpu).toBeFocused();
});

test('détail accessible montre seulement les échantillons disponibles et ferme par Échap',async({page})=>{
  await page.route('**/imprimante-api/monitoring',route=>route.fulfill({json:fixture()}));
  await login(page);
  await page.locator('[data-tab="fleet"]').click();
  const cpu=page.locator('#monitor-grid [data-monitor-key="cpu"]');
  await cpu.focus();
  await page.keyboard.press('Enter');
  const dialog=page.locator('#monitor-detail');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-monitor-chart]')).toHaveAttribute('data-sample-count','40');
  await dialog.locator('[data-monitor-samples="30"]').click();
  await expect(page.locator('#monitor-window')).toHaveValue('30');
  await expect(dialog.locator('[data-monitor-chart]')).toHaveAttribute('data-sample-count','30');
  await expect(dialog).toContainText('Imprimantes suivies');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  const memory=page.locator('#monitor-grid [data-monitor-key="memory"]');
  await memory.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toContainText('Usage courant du conteneur');
  await dialog.getByRole('button',{name:'Fermer le détail de la métrique'}).click();
  await expect(dialog).not.toBeVisible();
});

test('les historiques absents restent indiqués comme absents',async({page})=>{
  await page.route('**/imprimante-api/monitoring',route=>route.fulfill({json:{...fixture(),history:[]}}));
  await login(page);
  await page.locator('[data-tab="fleet"]').click();
  const cloud=page.locator('#monitor-grid [data-monitor-key="cloud"]');
  await cloud.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#monitor-detail')).toContainText('Aucun historique disponible');
  await expect(page.locator('#monitor-detail svg')).toHaveCount(0);
});

test('les lacunes historiques interrompent la courbe au lieu de fabriquer une continuité',async({page})=>{
  const data=fixture();
  data.history[10].cpu_percent=null;
  data.history[20].cpu_percent=null;
  await page.route('**/imprimante-api/monitoring',route=>route.fulfill({json:data}));
  await login(page);
  await page.locator('[data-tab="fleet"]').click();
  await expect(page.locator('#monitor-grid [data-monitor-key]')).toHaveCount(9);
  await page.locator('#monitor-grid [data-monitor-key="cpu"]').click();
  const path=page.locator('#monitor-detail [data-monitor-chart] path.monitor-chart-line');
  await expect.poll(()=>path.getAttribute('d')).toContain('M');
  expect(await path.getAttribute('d')).toMatch(/M[^M]*M[^M]*M/);
});

test('la pause locale arrête la relecture automatique jusqu’à sa reprise',async({page})=>{
  let requests=0;
  await page.route('**/imprimante-api/monitoring',route=>{requests++;return route.fulfill({json:fixture()});});
  await login(page);
  await page.locator('[data-tab="fleet"]').click();
  await expect(page.locator('#monitor-grid [data-monitor-key]')).toHaveCount(9);
  await page.locator('#monitor-pause').click();
  await expect(page.locator('#monitor-pause')).toHaveAttribute('aria-pressed','true');
  const pausedAt=requests;
  await page.waitForTimeout(5200);
  expect(requests).toBe(pausedAt);
  await page.locator('#monitor-pause').click();
  await expect(page.locator('#monitor-pause')).toHaveAttribute('aria-pressed','false');
  await expect.poll(()=>requests).toBeGreaterThan(pausedAt);
});

test('le serveur de démonstration marque explicitement ses valeurs fictives',async({page})=>{
  await login(page);
  await page.locator('[data-tab="fleet"]').click();
  await expect(page.locator('#monitor-grid [data-monitor-key]')).toHaveCount(9);
  await expect(page.locator('#monitor-state')).toHaveText('Données fictives de démonstration.');
  await page.locator('#monitoring').screenshot({path:'test-results/monitoring-overview.png'});
  await page.locator('#monitor-grid [data-monitor-key="cpu"]').click();
  await expect(page.locator('#monitor-detail')).toContainText('Valeurs fictives pour démonstration');
  await expect(page.locator('#monitor-detail')).toContainText('source : démonstration');
});

/** Le détail se révèle depuis la carte activée et les lectures restent mesurées. */
test('Instrumental ouvre la métrique avec un ressort et résume les points valides', async ({page}) => {
  await page.emulateMedia({reducedMotion:'no-preference'});
  const data = fixture();
  data.history[0].cpu_percent = null;
  await page.route('**/imprimante-api/monitoring', route => route.fulfill({json:data}));
  await login(page, 'fleet');
  const card = page.locator('#monitor-grid [data-monitor-key="cpu"]');
  await card.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('#monitor-detail');
  await expect(dialog).toBeVisible();
  const frames = await dialog.evaluate(node => node.getAnimations().flatMap(animation => animation.effect.getKeyframes()));
  expect(frames.some(frame => frame.clipPath?.startsWith('inset('))).toBe(true);
  await expect(dialog.locator('[data-monitor-summary]')).toContainText('Moyenne des relevés');
  await expect(dialog.locator('[data-monitor-summary]')).toContainText('95e centile');
  await expect(dialog.locator('[data-monitor-summary]')).toContainText('39');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.emulateMedia({reducedMotion:'reduce'});
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(node => node.getAnimations().length)).toBe(0);
  await expect(dialog.locator('[data-monitor-summary]')).toContainText('39');
});

test('Canica roule seulement au changement de suspension et reste fixe en mouvement réduit', async ({page}) => {
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.route('**/imprimante-api/monitoring', route => route.fulfill({json:fixture()}));
  await login(page, 'fleet');
  const pause = page.locator('#monitor-pause');
  const knob = pause.locator('.monitor-switch-knob');
  await expect(knob).toBeVisible();
  await expect(pause).toHaveAttribute('aria-pressed','false');
  await pause.press('Space');
  await expect(pause).toHaveAttribute('aria-pressed','true');
  const frames = await knob.evaluate(el => el.getAnimations().flatMap(animation => animation.effect.getKeyframes()));
  expect(frames.some(frame => frame.transform?.includes('rotate('))).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});
  await pause.press('Space');
  await expect(pause).toHaveAttribute('aria-pressed','false');
  await expect.poll(() => knob.evaluate(el => el.getAnimations().length)).toBe(0);
});

test('Parc et santé aligne l’historique et la suspension sur un écran bas', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 760});
  await login(page, 'fleet');
  await expect(page.locator('#monitor-window')).toBeVisible();
  await expect(page.locator('#monitor-pause')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Un relevé peut déplacer tout le panneau entre deux mesures faites séparément.
  await expect.poll(() => page.locator('.monitor-settings').evaluate(panel => {
    const history = panel.querySelector('#monitor-window').getBoundingClientRect();
    const pause = panel.querySelector('#monitor-pause').getBoundingClientRect();
    return Math.abs(history.bottom - pause.bottom);
  })).toBeLessThan(1);
});
