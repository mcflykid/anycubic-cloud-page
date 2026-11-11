import { $, confirmAction, fmt, formatText, set, tr } from './workshop-ui.mjs';
import { openErrorSheet } from './workshop-error-catalogue.mjs';
import { workshopState } from './workshop-state.mjs';

const temperatureNames = ['target_nozzle_temp', 'target_hotbed_temp'];
// Les coordonnées du schéma S1 reprennent celles de la maquette dans son repère 320 × 368.
const organPoints = {nozzle: [115, 102], part: [115, 81], auxiliary: [200, 140], circulation: [78, 175], bed: [160, 228]};
const svgNamespace = 'http://www.w3.org/2000/svg';

/** Valide le pourcentage Cloud de circulation, y compris les petites valeurs de 1 à 3. */
export function circulationPercent(level) {
  return Number.isInteger(level) && level >= 0 && level <= 100 ? level : null;
}

/** Dessine des repères propres à l’illustration, jusqu’au centre de chaque libellé. */
function connectOrgans(dialog, diagram, connectors) {
  const rect = connectors.getBoundingClientRect();
  if (!dialog.open || !rect.width || diagram.hasAttribute('hidden')) {
    connectors.replaceChildren();
    return;
  }
  const artwork = diagram.getBoundingClientRect();
  const view = diagram.viewBox.baseVal;
  const bendX = artwork.x + artwork.width * 260 / view.width - rect.x;
  const shapes = [];
  for (const [name, [left, top]] of Object.entries(organPoints)) {
    const row = dialog.querySelector(`[data-organ="${name}"]`);
    const label = row.querySelector('label').getBoundingClientRect();
    const x = artwork.x + artwork.width * left / view.width - rect.x;
    const y = artwork.y + artwork.height * top / view.height - rect.y;
    const endX = label.x - rect.x;
    const endY = label.y + label.height / 2 - rect.y;
    const line = document.createElementNS(svgNamespace, 'polyline');
    line.setAttribute('points', `${x},${y} ${bendX},${endY} ${endX},${endY}`);
    line.dataset.organ = name;
    const point = document.createElementNS(svgNamespace, 'circle');
    point.setAttribute('cx', x);
    point.setAttribute('cy', y);
    point.setAttribute('r', '5');
    point.dataset.organ = name;
    shapes.push(line, point);
  }
  connectors.replaceChildren(...shapes);
}

/** Réutilise les commandes et la confirmation habituelles avec une seule vue d’atelier. */
export function createCurrentControls(command) {
  const dialog = $('controls-dialog'), form = $('settings-form');
  const diagram = $('controls-s1-diagram'), connectors = $('controls-connectors');
  const status = $('controls-machine-state'), light = $('control-light-state'), speed = $('speed-mode');
  const help = $('control-error-help');
  let sequence = false;

  const redraw = () => connectOrgans(dialog, diagram, connectors);
  const resize = new ResizeObserver(redraw);
  resize.observe(form);
  resize.observe(diagram);

  function feedback(message, errorSheet) {
    set('control-feedback', message);
    help.hidden = !errorSheet;
    help.onclick = errorSheet ? () => openErrorSheet(errorSheet) : null;
  }

  function disable() {
    form.querySelectorAll('input,select,button').forEach(control => { control.disabled = true; });
    status.dataset.state = 'unknown';
    status.textContent = tr('État inconnu');
    light.dataset.state = 'unknown';
    light.textContent = tr('État inconnu');
    for (const id of ['control-light-on', 'control-light-off']) $(id).hidden = false;
  }

  function render(printer) {
    const active = !!printer.job_in_progress;
    const online = workshopState.snapshot?.ok && printer.printer_online === true;
    status.dataset.state = online ? 'ready' : 'unknown';
    const idle = printer.is_available && !printer.is_busy;
    status.textContent = tr(!online ? 'Hors ligne' : active ? 'Impression en cours' : idle ? 'Au repos' : 'Imprimante occupée');
    for (const control of form.querySelectorAll('input,select,button[type=submit]'))
      control.disabled = !online;
    const limits = (active ? printer.print_limits : printer.idle_limits) || {};
    for (const [organ, measure, unit] of [
      ['nozzle', printer.curr_nozzle_temp, ' °C'],
      ['part', printer.fan_speed_pct, ' %'],
      ['auxiliary', printer.aux_fan_speed_pct, ' %'],
      ['circulation', circulationPercent(printer.box_fan_level), ' %'],
      ['bed', printer.curr_hotbed_temp, ' °C'],
    ]) {
      const input = $(`current-${organ}`);
      const pair = limits[input.name];
      const value = fmt(measure, unit);
      if (temperatureNames.includes(input.name)) {
        if (pair) input.max = pair[1];
        else input.removeAttribute('max');
      }
      set(`current-${organ}-reading`, pair
        ? formatText('Actuelle {0} · max {1}', value, fmt(pair[1], unit))
        : formatText('Actuelle {0}', value));
    }
    const modes = printer.speed_modes || [];
    const modeKey = JSON.stringify(modes);
    if (modeKey !== speed.dataset.values) {
      const previous = speed.value;
      speed.replaceChildren(new Option(tr('Inchangé'), ''), ...modes.map(mode => {
        const name = mode.description ?? mode.name ?? mode.label;
        const value = mode.mode ?? mode.value ?? mode.code ?? mode.id;
        return new Option(name === 'Quiet' ? tr('Silencieux') : name || String(value), value);
      }));
      speed.value = Array.from(speed.options).some(option => option.value === previous) ? previous : '';
      speed.dataset.values = modeKey;
    }

    const enabled = printer.camera_light;
    light.dataset.state = enabled === true ? 'ready' : 'unknown';
    light.textContent = tr(enabled === true ? 'Allumé' : enabled === false ? 'Éteint' : 'État inconnu');
    for (const [id, value] of [['control-light-on', true], ['control-light-off', false]]) {
      $(id).hidden = enabled === value;
      $(id).disabled = !online;
    }
    help.disabled = false;
  }

  $('controls-open').onclick = () => {
    form.reset();
    feedback('');
    dialog.showModal();
    redraw();
  };
  for (const [id, enabled] of [['control-light-on', true], ['control-light-off', false]]) {
    $(id).onclick = () => command('light', {enabled, light_type: 3},
      tr(enabled ? 'Allumer l’éclairage de l’imprimante ?' : 'Éteindre l’éclairage de l’imprimante ?'), feedback);
  }

  form.onsubmit = async event => {
    event.preventDefault();
    if (sequence) return;
    if (!workshopState.snapshot?.ok) return feedback(tr('État inconnu'));
    const snapshot = workshopState.snapshot;
    const target = workshopState.selectedPrinter;
    const active = !!snapshot?.printer?.job_in_progress;
    const project = snapshot?.printer?.command_project;
    const values = Object.fromEntries(Array.from(new FormData(form)).filter(([, value]) => value !== ''));
    if (!Object.keys(values).length) return feedback(tr('Aucun réglage fourni'));
    const submitted = { ...values };
    const limits = (active ? snapshot.printer.print_limits : snapshot.printer.idle_limits) || {};
    for (const name of temperatureNames) {
      if (name in values && (!limits[name] || (+values[name] !== 0 && +values[name] < limits[name][0])))
        return feedback(tr('Limites de température indisponibles ou valeur hors limites.'));
    }
    if (!active && 'print_speed_mode' in values)
      return feedback(tr('Le mode de vitesse nécessite une impression active.'));

    // L’ordre natif n’accepte qu’une famille de commandes au repos.
    const temperatures = Object.fromEntries(Object.entries(values).filter(([name]) => temperatureNames.includes(name)));
    const groups = active ? [[null, values]] : [
      ['Températures', temperatures],
      ['Pièce', 'fan_speed_pct' in values ? {fan_speed_pct: values.fan_speed_pct} : {}],
      ['Auxiliaire', 'aux_fan_speed_pct' in values ? {aux_fan_speed_pct: values.aux_fan_speed_pct} : {}],
      ['Circulation', 'box_fan_level' in values ? {box_fan_level: values.box_fan_level} : {}],
    ].filter(([, entries]) => Object.keys(entries).length);
    sequence = true;
    try {
      if (!await confirmAction(tr(active
        ? 'Appliquer ces réglages à l’impression active ?'
        : 'Appliquer ces réglages à l’imprimante au repos ? Vérifiez le plateau et les matériaux présents.')))
        return;
      for (const [name, entries] of groups) {
        const current = workshopState.snapshot?.printer;
        if (!dialog.open || target !== workshopState.selectedPrinter || active !== !!current?.job_in_progress ||
            (active && project !== current?.command_project))
          return feedback(tr('La cible a changé : commande annulée.'));
        const result = await command(active ? 'settings' : 'idle-settings',
          active ? entries : {...entries, confirmed: true}, null, (message, sheet) =>
            feedback(name ? `${tr(name)} · ${message}` : message, sheet));
        if (!result) return;
        for (const key of Object.keys(entries))
          if (form.elements[key].value === submitted[key]) form.elements[key].value = '';
      }
    } finally {
      sequence = false;
    }
  };
  return {render, disable};
}
