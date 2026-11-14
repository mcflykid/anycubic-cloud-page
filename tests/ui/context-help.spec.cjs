const {test,expect}=require('@playwright/test');
const {login,openSection}=require('./helpers.cjs');

test('l’aide de la section est locale et rend le focus au bouton',async({page})=>{
  await login(page,'summary');
  for (const [section,topic,title] of [
    ['files','files','Formats de fichiers'],
    ['camera','camera','Caméra et détection IA'],
    ['fleet','network','Connexion de la Kobra S1'],
    ['ace','ace','Bobines et séchage ACE'],
  ]){
    await openSection(page,section);
    const button=page.locator(`[data-context-help="${topic}"]`);
    await button.click();
    const dialog=page.getByRole('dialog',{name:title});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link')).toHaveAttribute('href',/^https:\/\/wiki\.anycubic\.com\//);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  }
  await page.evaluate(()=>localStorage.setItem('cloud-page-language','es'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','es');
  await openSection(page,'files');
  await page.getByRole('button',{name:'Ayuda',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Formatos de archivo'})).toBeVisible();
});
