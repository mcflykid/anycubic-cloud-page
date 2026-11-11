const { test, expect } = require('@playwright/test');
const { login, openSection } = require('./helpers.cjs');

test('les aperçus absents ont un état visuel distinct et explicite', async ({ page }) => {
  let requests = 0;
  await page.route('**/extras/task-preview*', (route) => {
    requests++;
    return route.fulfill({ json: { image: null } });
  });
  await login(page);
  await openSection(page, 'history');
  await expect.poll(() => requests).toBeGreaterThan(0);
  const preview = page.locator('#tasks-list .task-thumbnail').first();
  await expect(preview).toHaveAttribute('data-preview-state', 'unavailable');
  await expect(preview).not.toHaveAttribute('aria-busy', 'true');
  await expect(preview.locator('span')).toHaveText('Aperçu indisponible');
  const icon = await preview.locator('span').evaluate((element) =>
    getComputedStyle(element, '::before').backgroundImage,
  );
  expect(icon).toContain('data:image/svg+xml');
  await page.screenshot({ path: 'test-results/visual-preview-unavailable.png', animations: 'disabled' });
});

test('l’historique vide utilise son illustration et garde le texte accessible', async ({ page }) => {
  await page.route('**/imprimante-api/extras/tasks?*', (route) =>
    route.fulfill({ json: { items: [], page: 1, has_more: false } }),
  );
  await login(page);
  await openSection(page, 'history');
  const empty = page.locator('#tasks-state');
  await expect(empty).toHaveAttribute('data-visual-state', 'empty');
  await expect(empty).toHaveText("Aucun historique d'impression");
  const icon = await empty.evaluate((element) => getComputedStyle(element, '::before').backgroundImage);
  expect(icon).toContain('data:image/svg+xml');
  await page.screenshot({ path: 'test-results/visual-history-empty.png', animations: 'disabled' });
});

test('un aperçu courant annonce attente puis indisponibilité sans faux succès', async ({ page }) => {
  let releasePreview;
  await page.route('**/imprimante-api/status', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.printer.job_name = 'fixture.gcode';
    data.printer.command_project = 'fixture-project';
    await route.fulfill({ response, json: data });
  });
  await page.route('**/imprimante-api/preview', async (route) => {
    await new Promise((resolve) => { releasePreview = resolve; });
    await route.fulfill({ json: { image: null } });
  });
  await login(page);
  const state = page.locator('#job-preview-state');
  await expect(state).toHaveAttribute('data-preview-state', 'loading');
  await expect(state).toHaveText('Chargement de l’aperçu…');
  expect(await state.evaluate((element) => getComputedStyle(element, '::before').backgroundImage)).toContain('data:image/svg+xml');
  releasePreview();
  await expect(state).toHaveAttribute('data-preview-state', 'waiting');
  await expect(state).toContainText('Aperçu en attente');
  await expect(page.locator('#job-preview')).toBeHidden();
  await page.screenshot({ path: 'test-results/visual-preview-waiting.png', animations: 'disabled' });
});

test('les illustrations restent lisibles en sombre sur mobile et respectent le mouvement réduit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.route('**/imprimante-api/extras/tasks?*', (route) =>
    route.fulfill({ json: { items: [], page: 1, has_more: false } }),
  );
  await login(page);
  await openSection(page, 'history');
  const empty = page.locator('#tasks-state');
  await expect(empty).toHaveAttribute('data-visual-state', 'empty');
  const box = await empty.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeLessThanOrEqual(390);
  const status = page.locator('#job-preview-state');
  await status.evaluate((element) => {
    element.hidden = false;
    element.dataset.previewState = 'loading';
  });
  const motion = await status.evaluate((element) =>
    getComputedStyle(element, '::before').animationName,
  );
  expect(motion).toBe('none');
  await page.screenshot({ path: 'test-results/visual-history-empty-dark-mobile.png', fullPage: true, animations: 'disabled' });
});
