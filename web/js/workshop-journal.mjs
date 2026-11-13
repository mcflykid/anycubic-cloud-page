import { api } from './workshop-api.mjs';
import { $, fmt, formatText, locale, node, set, timeZone, tr } from './workshop-ui.mjs';

// Les clés viennent de ACTIONS dans app/command_journal.py et gardent leur valeur dans les filtres.
export const journalActionLabels = Object.freeze({
  pause: 'Pause de l’impression',
  resume: 'Reprise de l’impression',
  cancel: 'Arrêt de l’impression',
  light: 'Éclairage',
  'dry-start': 'Démarrage du séchage',
  'dry-stop': 'Arrêt du séchage',
  'auto-feed': 'Relais automatique',
  feed: 'Chargement du filament',
  retract: 'Retrait du filament',
  slot: 'Configuration de la bobine',
  settings: 'Réglages en impression',
  'idle-settings': 'Réglages au repos',
  axis: 'Déplacement des axes',
  'axis-off': 'Libération des moteurs',
  'ai-settings': 'Détection IA',
  'delete-local': 'Suppression locale',
  'delete-usb': 'Suppression USB',
  'delete-cloud': 'Suppression Cloud',
  'cloud-delete-many': 'Suppression groupée Cloud',
  'task-delete-many': 'Retrait de fiches historiques',
  'task-reprint': 'Réimpression',
  'cloud-rename': 'Renommage Cloud',
  'cloud-move': 'Déplacement Cloud',
  'task-rate': 'Évaluation de l’impression',
  'print-local': 'Impression depuis la mémoire',
  'print-usb': 'Impression depuis la clé USB',
  'print-cloud': 'Impression depuis le cloud',
  rename: 'Renommage de l’imprimante',
  firmware: 'Mise à jour de l’imprimante',
  'ace-firmware': 'Mise à jour de l’ACE',
  calibrate: 'Calibration',
  hardware: 'Configuration du matériel',
  assist: 'Options d’assistance',
  screen: 'Veille de l’écran',
  'factory-reset': 'Réinitialisation usine',
  upload: 'Envoi Cloud',
  'save-print': 'Envoi Cloud et impression',
  'temp-print': 'Impression temporaire',
  'history-delete': 'Suppression de notifications',
});
const outcomeLabels = Object.freeze({
  refusée: 'Refusée', expirée: 'Expirée', inconnue: 'Inconnue',
  envoyée: 'Envoyée', acceptée: 'Acceptée', confirmée: 'Confirmée',
});
const time = new Intl.DateTimeFormat(locale, {timeZone, hour: '2-digit', minute: '2-digit'});
const dayKey = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'});
const longDay = new Intl.DateTimeFormat(locale, {timeZone, dateStyle: 'long'});
const actionLabel = action => tr(Object.hasOwn(journalActionLabels, action) ? journalActionLabels[action] : action);

/** Met en forme les paramètres autorisés par le serveur sans interpréter les valeurs Cloud. */
function parameterLabel(action, key, value) {
  switch (key) {
    case 'enabled':
      return tr(action === 'light' ? (value ? 'Allumé' : 'Éteint') : (value ? 'Activé' : 'Désactivé'));
    case 'box': return formatText('ACE {0}', value + 1);
    case 'slot': return formatText('Emplacement {0}', value);
    case 'temperature': return fmt(value, ' °C');
    case 'hours': return fmt(value, ' h');
    default: return key + ' ' + value;
  }
}

/** Conserve les filtres et ignore les réponses obsolètes lorsque la fenêtre change d’état. */
export function bindCommandJournal(request) {
  const dialog = $('settings-logs-dialog'), form = $('journal-filters');
  const more = $('journal-more'), exportLink = $('journal-export');
  const tbody = $('journal-entries');
  let generation = 0, rows = [], total = 0;

  /** Conserve une option sélectionnée lorsqu’un filtre combiné produit un résultat vide. */
  function setOptions(select, all, choices, selected) {
    if (selected && !choices.some(option => option.value === selected))
      choices.push(new Option(select.selectedOptions[0]?.text || selected, selected));
    select.replaceChildren(new Option(tr(all), ''), ...choices);
    select.value = selected;
  }

  /** Regroupe les entrées selon le jour du conteneur et conserve les en-têtes du tableau. */
  function render() {
    const now = new Date(), today = dayKey.format(now);
    const calendarDay = new Date(today + 'T12:00:00Z');
    calendarDay.setUTCDate(calendarDay.getUTCDate() - 1);
    const yesterday = calendarDay.toISOString().slice(0, 10);
    const fragment = document.createDocumentFragment();
    let previous;
    for (const row of rows) {
      const stamp = new Date(row.time * 1000), day = dayKey.format(stamp);
      if (day !== previous) {
        const separator = node('tr', null, 'journal-day');
        const heading = node('th', day === today ? tr('Aujourd’hui') : day === yesterday
          ? tr('Hier') : longDay.format(stamp));
        heading.colSpan = 4;
        separator.append(heading);
        fragment.append(separator);
        previous = day;
      }
      const entry = node('tr', null, 'journal-row');
      const details = node('td', null, 'journal-details');
      details.append(node('strong', row.printer_name || '—'));
      const parameters = node('div', null, 'journal-parameters');
      for (const [key, value] of Object.entries(row.parameters || {})) {
        const parameter = node('span', key === 'name' ? value : parameterLabel(row.action, key, value));
        if (key === 'name') {
          parameter.className = 'journal-filename';
          parameter.tabIndex = 0;
          parameter.title = value;
        }
        parameters.append(parameter);
      }
      details.append(parameters);
      const result = node('td', null, 'journal-result');
      const badge = node('span', tr(outcomeLabels[row.outcome] || row.outcome), 'journal-badge');
      badge.dataset.outcome = row.outcome;
      result.append(badge);
      const action = node('td', null, 'journal-action');
      const mark = node('span', '›', 'journal-mark');
      mark.setAttribute('aria-hidden', 'true');
      action.append(mark, node('span', actionLabel(row.action)));
      entry.append(node('td', time.format(stamp), 'journal-time'), action, details, result);
      fragment.append(entry);
    }
    tbody.replaceChildren(fragment);
    more.hidden = rows.length >= total;
    set('journal-state', total ? formatText('{0} entrées récentes · {1} affichées', total, rows.length)
      : tr('Aucune commande pour ces filtres.'));
  }

  /** Charge une page ou une nouvelle sélection, avec la même requête de filtres pour l’export. */
  async function load(append = false) {
    const current = ++generation, filters = new URLSearchParams(new FormData(form));
    const query = new URLSearchParams(filters);
    if (append) query.set('offset', String(rows.length));
    else {
      rows = [];
      tbody.replaceChildren();
    }
    more.disabled = true;
    exportLink.hidden = true;
    set('journal-state', tr('Chargement du journal…'));
    try {
      const result = await request('/journal?' + query);
      if (current !== generation) return;
      rows = append ? [...rows, ...result.items] : result.items;
      total = result.total ?? rows.length;
      const {printer, action} = form.elements;
      setOptions(printer, 'Toutes les imprimantes',
        Object.entries(result.printers).map(([key, name]) => new Option(name || key, key)), filters.get('printer'));
      setOptions(action, 'Toutes les actions',
        result.actions.map(value => new Option(actionLabel(value), value))
          .sort((left, right) => left.text.localeCompare(right.text, locale)), filters.get('action'));
      render();
      filters.set('export', '1');
      exportLink.href = api + '/journal?' + filters;
      exportLink.hidden = !rows.length;
    } catch (error) {
      if (current !== generation) return;
      if (!append) more.hidden = true;
      set('journal-state', error.message);
    } finally {
      if (current === generation) more.disabled = false;
    }
  }
  $('settings-logs-open').onclick = () => { dialog.showModal(); void load(); };
  dialog.addEventListener('close', () => { generation++; });
  form.onsubmit = event => { event.preventDefault(); void load(); };
  form.onchange = () => void load();
  more.onclick = () => void load(true);
}
