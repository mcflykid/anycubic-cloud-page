import {mins, tr} from './workshop-ui.mjs';

/** La liste nomme l’intervalle calendaire pour ne pas le confondre avec le compteur de la machine. */
export function historyDurationText(task) {
  const data = task.duration;
  if (!data) return mins(task.elapsed_minutes);
  if (data.minutes == null) return '—';
  const label = data.kind === 'interval' ? 'Intervalle début-fin' : 'Compteur historique v2';
  return `${tr(label)} : ${mins(data.minutes)}`;
}

/** Chaque réponse reste identifiable, y compris lorsqu’elle contredit les dates de la tâche. */
export function historyDurationValues(data) {
  if (!data) return null;
  const values = [
    ['Intervalle début-fin', data.interval_minutes],
    ['Compteur historique v2', data.reported_minutes],
    ['Compteur getProjects', data.supplement_reported_minutes],
    [data.detail_source === 'project_info' ? 'Compteur du détail de secours' : 'Compteur du détail v5', data.detail_reported_minutes],
  ].filter(([, value]) => value != null).map(([label, value]) => [label, mins(value)]);
  if (!values.length) values.push(['Durée historique', '—']);
  if (data.conflict) values.push(['Comparaison des durées', tr('Valeurs divergentes')]);
  return values;
}
