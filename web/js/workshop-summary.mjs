import { $, fmt, formatText, mins, node, set, tr } from './workshop-ui.mjs';

/** Réunit le suivi de la tâche et des ACE à partir du relevé déjà chargé. */
export function renderSummary(snapshot) {
  const printer = snapshot.printer;
  const online = !!(snapshot.ok && printer?.printer_online);
  const printerState = !snapshot.ok ? 'Cloud indisponible' : !online ? 'Hors ligne'
    : printer.job_is_paused ? 'En pause' : printer.is_busy ? 'Impression en cours' : 'Disponible';
  set('summary-printer-status', tr(printerState));
  $('summary-printer-status').classList.toggle('offline', !online);
  $('summary-printer-status').dataset.state = printer?.job_is_paused ? 'paused' : printer?.is_busy ? 'running' : '';

  set('summary-job', printer?.job_name || tr('Aucune impression en cours.'));
  const states = {
    printing: 'Impression en cours', paused: 'Impression en pause',
    finished: 'Impression terminée', completed: 'Impression terminée',
  };
  set('summary-job-state', printer?.job_name && states[printer.job_state] ? tr(states[printer.job_state]) : '');
  $('summary-job-state').hidden = !$('summary-job-state').textContent;
  const progress = printer?.job_progress;
  $('summary-progress-wrap').hidden = !Number.isFinite(progress);
  if (Number.isFinite(progress)) {
    $('summary-progress').value = progress;
    set('summary-progress-text', fmt(progress, ' %'));
  }
  const measures = [summaryValue('Temps restant', mins(printer?.job_time_remaining))];
  const layer = printer?.job_current_layer;
  const total = printer?.job_total_layers;
  if (online && (printer.job_in_progress || printer.job_is_paused) && Number.isInteger(layer) && layer > 0) {
    measures.push(summaryValue('Couche', Number.isInteger(total) && total >= layer
      ? `${fmt(layer)} / ${fmt(total)}` : fmt(layer)));
  }
  $('summary-printer-values').replaceChildren(
    ...measures,
    summaryValue('Buse', fmt(printer?.curr_nozzle_temp, ' °C')),
    summaryValue('Plateau', fmt(printer?.curr_hotbed_temp, ' °C')),
  );

  const boxes = printer?.boxes || [];
  set('summary-ace-status', tr(!boxes.length ? 'Aucun module ACE'
    : !online ? 'Hors ligne' : boxes.some(box => box.drying?.is_drying) ? 'Séchage en cours' : 'Disponible'));
  $('summary-ace-status').classList.toggle('offline', !online || !boxes.length);
  $('summary-ace-status').dataset.state = boxes.some(box => box.drying?.is_drying) ? 'running' : '';
  $('summary-ace-boxes').replaceChildren(...boxes.map((box, index) => summaryAce(box, index, printer?.filament_shortfalls)));
}

/** Un libellé et sa valeur restent associés quand la grille se replie sur téléphone. */
function summaryValue(label, value) {
  const pair = node('div');
  pair.append(node('dt', tr(label)), node('dd', value));
  return pair;
}

/** Affiche un bloc par ACE et garde les mesures absentes identifiables. */
function summaryAce(box, index, shortfalls = []) {
  const group = node('section', null, 'summary-device summary-ace-device');
  const picture = node('img', null, 'summary-device-image');
  const filename = { 'ACE 2 Pro': 'ace2pro.png', 'ACE Pro': 'ace-pro.svg' }[box.model] || 'ace.svg';
  picture.alt = '';
  picture.src = '/imprimante-api/ui/icons/' + filename;
  const information = node('div', null, 'summary-device-information');
  const heading = node('div', null, 'summary-job-heading summary-ace-heading');
  const loaded = (box.spools || []).filter(spool => spool.spool_loaded === true).length;
  heading.append(node('h4', box.model || tr('Module ACE')),
    node('p', formatText(loaded === 1 ? '{0} bobine chargée' : '{0} bobines chargées', loaded), 'muted'));
  information.append(heading);
  const dry = box.drying || {};
  if (dry.is_drying === true && Number.isFinite(dry.total_duration) && dry.total_duration > 0 && Number.isFinite(dry.remaining_time)) {
    const bar = node('progress');
    bar.id = 'summary-drying-' + index;
    bar.max = 100;
    bar.value = Math.max(0, Math.min(100, 100 * (1 - dry.remaining_time / dry.total_duration)));
    const label = node('label', dry.target_temperature == null ? tr('Séchage en cours') : formatText('Séchage à {0}', fmt(dry.target_temperature, ' °C')));
    label.htmlFor = bar.id;
    label.append(node('strong', formatText('{0} restantes', mins(dry.remaining_time))));
    const progress = node('div', null, 'atelier-progress-group');
    progress.append(label, bar);
    information.append(progress);
  } else {
    const state = dry.is_drying === true ? 'Séchage en cours' : dry.is_drying === false ? 'Séchage inactif' : 'État du séchage inconnu';
    information.append(node('p', tr(state), 'muted'));
  }
  const metrics = node('dl', null, 'atelier-measures');
  metrics.append(summaryValue('Température', fmt(box.temperature, ' °C')), summaryValue('Humidité', fmt(box.humidity, ' %')));
  information.append(metrics);
  const spools = node('ul', null, 'summary-spools');
  spools.setAttribute('aria-label', tr('Bobines'));
  for (const spool of box.spools || []) {
    const item = node('li');
    const color = node('span', null, 'summary-spool-color');
    color.setAttribute('aria-hidden', 'true');
    if (Array.isArray(spool.color) && spool.color.length >= 3 && spool.color.slice(0, 3).every(value => Number.isInteger(value) && value >= 0 && value <= 255))
      color.style.backgroundColor = `rgb(${spool.color.slice(0, 3).join(',')})`;
    // L’emplacement reporté permet de retrouver la même bobine dans l’onglet ACE.
    const slot = spool.display_slot ?? spool.slot;
    const material = spool.material_type || tr('Non renseigné');
    const label = Number.isInteger(slot) && slot > 0 ? `${slot} · ${material}` : material;
    item.append(color, node('span', label),
      node('strong', fmt(spool.remaining_percent, ' %')));
    const shortfall = shortfalls.find(entry => entry.slot === slot);
    if (shortfall) information.append(node('p', formatText('Emplacement {0} : environ {1} g restants pour {2} g estimés.',
      slot, fmt(shortfall.grams), fmt(shortfall.needed)), 'filament-shortfall'));
    spools.append(item);
  }
  if (spools.childElementCount) information.append(spools);
  group.append(picture, information);
  return group;
}
