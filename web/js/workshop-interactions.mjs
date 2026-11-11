import { node, tr } from './workshop-ui.mjs?v=9d97ce06364c';

/** Une palette de navigation reste sans commandes physiques ; les raccourcis ne remplacent pas les champs natifs. */
export function initializeInteractions() {
  const header = document.querySelector('.nav-actions');
  if (!header) return;
  const open = node('button', tr('Accès rapide'));
  open.type = 'button'; open.className = 'quick-open';
  open.setAttribute('aria-keyshortcuts', 'Control+k Meta+k');
  const dialog = node('dialog', null, 'quick-palette');
  const title = node('h2', tr('Accès rapide')); title.id = 'quick-title';
  dialog.setAttribute('aria-labelledby', title.id);
  const input = node('input'); input.type = 'search';
  input.setAttribute('aria-label', tr('Rechercher une section'));
  input.placeholder = tr('Rechercher une section');
  const results = node('div', null, 'quick-results');
  const close = node('button', tr('Fermer')); close.type = 'button';
  /** Filtre les onglets visibles et crée des boutons sans interpréter leur texte comme du HTML. */
  const render = () => {
    const query = input.value.trim().toLocaleLowerCase();
    results.replaceChildren(...[...document.querySelectorAll('#atelier-tabs [data-tab]')]
      .filter(button => !button.disabled && button.textContent.toLocaleLowerCase().includes(query))
      .map(button => {
        const choice = node('button', button.textContent.trim()); choice.type = 'button';
        choice.onclick = () => {
          dialog.close(); button.click();
          const heading = document.querySelector(`#tab-${button.dataset.tab} h2`);
          if (heading) { heading.tabIndex = -1; heading.focus(); }
        };
        return choice;
      }));
    if (!results.childElementCount) results.append(node('p', tr('Aucune section trouvée.')));
  };
  /** Ouvre la palette modale, vide la recherche précédente et place le focus dans son champ. */
  const show = () => { if (dialog.open) return; input.value = ''; render(); dialog.showModal(); input.focus(); };
  open.onclick = show; close.onclick = () => dialog.close(); input.oninput = render;
  input.onkeydown = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('button')?.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); results.querySelector('button')?.click(); }
  };
  results.onkeydown = event => {
    if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...results.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement), delta = event.key === 'ArrowDown' ? 1 : -1;
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  };
  document.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k' || event.altKey) return;
    if (event.target.closest('input,textarea,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
    event.preventDefault(); show();
  });
  dialog.append(title, input, results, close); document.body.append(dialog); header.prepend(open);
  document.querySelectorAll('textarea').forEach(area => {
    /** Ajuste la hauteur au contenu sans dépasser la limite visuelle de 320 pixels. */
    const grow = () => { area.style.height = 'auto'; area.style.height = `${Math.min(320, area.scrollHeight + 2)}px`; };
    area.addEventListener('input', grow); area.addEventListener('focus', grow);
  });
}
