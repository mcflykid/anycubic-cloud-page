import { $, fmt, node, single, tr, valueUnit } from './workshop-ui.mjs';

// Le Cloud renvoie 0 au lieu de rien quand le fichier n’a pas de métadonnées : ces réglages ne valent jamais 0.
const ZERO_MEANS_ABSENT = new Set([
  'layer_height', 'perimeters', 'perimeter_extrusion_width', 'temperature', 'bed_temperature',
  'outer_wall_speed', 'travel_speed',
]);

const PARAMETER_COLUMNS = [
  [
    [tr('Hauteur de couche'), 'layer_height', ' mm'],
    [tr('Parois'), 'perimeters'],
    [tr('Largeur de paroi'), 'perimeter_extrusion_width', ' mm'],
    [tr('Remplissage'), 'fill_density', ' %'],
  ],
  [
    [tr('Supports'), 'enable_support', 'boolean'],
    [tr('Adhérence'), 'brim_type', 'adhesion'],
    [tr('Buse'), 'temperature', ' °C'],
    [tr('Plateau'), 'bed_temperature', ' °C'],
  ],
  [
    [tr('Ventilation maximale'), 'fan_max_speed', ' %'],
    [tr('Rétraction'), 'filament_retract_length', ' mm'],
    [tr('Paroi externe'), 'outer_wall_speed', ' mm/s'],
    [tr('Déplacements'), 'travel_speed', ' mm/s'],
  ],
];

/** Affiche les trois bandes ; une valeur absente ou fictive (0 du Cloud) n’apparaît jamais comme une mesure. */
export function renderTaskDetails(data) {
  const hints = fileNameHints(data.name);
  const parameters = usableParameters(data.parameters);
  if (parameters.layer_height == null && hints.layerHeight != null) parameters.layer_height = hints.layerHeight;
  renderMetrics('task-detail-progress', [
    [tr('Progression'), data.progress == null ? null : fmt(data.progress, ' %')],
    [tr('Couches'), data.layerCountDisplay ?? (positive(data.layers) == null ? null : `${fmt(data.currentLayer ?? data.layers)} / ${fmt(data.totalLayers ?? data.layers)}`)],
    ...(data.timeValues ? data.timeValues.map(([label, value]) => [tr(label), value])
      : [[tr('Temps restant'), duration(data.remainingSeconds)]]),
  ]);
  // Le détail historique conserve le nom du champ Cloud ; un repli sur le nom du fichier reste identifié.
  const seconds = positive(data.estimatedSeconds) ?? positive(compactSeconds(data.estimatedTime));
  const fileValues = [
    [tr('Dimensions'), dimensions(data.dimensions)],
    seconds != null ? [tr(data.estimatedLabel || 'Temps estimé'), duration(seconds)]
      : [tr('Temps estimé'), duration(hints.seconds), tr('d’après le nom du fichier')],
    [tr('Filament estimé'), positive(data.materialGrams) == null ? null : fmt(data.materialGrams, ' g')],
  ];
  renderMetrics('past-task-data', fileValues);
  const host = $('past-task-parameters');
  host.replaceChildren();
  for (let column = 0; column < PARAMETER_COLUMNS.length; column++) {
    const list = node('dl', null, 'task-detail-metrics task-detail-parameters-column');
    list.dataset.column = String(column + 1);
    for (const [label, key, kind = ''] of PARAMETER_COLUMNS[column]) {
      const value = parameters[key];
      if (value == null) continue;
      const fromName = key === 'layer_height' && usableParameters(data.parameters).layer_height == null;
      list.append(metric(label, parameterValue(value, kind), fromName ? tr('d’après le nom du fichier') : ''));
    }
    if (list.childElementCount) host.append(list);
  }
  const partial = $('past-task-partial');
  if (partial) partial.hidden = fileValues.every(([, value, source]) => value != null && !source);
}

/** Ligne de mesure : libellé, valeur, puis l’origine quand elle n’est pas le fichier lui-même. */
function metric(label, value, source = '') {
  const row = node('div', null, 'task-detail-metric');
  row.append(node('dt', label), node('dd', value));
  if (source) row.append(node('span', source, 'task-detail-source'));
  return row;
}

/** Nombre strictement positif, sinon null : 0 signale ici une donnée manquante. */
function positive(value) {
  const number = Number(value);
  return value != null && value !== '' && Number.isFinite(number) && number > 0 ? number : null;
}

/** Retire les réglages fictifs ; si tous sont fictifs, le fichier n’en a transmis aucun. */
function usableParameters(source = {}) {
  const entries = Object.entries(source || {}).filter(([key, value]) =>
    value != null && !(ZERO_MEANS_ABSENT.has(key) && positive(single(value)) == null));
  const meaningful = entries.some(([key]) => ZERO_MEANS_ABSENT.has(key));
  const known = Object.keys(source || {}).some(key => ZERO_MEANS_ABSENT.has(key));
  return known && !meaningful ? {} : Object.fromEntries(entries);
}

/** Lit le suffixe du slicer Anycubic « _PLA_0.2_41m58s » ; null pour tout autre nom. */
export function fileNameHints(name) {
  const match = /_([A-Za-z][\w+-]*)_(\d+(?:\.\d+)?)_((?:\d+h)?(?:\d+m)?(?:\d+s)?)(?:\.\w+)?$/.exec(name || '');
  if (!match || !match[3]) return {};
  return {material: match[1], layerHeight: Number(match[2]), seconds: compactSeconds(match[3])};
}

/** Remplit une grille de mesures sans laisser de valeur absente prendre la place d'une mesure réelle. */
function renderMetrics(id, values) {
  const list = $(id);
  list.replaceChildren();
  for (const [label, value, source] of values) {
    if (value == null) continue;
    list.append(metric(label, value, source));
  }
}

/** Convertit les formats de dimensions live et historique vers leur affichage commun. */
function dimensions(value) {
  const sides = Array.isArray(value)
    ? value
    : value && ['length', 'width', 'height'].map((key) => value[key]);
  return sides?.length === 3 && sides.every((side) => positive(side) != null)
    ? `${sides.map((side) => fmt(side)).join(' × ')} mm`
    : null;
}

/** Lit le format compact du Cloud (« 3h21m55s ») ; null si le libellé a une autre forme. */
function compactSeconds(text) {
  const match = /^\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?\s*$/i.exec(text || '');
  if (!match || !match.slice(1).some(Boolean)) return null;
  return (Number(match[1] || 0) * 60 + Number(match[2] || 0)) * 60 + Number(match[3] || 0);
}

/** Durée lisible et homogène dans toute la fenêtre, par exemple « 41 min 58 s » ou « 3 h 21 min ». */
function duration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  const total = Math.max(0, Math.round(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${fmt(hours, ' h')}${minutes ? ' ' + fmt(minutes, ' min') : ''}`;
  if (minutes) return `${fmt(minutes, ' min')}${secs ? ' ' + fmt(secs, ' s') : ''}`;
  // Une tâche terminée affiche « 0 min », comme le reste de l’atelier.
  return secs ? fmt(secs, ' s') : fmt(0, ' min');
}

/** Traduit les choix du G-code dans la locale active et conserve les unités de tranche. */
function parameterValue(value, kind) {
  value = single(value);
  if (kind === 'boolean')
    return [true, 1, '1', 'true'].includes(value) ? tr('Activés') : tr('Désactivés');
  if (kind === 'adhesion')
    return ({
      no_brim: tr('Sans bordure'),
      auto_brim: tr('Automatique'),
      outer_only: tr('Bordure externe'),
      inner_only: tr('Bordure interne'),
      outer_and_inner: tr('Bordures interne et externe'),
    })[value] || tr('Activée');
  return valueUnit(value, kind);
}
