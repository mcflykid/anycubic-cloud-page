const {test,expect}=require('@playwright/test');
const {login}=require('./helpers.cjs');

test('les durées historiques montrent leur nature, leurs sources et leur désaccord',async({page})=>{
  await login(page);
  const result=await page.evaluate(async()=>{
    const {historyDurationText,historyDurationValues}=await import('/imprimante-api/ui/js/workshop-history-duration.mjs');
    const duration={kind:'interval',minutes:10,interval_minutes:10,reported_minutes:20,
      supplement_reported_minutes:90,detail_reported_minutes:80,detail_source:'history_v5',conflict:true};
    return {text:historyDurationText({duration,elapsed_minutes:10}),values:historyDurationValues(duration),
      unknown:historyDurationText({duration:{kind:'unknown',minutes:null},elapsed_minutes:null})};
  });
  expect(result.text).toBe('Intervalle début-fin : 10 min');
  expect(result.values).toContainEqual(['Compteur historique v2','20 min']);
  expect(result.values).toContainEqual(['Compteur getProjects','1 h 30 min']);
  expect(result.values).toContainEqual(['Compteur du détail v5','1 h 20 min']);
  expect(result.values).toContainEqual(['Comparaison des durées','Valeurs divergentes']);
  expect(result.unknown).toBe('—');
});

test('liste et détail conservent les actions et distinguent le champ estimé Cloud',async({page})=>{
  const duration={kind:'interval',minutes:10,interval_minutes:10,reported_minutes:null,
    supplement_reported_minutes:90,detail_reported_minutes:90,detail_source:'history_v5',conflict:true};
  await page.route('**/extras/tasks?**',async route=>{
    const response=await route.fetch(),json=await response.json();
    for(const t of json.items||[])Object.assign(t,{duration,elapsed_minutes:10});
    await route.fulfill({response,json});
  });
  await page.route('**/extras/task?**',async route=>{
    const response=await route.fetch(),json=await response.json();
    Object.assign(json,{duration,estimated_seconds:600});
    await route.fulfill({response,json});
  });
  await login(page,'history');
  await expect(page.locator('#tasks-list')).toContainText('Intervalle début-fin');
  await page.locator('#tasks-list .history-detail').first().click();
  await expect(page.locator('#task-detail-progress')).toContainText('Compteur getProjects');
  await expect(page.locator('#task-detail-progress')).toContainText('Valeurs divergentes');
  await expect(page.locator('#past-task-data')).toContainText('Champ estimé Cloud');
  await expect(page.locator('#past-task-reprint')).toBeVisible();
});

test('une estimation tirée du nom ne devient pas une valeur Cloud',async({page})=>{
  await login(page);
  await page.evaluate(async()=>{
    const {renderTaskDetails}=await import('/imprimante-api/ui/js/workshop-task-details.mjs');
    renderTaskDetails({name:'fixture_PLA_0.2_1h30m.gcode',estimatedLabel:'Champ estimé Cloud',parameters:{}});
  });
  await expect(page.locator('#past-task-data')).not.toContainText('Champ estimé Cloud');
  await expect(page.locator('#past-task-data')).toContainText('d’après le nom du fichier');
  await expect(page.locator('#past-task-data')).toContainText('1 h 30 min');
});
