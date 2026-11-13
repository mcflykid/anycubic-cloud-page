const {test, expect} = require('@playwright/test');
const {login} = require('./helpers.cjs');

test('une intervention locale ne sollicite aucune commande physique', async ({page}) => {
  let rows = [], commands = 0;
  await page.route('**/imprimante-api/command', route => { commands++; return route.abort(); });
  await page.route('**/imprimante-api/maintenance', route => {
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON();
      if (data.action === 'save') rows = [{...data,id:'op',history:[]}];
      if (data.action === 'done') rows[0] = {...rows[0],elapsed:0,history:[{time:1794576000,hours:120,note:data.note}]};
    }
    return route.fulfill({json:{items:rows,hours:120}});
  });
  await login(page);
  await page.getByRole('button',{name:'Entretien',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Entretien'});
  await expect(dialog).toContainText('120 h');
  await dialog.getByLabel('Opération').fill('Nettoyage du plateau');
  await dialog.getByLabel('Intervalle en heures').fill('50');
  await dialog.getByRole('button',{name:'Enregistrer',exact:true}).click();
  await dialog.locator('#maintenance-note').fill('Plateau nettoyé');
  await dialog.getByRole('button',{name:'Fait',exact:true}).click();
  await page.locator('#confirm-yes').click();
  await expect(dialog).toContainText('À jour');
  await dialog.getByText('Historique des interventions').click();
  await expect(dialog.getByText(/Plateau nettoyé/)).toBeVisible();
  expect(commands).toBe(0);
});
