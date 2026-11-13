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
  const dialog = node('dialog', null, 'quick-palette settings-dialog atelier-panel-dialog');
  const title = node('h2', tr('Accès rapide')); title.id = 'quick-title';
  const header = node('header', null, 'atelier-card-header'), body = node('div', null, 'atelier-card-body quick-body');
  const footer = node('footer', null, 'atelier-card-footer quick-footer');
  const field = node('label', null, 'quick-field');
  dialog.setAttribute('aria-labelledby', title.id);
  const input = node('input'); input.type = 'search';
  input.setAttribute('aria-label', tr('Rechercher une section'));
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-controls', 'quick-results');
  input.setAttribute('aria-expanded', 'false');
  input.placeholder = tr('Rechercher une section');
  const results = node('div', null, 'quick-results');
  results.id = 'quick-results';
  results.setAttribute('role', 'listbox');
  results.setAttribute('aria-label', tr('Accès rapide'));
  const close = node('button', tr('Fermer'), 'dialog-close atelier-control'); close.type = 'button';
  const count = node('p', null, 'muted');
  count.setAttribute('role', 'status');
  let origin, moved;
  let recent = [];
  try {
    const saved = JSON.parse(localStorage.getItem('cloud-page-recent-searches') || '[]');
    if (Array.isArray(saved)) recent = saved.filter(value => typeof value === 'string').slice(0, 5);
  } catch {}
  const tabs = () => [...document.querySelectorAll('#atelier-tabs [data-tab]')].filter(button => !button.disabled);
  const openTab = tab => tabs().find(button => button.dataset.tab === tab)?.click();
  // Le libellé de rubrique vient de la navigation : il suit la langue et les onglets disponibles.
  const groupOf = tab => document.querySelector(`#atelier-tabs [data-tab="${tab}"]`)?.closest('[role=group]')?.getAttribute('aria-label') || '';
  const tabName = tab => document.querySelector(`#atelier-tabs [data-tab="${tab}"]`)?.textContent.trim() || '';
  const windows = [
    ['Entretien', 'overview', 'maintenance-open'],
    ['File d’attente', 'overview', 'queue-open'],
    ['Commandes courantes', 'overview', 'controls-open'],
    ['Chronologie de l’impression', 'overview', 'printer-timeline-open'],
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
      ['Onglets', tabs().map(button => [button.textContent.trim(), groupOf(button.dataset.tab), () => {
        button.click();
        const heading = document.querySelector(`#tab-${button.dataset.tab} h2`);
        if (heading) { heading.tabIndex = -1; heading.focus(); }
      }])],
      ['Fenêtres', windows.filter(([, , id]) => $(id) && !$(id).disabled && !$(id).hidden).map(([title, tab, id]) => [tr(title), tabName(tab), () => {
        openTab(tab);
        $(id).click();
      }])],
      ['Fichiers', [...document.querySelectorAll('#file-rows .file-row-caption strong')].map(name => [
        name.textContent, tabName('files'), () => { openTab('files'); $('files-search').value = name.textContent; $('files-search').dispatchEvent(new Event('input')); $('files-search').focus(); },
      ])],
      ['Historique', [...document.querySelectorAll(
        '#tasks-list:not(:empty) .history-card-name, #tasks-gallery .history-card-name',
      )].map(name => [
        name.textContent, tabName('history'), () => {
          const detail = name.closest('tr, .history-gallery-card')?.querySelector('.history-detail, .task-thumbnail');
          openTab('history');
          detail?.click();
        },
      ])],
    ];
    let total = 0;
    results.replaceChildren();
    if (!query) for (const term of recent) {
      const previous = node('button', null, 'quick-option');
      previous.append(node('span', term), node('span', tr('Recherche récente'), 'muted'));
      previous.type = 'button';
      previous.setAttribute('role', 'option');
      previous.setAttribute('aria-selected', 'false');
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
      const label = node('strong', tr(group));
      label.setAttribute('role', 'presentation');
      results.append(label);
      for (const [name, where, action] of matching) {
        const choice = node('button', null, 'quick-option'); choice.type = 'button';
        choice.append(node('span', name), node('span', where, 'muted'));
        choice.setAttribute('role', 'option');
        choice.setAttribute('aria-selected', 'false');
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
    count.textContent = total === 1 ? tr('1 résultat') : formatText('{0} résultats', total);
    if (!results.childElementCount) {
      const empty = node('p', tr('Aucune section trouvée.'));
      empty.setAttribute('role', 'presentation');
      results.append(empty);
    }
    input.setAttribute('aria-expanded', String(total > 0 || (!query && recent.length > 0)));
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
  dialog.onclose = () => {
    input.setAttribute('aria-expanded', 'false');
    if (!moved) origin?.focus();
  };
  close.onclick = () => dialog.close(); input.oninput = render;
  input.onkeydown = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('button')?.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); results.querySelector('button')?.click(); }
  };
  results.onfocusin = event => {
    for (const option of results.querySelectorAll('[role=option]'))
      option.setAttribute('aria-selected', String(option === event.target));
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
  field.append(Object.assign(node('span', null, 'quick-field-icon'), {innerHTML:
    '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>'}), input);
  header.append(title, close);
  body.append(field, results);
  const hints = node('p', null, 'quick-hints');
  for (const [keys, label] of [[['↑', '↓'], 'parcourir'], [['↵'], 'ouvrir'], [['Échap'], 'fermer']]) {
    const hint = node('span');
    hint.append(...keys.map(key => node('kbd', key)), ' ' + tr(label));
    hints.append(hint);
  }
  count.setAttribute('aria-live', 'polite');
  footer.append(hints, count);
  dialog.append(header, body, footer); document.body.append(dialog);
  document.querySelectorAll('textarea').forEach(area => {
    /** Ajuste la hauteur au contenu sans dépasser la limite visuelle de 320 pixels. */
    const grow = () => { area.style.height = 'auto'; area.style.height = `${Math.min(320, area.scrollHeight + 2)}px`; };
    area.addEventListener('input', grow); area.addEventListener('focus', grow);
  });
}
