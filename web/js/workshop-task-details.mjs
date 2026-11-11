import { $, fmt, node, single, tr, valueUnit } from './workshop-ui.mjs';

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

/** Affiche les trois bandes depuis les données courantes ou historiques disponibles. */
export function renderTaskDetails(data) {
  renderMetrics('task-detail-progress', [
    [tr('Progression'), data.progress == null ? null : fmt(data.progress, ' %')],
    [tr('Couches'), data.layerCountDisplay ?? (data.layers == null ? null : `${fmt(data.currentLayer ?? data.layers)} / ${fmt(data.totalLayers ?? data.layers)}`)],
    [tr('Temps restant'), duration(data.remainingSeconds)],
  ]);
  renderMetrics('past-task-data', [
    [tr('Dimensions'), dimensions(data.dimensions)],
    [tr('Temps estimé'), data.estimatedTime ?? duration(data.estimatedSeconds)],
    [tr('Filament estimé'), data.materialGrams == null ? null : fmt(data.materialGrams, ' g')],
  ]);
  const host = $('past-task-parameters');
  host.replaceChildren();
  for (let column = 0; column < PARAMETER_COLUMNS.length; column++) {
    const list = node('dl', null, 'task-detail-metrics task-detail-parameters-column');
    list.dataset.column = String(column + 1);
    for (const [label, key, kind = ''] of PARAMETER_COLUMNS[column]) {
      const value = data.parameters?.[key];
      if (value == null) continue;
      const row = node('div', null, 'task-detail-metric');
      row.append(node('dt', label), node('dd', parameterValue(value, kind)));
      list.append(row);
    }
    if (list.childElementCount) host.append(list);
  }
}

/** Remplit une grille de mesures sans laisser de valeur absente prendre la place d'une mesure réelle. */
function renderMetrics(id, values) {
  const list = $(id);
  list.replaceChildren();
  for (const [label, value] of values) {
    if (value == null) continue;
    const row = node('div', null, 'task-detail-metric');
    row.append(node('dt', label), node('dd', value));
    list.append(row);
  }
}

/** Convertit les formats de dimensions live et historique vers leur affichage commun. */
function dimensions(value) {
  const sides = Array.isArray(value)
    ? value
    : value && ['length', 'width', 'height'].map((key) => value[key]);
  return sides?.length === 3 && sides.every((side) => side != null)
    ? `${sides.map((side) => fmt(side)).join(' × ')} mm`
    : null;
}

/** Garde le format compact de la maquette, par exemple 3h21m55s. */
function duration(seconds) {
  if (seconds == null) return null;
  const total = Math.max(0, Math.round(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours ? `${hours}h` : ''}${minutes || (!hours && !secs) ? `${minutes}m` : ''}${secs ? `${secs}s` : ''}`;
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
