import { tr } from './workshop-ui.mjs?v=6e32f535c683';

/** Explore une navigation par usage en déplaçant les vrais boutons ; les gestionnaires et confirmations sont conservés. */
export function initializeLabLayout() {
  const navigation = document.getElementById('atelier-tabs');
  if (!navigation) return;
  const tabs = [...navigation.querySelectorAll('[data-tab]')];
  let grouped = false;
  const groups = [
    ['Atelier', ['overview', 'ace']],
    ['Préparer', ['files', 'upload']],
    ['Observer', ['camera', 'history']],
    ['Analyser', ['statistics', 'fleet']],
    ['Configurer', ['settings']],
  ];
  /** Le retour à un autre thème restitue l’ordre initial sans reconstruire les commandes. */
  function restore() {
    if (!grouped) return;
    for (const tab of tabs) navigation.append(tab);
    navigation.querySelectorAll('.lab-nav-group').forEach(group => group.remove());
    grouped = false;
  }
  /** Les groupes restent des régions nommées contenant les neuf parcours accessibles au clavier. */
  function apply() {
    if (document.documentElement.dataset.style !== 'lab') { restore(); return; }
    if (grouped) return;
    for (const [label, keys] of groups) {
      const group = document.createElement('div');
      group.className = 'lab-nav-group'; group.setAttribute('role', 'group');
      group.setAttribute('aria-label', tr(label));
      const heading = document.createElement('span');
      heading.className = 'lab-nav-heading'; heading.textContent = tr(label);
      heading.setAttribute('aria-hidden', 'true'); group.append(heading);
      for (const key of keys) {
        const tab = tabs.find(button => button.dataset.tab === key);
        if (tab) group.append(tab);
      }
      navigation.append(group);
    }
    grouped = true;
  }
  new MutationObserver(apply).observe(document.documentElement, {attributes:true,attributeFilter:['data-style']});
  apply();
}
