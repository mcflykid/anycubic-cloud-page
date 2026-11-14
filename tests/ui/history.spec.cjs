const {test,expect}=require('@playwright/test');
/** Le scénario ne connaît que les fiches fictives du serveur de démonstration. */
const {openSection}=require('./helpers.cjs');

test('la galerie conserve la recherche et la sélection en revenant à la liste', async ({page}) => {
 await history(page);
 await page.locator('#tasks-search').fill('Cube');
 await page.locator('#tasks-list input[type=checkbox]').check();
 await page.locator('#history-gallery-view').click();
 const gallery = page.locator('#tasks-gallery');
 await expect(gallery.locator('li')).toHaveCount(1);
 await expect(gallery.getByRole('checkbox')).toBeChecked();
 await gallery.getByRole('button').click();
 await expect(page.locator('#past-task-dialog')).toBeVisible();
 await page.keyboard.press('Escape');
 await page.locator('#history-list-view').click();
 await expect(page.locator('#tasks-list input[type=checkbox]')).toBeChecked();
 await expect(page.locator('#tasks-search')).toHaveValue('Cube');
});

test('les détails et les filtres de l’historique ne proposent plus de notes locales', async ({page}) => {
 await history(page);
 await page.locator('#tasks-list .history-detail').first().click();
 await expect(page.locator('#past-task-dialog')).toBeVisible();
 await expect(page.locator('#task-note-form')).toHaveCount(0);
 await expect(page.locator('#tasks-tag')).toHaveCount(0);
});
async function history(page){await page.goto('/login');await page.getByLabel('Identifiant').fill('admin');await page.getByLabel('Mot de passe').fill('ui-fixture-password');await page.getByRole('button',{name:'Se connecter',exact:true}).click();expect((await page.request.post('/imprimante-api/demo/reset',{data:{},headers:{Origin:new URL(page.url()).origin}})).status()).toBe(200);await openSection(page,'history');await expect(page.locator('#tasks-list>tr')).toHaveCount(3);}
test('statuts, recherche combinée, dates par défaut et chargement progressif',async({page})=>{await history(page);await page.locator('#history-period-open').click();const from=await page.locator('#tasks-from').inputValue(),to=await page.locator('#tasks-to').inputValue();expect((new Date(to)-new Date(from))/86400000).toBe(89);await page.getByRole('button',{name:'Personnalisée',exact:true}).click();await expect(page.locator('.history-month:visible')).toHaveCount(1);await page.locator('#history-month-prev').click();const last=page.locator('.history-month [data-day]').last();const firstDay=await last.getAttribute('data-day');await last.click();await expect(page.locator('#history-period-apply')).toBeDisabled();await page.keyboard.press('ArrowRight');const first=page.locator('.history-month [data-day]').first();const lastDay=await first.getAttribute('data-day');await first.click();await page.keyboard.press('ArrowLeft');await expect(page.locator('.history-month [data-day]').last()).toBeFocused();await expect(page.locator('#tasks-from')).toHaveValue(firstDay);await expect(page.locator('#tasks-to')).toHaveValue(lastDay);await page.keyboard.press('Escape');await page.getByRole('button',{name:'Arrêtées',exact:true}).click();await expect(page.locator('#tasks-list>tr')).toHaveCount(1);await expect(page.locator('#tasks-list')).toContainText('Boîte de rangement');await page.locator('#tasks-search').fill('Cube');await expect(page.locator('#tasks-list>tr')).toHaveCount(0);await page.locator('#tasks-search').fill('');await page.getByRole('button',{name:'Tout',exact:true}).click();await page.locator('#tasks-next').click();await expect(page.locator('#tasks-list>tr')).toHaveCount(5);await expect(page.locator('#tasks-list')).not.toContainText('Vase décoratif');await page.locator('#history-period-open').click();await page.getByRole('button',{name:'Personnalisée',exact:true}).click();await page.locator('#tasks-from').fill('2000-01-01');await expect(page.locator('#tasks-list>tr')).toHaveCount(5);await page.locator('#history-period-apply').click();await expect(page.locator('#tasks-list>tr')).toHaveCount(3);await page.locator('#tasks-next').click();await expect(page.locator('#tasks-list>tr')).toHaveCount(6);await page.locator('#tasks-next').click();await expect(page.locator('#tasks-list>tr')).toHaveCount(7);await expect(page.locator('#tasks-next')).toBeHidden();});
test('la confirmation cible la sélection et distingue les notifications',async({page})=>{await history(page);await page.locator('#tasks-search').fill('Boîte');await page.getByLabel('Tout sélectionner',{exact:true}).check();await expect(page.locator('#tasks-selected-count')).toHaveText('1 sélection');await page.locator('#tasks-delete').click();await expect(page.locator('#confirm-text')).toContainText('application Anycubic et le slicer');await expect(page.locator('#confirm-text')).toContainText('Boîte de rangement');await expect(page.locator('#confirm-text')).not.toContainText('Cube de calibration');await page.locator('#confirm-no').click();await expect(page.locator('#tasks-list>tr')).toHaveCount(1);await page.locator('#tasks-delete').click();await page.locator('#confirm-yes').click();await expect(page.locator('#tasks-list>tr')).toHaveCount(0);await page.locator('#tasks-search').fill('');await expect(page.locator('#tasks-list')).not.toContainText('Boîte de rangement');await expect(page.locator('#tasks-list')).toContainText('Cube de calibration');const notices=await page.request.get('/imprimante-api/history');expect((await notices.json()).items).toHaveLength(3);});
test('cartes mobiles, détail et état vide accessibles',async({page})=>{await page.setViewportSize({width:390,height:844});await history(page);const card=await page.locator('#tasks-list>tr').first().boundingBox();expect(card.x+card.width).toBeLessThanOrEqual(390);await page.getByRole('button',{name:'Voir le détail',exact:true}).first().click();await expect(page.locator('#past-task-dialog')).toBeVisible();await page.keyboard.press('Escape');await page.locator('#history-period-open').click();await page.getByRole('button',{name:'Personnalisée',exact:true}).click();await expect(page.locator('.history-month:visible')).toHaveCount(1);await page.locator('#tasks-from').fill('2099-01-01');await page.locator('#tasks-to').fill('2099-01-31');await expect(page.locator('#history-period-apply')).toBeDisabled();await page.keyboard.press('Escape');await page.locator('#tasks-search').fill('Aucun modèle de ce nom');await page.locator('#tasks-next').click();await page.locator('#tasks-next').click();await expect(page.getByText("Aucun historique d'impression",{exact:true})).toBeVisible();});

/** Le reflet suit la grille visible et cesse dès que la réponse remplace l’attente. */
test('le chargement de l’historique reprend ses cartes et respecte le mouvement réduit', async ({page}) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/imprimante-api/extras/tasks?**', async route => {
    const response = await route.fetch();
    await pending;
    await route.fulfill({response});
  });
  const {login} = require('./helpers.cjs');
  await login(page, 'history');
  const skeleton = page.locator('#tasks-loading');
  let widthBefore;
  try {
    await expect(skeleton).toBeVisible();
    await expect(page.locator('#tasks-list')).toHaveAttribute('aria-busy', 'true');
    const cards = skeleton.locator('.task-history-item');
    await expect(cards).toHaveCount(3);
    await expect(cards.first().locator('.task-thumbnail')).toBeVisible();
    widthBefore = (await cards.first().boundingBox()).width;
    const pieces = skeleton.locator('.skeleton-piece');
    await expect(pieces.first()).toHaveCSS('--skeleton-offset', /^-?\d+(\.\d+)?px$/);
    const offset = await pieces.last().evaluate(node => parseFloat(getComputedStyle(node).getPropertyValue('--skeleton-offset')));
    expect(offset).toBeGreaterThan(100);
    await expect(pieces.first()).toHaveCSS('background-color', /rgb/);
    await page.emulateMedia({reducedMotion: 'reduce'});
    await expect.poll(() => pieces.first().evaluate(node => getComputedStyle(node, '::after').animationName)).toBe('none');
    await page.setViewportSize({width:390, height:844});
    const first = await cards.first().boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    await page.setViewportSize({width:1280, height:900});
  } finally {
    release();
  }
  await expect(skeleton).toBeHidden();
  const loaded = page.locator('#tasks-list > tr');
  await expect(loaded).toHaveCount(3);
  expect((await loaded.first().boundingBox()).width).toBeCloseTo(widthBefore, 0);
  await expect(page.locator('#tasks-list')).not.toHaveAttribute('aria-busy');
});
