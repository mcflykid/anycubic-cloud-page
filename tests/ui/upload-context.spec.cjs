const {test, expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('attend la cible du catalogue avant confirmation et envoi', async ({page}) => {
  let releasePrinters;
  let onPrintersRequested;
  const printersRequested = new Promise((resolve) => { onPrintersRequested = resolve; });
  const printersGate = new Promise((resolve) => { releasePrinters = resolve; });
  let uploads = 0;
  let uploadTarget = null;
  await page.route('**/imprimante-api/printers', async (route) => {
    onPrintersRequested();
    await printersGate;
    await route.continue();
  });
  await page.route('**/imprimante-api/upload', async (route) => {
    uploads++;
    uploadTarget = route.request().headers()['x-printer-key'] || null;
    await route.fulfill({json: {ok: true, message: 'Envoi fictif accepté'}});
  });

  try {
    await login(page);
    await printersRequested;
    await page.getByRole('button', {name: 'Envoyer et imprimer', exact: true}).click();
    const form = page.locator('#upload-form');
    await form.locator('input[type=file]').setInputFiles({
      name: 'fixture.gcode',
      mimeType: 'text/plain',
      buffer: Buffer.from('G1 X1\n'),
    });

    const submit = form.locator('button[type=submit]');
    await expect(submit).toBeDisabled();
    await expect(page.locator('#upload-state')).toContainText('imprimante explicite');
    await form.evaluate((element) => element.requestSubmit());
    await expect(page.locator('#confirm-yes')).toBeHidden();
    expect(uploads).toBe(0);

    releasePrinters();
    await expect(submit).toBeEnabled();
    await submit.click();
    await page.locator('#confirm-yes').click();
    await expect(page.locator('#upload-state')).toHaveText('Envoi fictif accepté');
    expect(uploads).toBe(1);
    expect(uploadTarget).toBe('demo-printer');
  } finally {
    releasePrinters();
  }
});
