import { $, fmt, mins, node, set, tr } from './workshop-ui.mjs?v=544c79feee4e';

/** Réunit le suivi de la tâche et des ACE à partir du relevé déjà chargé. */
export function renderSummary(snapshot) {
  const printer = snapshot.printer;
  const online = !!(snapshot.ok && printer?.printer_online);
  const printerState = !snapshot.ok ? 'Cloud indisponible' : !online ? 'Hors ligne'
    : printer.job_is_paused ? 'En pause' : printer.is_busy ? 'Impression en cours' : 'Disponible';
  set('summary-printer-status', tr(printerState));
  $('summary-printer-status').classList.toggle('offline', !online);

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
  $('summary-printer-values').replaceChildren(
    summaryValue('Temps restant', mins(printer?.job_time_remaining)),
    summaryValue('Buse', fmt(printer?.curr_nozzle_temp, ' °C')),
    summaryValue('Plateau', fmt(printer?.curr_hotbed_temp, ' °C')),
  );

  const boxes = printer?.boxes || [];
  set('summary-ace-status', tr(!boxes.length ? 'Aucun module ACE'
    : !online ? 'Hors ligne' : boxes.some(box => box.drying?.is_drying) ? 'Séchage en cours' : 'Disponible'));
  $('summary-ace-status').classList.toggle('offline', !online || !boxes.length);
  $('summary-ace-boxes').replaceChildren(...boxes.map(summaryAce));
}

/** Un libellé et sa valeur restent associés quand la grille se replie sur téléphone. */
function summaryValue(label, value) {
  const pair = node('div');
  pair.append(node('dt', tr(label)), node('dd', value));
  return pair;
}

/** Affiche un bloc par ACE et garde les mesures absentes identifiables. */
function summaryAce(box) {
  const group = node('section', null, 'summary-box');
  const metrics = node('dl', null, 'summary-values');
  metrics.append(
    summaryValue('Température', fmt(box.temperature, ' °C')),
    summaryValue('Humidité', fmt(box.humidity, ' %')),
  );
  group.append(node('h4', box.model || tr('Module ACE')), metrics);
  return group;
}
