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
