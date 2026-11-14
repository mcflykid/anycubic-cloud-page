const {test, expect} = require('@playwright/test');
const {login} = require('./helpers.cjs');

test('une intervention locale ne sollicite aucune commande physique', async ({page}) => {
  let rows = [], commands = 0, done;
  await page.route('**/imprimante-api/command', route => { commands++; return route.abort(); });
  await page.route('**/imprimante-api/maintenance', route => {
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON();
      if (data.action === 'save') rows = [{...data,id:'op',history:[]}];
      if (data.action === 'done') {
        done = data;
        rows[0] = {...rows[0],elapsed:0,history:[{time:1794576000,hours:120.4,note:data.note}]};
      }
    }
    return route.fulfill({json:{items:rows,hours:120.46}});
  });
  await login(page);
  await page.getByRole('button',{name:/^Entretien/}).click();
  const dialog = page.getByRole('dialog',{name:'Entretien'});
  // Le compteur reste formaté : jamais la valeur flottante brute du constructeur.
  await expect(dialog).toContainText('120,5 h');
  await expect(dialog).not.toContainText('120.46');
  await dialog.getByRole('button',{name:'Ajouter une opération'}).click();
  await dialog.getByRole('textbox',{name:'Opération',exact:true}).fill('Nettoyage du plateau');
  await dialog.getByLabel('Intervalle', {exact:true}).fill('50');
  await dialog.getByRole('button',{name:'Enregistrer',exact:true}).click();
  await dialog.getByRole('button',{name:'Marquer « Nettoyage du plateau » comme fait'}).click();
  const panel = dialog.getByRole('form',{name:'Opération faite'});
  await expect(panel.getByLabel('Compteur de l’intervention')).toHaveValue('120.4');
  await panel.getByLabel('Note (facultative)').fill('Plateau nettoyé');
  await panel.getByRole('button',{name:'Enregistrer l’intervention'}).click();
  await expect(dialog).toContainText('À jour');
  expect(done).toMatchObject({id:'op', note:'Plateau nettoyé', last_hours:null});
  await dialog.getByRole('button',{name:'Historique des interventions'}).click();
  await expect(dialog.getByText(/Plateau nettoyé/)).toBeVisible();
  expect(commands).toBe(0);
});

test('la démonstration présente des opérations du wiki dans trois unités', async ({page}) => {
  await login(page);
  await page.getByRole('button',{name:/^Entretien/}).click();
  const dialog = page.getByRole('dialog',{name:'Entretien'});
  await expect(dialog).toContainText('sans graisse');
  await expect(dialog).toContainText(' j sur 90 j');
  await expect(dialog).toContainText(' kg sur 3 kg');
  await expect(dialog.getByText('À faire',{exact:true})).toBeVisible();
});

test('le carnet d’entretien s’ouvre dans l’atelier sans commande ni renvoi vers le wiki', async ({page}) => {
  let commands = 0;
  await page.route('**/imprimante-api/command', route => { commands++; return route.abort(); });
  await login(page);
  await page.getByRole('button',{name:/^Entretien/}).click();
  const dialog = page.getByRole('dialog',{name:'Entretien'});
  // Chaque opération du registre par défaut ouvre sa fiche du carnet (#452).
  await dialog.getByRole('button',{name:'Fiche du carnet : Tiges de l’axe X'}).click();
  const guide = page.getByRole('dialog',{name:'Carnet d’entretien'});
  await expect(guide.getByRole('heading',{name:'Tiges de l’axe X'})).toBeFocused();
  await expect(guide).toContainText('Ne graissez jamais l’axe X');
  await expect(guide).toContainText('Rappel réglé dans l’atelier');
  await expect(guide.getByRole('img',{name:'Schéma : Tiges de l’axe X'})).toBeVisible();
  await guide.getByRole('button',{name:'Tous les points'}).click();
  await expect(guide.getByRole('list',{name:'Points d’entretien de la Kobra S1'}).getByRole('button')).toHaveCount(9);
  await guide.getByRole('button',{name:/Caméra/}).click();
  await expect(guide.getByRole('heading',{name:'Caméra'})).toBeVisible();
  await guide.getByRole('button',{name:'Fermer'}).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Carnet d’entretien'}).click();
  await expect(guide.getByRole('list',{name:'Points d’entretien de la Kobra S1'})).toBeVisible();
  expect(commands).toBe(0);
});
