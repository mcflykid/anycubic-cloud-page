import { $, formatText, locale, node, tr } from './workshop-ui.mjs';

/** Rend les noms comparables quel que soit le clavier utilisé. */
function searchText(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase(locale);
}

/** Accepte une lettre manquante, ajoutée, remplacée ou permutée dans un mot suffisamment long. */
function nearWord(word, candidate) {
  if (candidate.includes(word)) return true;
  if (word.length < 4 || Math.abs(word.length - candidate.length) > 1) return false;
  let offset = 0;
  while (offset < word.length && word[offset] === candidate[offset]) offset++;
  const left = word.slice(offset), right = candidate.slice(offset);
  if (left.length !== right.length)
    return left.length > right.length ? left.slice(1) === right : right.slice(1) === left;
  return left.slice(1) === right.slice(1) ||
    (left[0] === right[1] && left[1] === right[0] && left.slice(2) === right.slice(2));
}

/** Une palette de navigation reste sans commandes physiques ; les raccourcis ne remplacent pas les champs natifs. */
export function initializeInteractions() {
  if (!document.getElementById('atelier-tabs')) return;
  const dialog = node('dialog', null, 'quick-palette');
  const title = node('h2', tr('Accès rapide')); title.id = 'quick-title';
  dialog.setAttribute('aria-labelledby', title.id);
  const input = node('input'); input.type = 'search';
  input.setAttribute('aria-label', tr('Rechercher une section'));
  input.placeholder = tr('Rechercher une section');
  const results = node('div', null, 'quick-results');
  const close = node('button', tr('Fermer')); close.type = 'button';
  const count = node('p', null, 'sr-only');
  count.setAttribute('role', 'status');
  let origin, moved;
  let recent = [];
  try {
    const saved = JSON.parse(localStorage.getItem('cloud-page-recent-searches') || '[]');
    if (Array.isArray(saved)) recent = saved.filter(value => typeof value === 'string').slice(0, 5);
  } catch {}
  const tabs = () => [...document.querySelectorAll('#atelier-tabs [data-tab]')].filter(button => !button.disabled);
  const openTab = tab => tabs().find(button => button.dataset.tab === tab)?.click();
  const windows = [
    ['Détection IA', 'settings', 'ai-open'],
    ['Journal des commandes', 'settings', 'settings-logs-open'],
    ['Régler le séchage', 'ace', 'go-drying'],
    ['Période de l’historique', 'history', 'history-period-open'],
    ['Journal historique', 'history', 'historical-notifications-open'],
  ];
  const trigger = $('quick-open');
  /** Filtre les onglets visibles et crée des boutons sans interpréter leur texte comme du HTML. */
  const render = () => {
    const query = searchText(input.value.trim());
    const groups = [
      ['Onglets', tabs().map(button => [button.textContent.trim(), () => {
        button.click();
        const heading = document.querySelector(`#tab-${button.dataset.tab} h2`);
        if (heading) { heading.tabIndex = -1; heading.focus(); }
      }])],
      ['Fenêtres', windows.filter(([, , id]) => $(id) && !$(id).disabled).map(([title, tab, id]) => [tr(title), () => {
        openTab(tab);
        $(id).click();
      }])],
      ['Fichiers', [...document.querySelectorAll('#file-rows .file-row-caption strong')].map(name => [
        name.textContent, () => { openTab('files'); $('files-search').value = name.textContent; $('files-search').dispatchEvent(new Event('input')); $('files-search').focus(); },
      ])],
      ['Historique', [...document.querySelectorAll(
        '#tasks-list:not(:empty) .history-card-name, #tasks-gallery .history-card-name',
      )].map(name => [
        name.textContent, () => {
          const detail = name.closest('tr, .history-gallery-card')?.querySelector('.history-detail, .task-thumbnail');
          openTab('history');
          detail?.click();
        },
      ])],
    ];
    let total = 0;
    results.replaceChildren();
    if (!query) for (const term of recent) {
      const previous = node('button', term);
      previous.type = 'button';
      previous.onclick = () => { input.value = term; render(); input.focus(); };
      results.append(previous);
    }
    for (const [group, entries] of groups) {
      const matching = entries.filter(([name]) => {
        const candidate = searchText(name);
        return candidate.includes(query) || query.split(/\s+/).every(word =>
          candidate.split(/\s+/).some(part => nearWord(word, part)));
      }).slice(0, 8);
      if (!matching.length) continue;
      total += matching.length;
      results.append(node('strong', tr(group)));
      for (const [name, action] of matching) {
        const choice = node('button', name); choice.type = 'button';
        choice.onclick = () => {
          const term = input.value.trim().slice(0, 100);
          if (term) {
            recent = [term, ...recent.filter(value => value !== term)].slice(0, 5);
            try { localStorage.setItem('cloud-page-recent-searches', JSON.stringify(recent)); } catch {}
          }
          moved = true;
          dialog.close();
          action();
        };
        results.append(choice);
      }
    }
    count.textContent = formatText('{0} résultat(s)', total);
    if (!results.childElementCount) results.append(node('p', tr('Aucune section trouvée.')));
  };
  /** Ouvre la palette modale, vide la recherche précédente et place le focus dans son champ. */
  const show = () => {
    if (dialog.open) return;
    origin = document.activeElement;
    moved = false;
    input.value = '';
    render();
    dialog.showModal();
    input.focus();
  };
  trigger.onclick = show;
  dialog.onclose = () => { if (!moved) origin?.focus(); };
  close.onclick = () => dialog.close(); input.oninput = render;
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
  dialog.append(title, input, count, results, close); document.body.append(dialog);
  document.querySelectorAll('textarea').forEach(area => {
    /** Ajuste la hauteur au contenu sans dépasser la limite visuelle de 320 pixels. */
    const grow = () => { area.style.height = 'auto'; area.style.height = `${Math.min(320, area.scrollHeight + 2)}px`; };
    area.addEventListener('input', grow); area.addEventListener('focus', grow);
  });
}
