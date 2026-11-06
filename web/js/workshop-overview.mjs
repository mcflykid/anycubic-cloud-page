import {
  $,
  date,
  fmt,
  formatText,
  locale,
  mins,
  node,
  set,
  tr,
} from './workshop-ui.mjs?v=9c50a4daf36a';
import { workshopState } from './workshop-state.mjs?v=6ff13ce4bb7f';

export let previewJob = null;
/** Remplit une liste descriptive par textContent pour que les valeurs cloud restent du texte. */
export function definition(target, values) {
  const dl = $(target);
  dl.replaceChildren(
    ...values.map(([label, value]) => {
      const div = node('div');
      const title = node('dt', tr(label));
      if (['temperatures', 'details', 'ace-stats', 'control-metrics', 'task-file', 'task-parameters'].includes(target))
        decorateMetric(title, metricIcons[label]);
      div.append(title, node('dd', value));
      return div;
    }),
  );
}
const metricPaths = {
  nozzle: 'M6 3h12v6l-6 5-6-5zM12 14v4m-6 3h12',
  bed: 'M3 13h18v4H3zM6 17v4m12-4v4M8 9V5m4 4V3m4 6V5',
  ace: 'M3 6h18v12H3zM6 10h12m-12 4h2m2 0h2m2 0h2m2 0h2',
  fan: 'M12 12c-3-2-7-1-7 2 0 2 4 3 7-2 3 2 7 1 7-2 0-2-4-3-7 2 1 3 0 6-2 6',
  gauge: 'M4 16a8 8 0 1 1 16 0M12 15l3-4',
  model: 'M12 3l8 4v10l-8 4-8-4V7zM4 7l8 4 8-4m-8 4v10',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l4 2',
  settings: 'M4 7h16M4 17h16M8 5v4m8 6v4',
  layers: 'M3 8l9-4 9 4-9 4zM3 12l9 4 9-4m-18 4 9 4 9-4',
  thermometer: 'M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0zM12 9v8',
  drop: 'M12 3c-3 4-6 7-6 11a6 6 0 1 0 12 0c0-4-3-7-6-11z',
  relay: 'M6 8h12a4 4 0 0 1 0 8H6a4 4 0 0 1 0-8zm1 2v4',
};
const metricIcons = {
  Dimensions: 'model',
  Couches: 'layers',
  'Temps estimé': 'clock',
  'Filament estimé': 'ace',
  'Hauteur de couche': 'layers',
  Remplissage: 'settings',
  Supports: 'layers',
  'Adhérence au plateau': 'bed',
  Buse: 'nozzle',
  Plateau: 'bed',
  'Ventilation maximale': 'fan',
  Rétraction: 'relay',
  Parois: 'model',
  'Largeur de paroi': 'model',
  'Vitesse de paroi externe': 'gauge',
  Déplacements: 'gauge',
  'Buse actuelle / cible': 'nozzle',
  'Plateau actuel / cible': 'bed',
  'Ventilation pièce': 'fan',
  'Ventilation auxiliaire': 'fan',
  'Ventilation enceinte': 'fan',
  Modèle: 'model',
  Micrologiciel: 'settings',
  'Temps total': 'clock',
  'Nombre d’impressions': 'layers',
  'Filament utilisé': 'ace',
  'Fin estimée': 'clock',
  'Épaisseur de couche': 'layers',
  'Mode de vitesse': 'gauge',
  'Vitesse (%)': 'gauge',
  Température: 'thermometer',
  Humidité: 'drop',
  'Relais automatique': 'relay',
};
/** Les pictogrammes décorent les libellés et gardent les mesures textuelles. */
function decorateMetric(label, icon) {
  if (!icon) return;
  const ns = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(ns, 'svg'),
    path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'metric-icon');
  path.setAttribute('d', metricPaths[icon]);
  svg.append(path);
  label.prepend(svg);
}
for (const title of document.querySelectorAll('[data-metric-icon]'))
  decorateMetric(title, title.dataset.metricIcon);
const detailNames = {
  job_eta: tr('Fin estimée'),
  job_z_thick: tr('Épaisseur de couche'),
  job_model_height: tr('Hauteur du modèle'),
  job_speed_mode: tr('Mode de vitesse'),
  print_speed_pct: 'Vitesse (%)',
  job_anti_alias_count: tr('Anticrénelage'),
  job_on_time: 'Exposition',
  job_off_time: tr('Pause exposition'),
  job_bottom_time: tr('Exposition de base'),
  job_bottom_layers: tr('Couches de base'),
  job_z_up_height: tr('Levée Z'),
  job_z_up_speed: tr('Vitesse de levée Z'),
  job_z_down_speed: tr('Vitesse de descente Z'),
};
/** Garde le texte de statut et la couleur synchronisés avec la dernière mesure. */
export function statusBadge(id, text, active) {
  const badge = $(id);
  if (badge.textContent !== text) badge.textContent = text;
  badge.classList.toggle('inactive', active === false);
  badge.classList.toggle('offline', active == null);
}
const hardwareIcons = '/imprimante-api/ui/icons/';
const printerIllustrations = new Map([
  ['kobra s1', 'kobra-s1.svg'],
  ['kobra s1 combo', 'kobra-s1.svg'],
  ['kobra 3', 'kobra-3.svg'],
  ['kobra 3 combo', 'kobra-3.svg'],
  ['kobra x', 'kobra-x.svg'],
  ['kobra x combo', 'kobra-x.svg'],
]);
/** Les illustrations suivent le modèle constructeur et la génération explicitement rapportée. */
function renderHardware(printer) {
  const model = printer.machine_name || printer.name || tr('Imprimante');
  const box = printer.boxes?.[0];
  const generation = box?.model;
  const aceName = box ? generation || tr('Module ACE') : tr('Aucun module ACE');
  const setImage = (id, source, fallback) => {
    const image = $(id);
    if (image.dataset.illustration === source) return;
    image.dataset.illustration = source;
    image.onerror = fallback ? () => {
      image.onerror = null;
      image.src = hardwareIcons + fallback;
    } : null;
    image.src = hardwareIcons + source;
  };
  set('printer-model', model);
  set('printer-accessory', aceName);
  $('printer-accessory').hidden = !box;
  const modelKey = String(printer.machine_name || '')
    .trim()
    .toLowerCase()
    .replace(/^anycubic\s+/, '')
    .replace(/\s+/g, ' ');
  const illustration = printerIllustrations.get(modelKey);
  const s1Combo = illustration === 'kobra-s1.svg' && generation === 'ACE 2 Pro';
  const printerImage = s1Combo ? 'kobra-s1-ace2pro.png' : illustration || 'printer.svg';
  const printerFallback = s1Combo ? illustration : illustration ? 'printer.svg' : null;
  setImage('printer-illustration', printerImage, printerFallback);
  set('ace-model', aceName);
  set('firmware-printer-model', model);
  set('firmware-ace-model', aceName);
  set('chart-ace-name', box ? generation || tr('Module ACE') : tr('Module ACE'));
  setImage('settings-printer-illustration', printerImage, printerFallback);
  $('ace-illustration').hidden = !box;
  setImage(
    'ace-illustration',
    generation === 'ACE 2 Pro'
        ? 'ace2pro.png'
        : generation === 'ACE Pro'
          ? 'ace-pro.svg'
          : 'ace.svg',
    generation ? 'ace.svg' : null,
  );
}

/** Affiche l’état courant et charge l’aperçu du projet actif. */
export function createOverview(request) {
  /** Réessaie un aperçu indisponible avec un délai borné et ignore les réponses d’un ancien projet. */
  function renderJobPreview(printer) {
    const key = printer.job_name && (printer.command_project || printer.job_name);
    const image = $('job-preview');
    if (!key || previewJob?.key !== key) {
      image.hidden = true;
      previewJob = key ? { key, attempts: 0, next: 0, pending: false, done: false } : null;
    }
    const current = previewJob;
    if (
      !current ||
      current.done ||
      current.pending ||
      current.attempts >= 3 ||
      Date.now() < current.next
    )
      return;
    current.attempts++;
    current.pending = true;
    request('/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'local', name: printer.job_name }),
    })
      .then((result) => {
        if (previewJob === current && result.image) {
          image.src = result.image;
          image.hidden = false;
          current.done = true;
        }
      })
      .catch(() => {})
      .finally(() => {
        current.pending = false;
        current.next = Date.now() + 10000;
      });
  }
  /** Affiche l’état courant et autorise les commandes selon le projet, sans assimiler l’absence de données à un succès. */
  function renderOverview(p) {
    renderHardware(p);
    renderJobPreview(p);
    const state = !p.printer_online
      ? tr('Hors ligne')
      : p.job_is_paused
        ? tr('En pause')
        : p.is_busy
          ? tr('Impression en cours')
          : tr('Disponible');
    statusBadge(
      'printer-status',
      state,
      p.printer_online ? (p.job_is_paused ? null : true) : false,
    );
    $('job-name').dataset.tooltip = p.job_name || tr('Imprimante prête');
    set(
      'job-name',
      p.job_name ||
        (!p.printer_online
          ? tr('L’imprimante est hors ligne.')
          : p.is_busy
            ? tr('Impression en cours')
            : tr('Prête pour la prochaine création.')),
    );
    set(
      'job-state',
      p.job_name
        ? {
            printing: tr('Impression en cours'),
            paused: tr('Impression en pause'),
            finished: tr('Impression terminée'),
            completed: tr('Impression terminée'),
          }[p.job_state] || fmt(p.job_state)
        : p.is_busy
          ? tr('Le cloud n’a pas encore fourni le projet.')
          : tr('Aucune impression en cours.'),
    );
    $('job-state').hidden = $('job-state').textContent === state;
    $('job-progress-wrap').hidden = p.job_progress == null;
    if (p.job_progress != null) {
      $('job-progress').value = p.job_progress;
      set('job-progress-text', fmt(p.job_progress, ' %'));
    }
    definition('job-stats', [
      ['Temps écoulé', mins(p.job_time_elapsed)],
      ['Temps restant', mins(p.job_time_remaining)],
      [
        'Couches',
        p.job_current_layer == null ? '—' : `${p.job_current_layer} / ${p.job_total_layers ?? '—'}`,
      ],
    ]);
    const measurements = [
      [
        'Buse actuelle / cible',
        `${fmt(p.curr_nozzle_temp, ' °C')} / ${fmt(p.target_nozzle_temp, ' °C')}`,
      ],
      [
        'Plateau actuel / cible',
        `${fmt(p.curr_hotbed_temp, ' °C')} / ${fmt(p.target_hotbed_temp, ' °C')}`,
      ],
      ['Ventilation pièce', fmt(p.fan_speed_pct, ' %')],
      ['Ventilation auxiliaire', fmt(p.aux_fan_speed_pct, ' %')],
      ['Ventilation enceinte', fmt(p.box_fan_level)],
    ];
    definition('temperatures', measurements);
    definition('control-metrics', measurements);
    set(
      'control-light-state',
      p.camera_light === true
        ? tr('Allumé')
        : p.camera_light === false
          ? tr('Éteint')
          : tr('État inconnu'),
    );
    for (const id of ['control-light-on', 'control-light-off'])
      $(id).disabled = !workshopState.snapshot.ok || !p.printer_online;
    definition('details', [
      ['Modèle', p.machine_name || '—'],
      ['Micrologiciel', fmt(p.firmware)],
      ['Temps total', fmt(p.statistics?.hours, ' h')],
      ['Nombre d’impressions', fmt(p.statistics?.print_count)],
      [
        'Filament utilisé',
        String(p.statistics?.material ?? '—').replace(
          /([0-9.]+)\s*(kg|g)$/,
          (_, n, u) => Number(n).toLocaleString(locale, { maximumFractionDigits: 2 }) + ' ' + u,
        ),
      ],
      ...Object.entries(detailNames)
        .filter(([key]) => p[key] != null)
        .map(([key, label]) => [label, key === 'job_eta' ? date(p[key]) : fmt(p[key])]),
    ]);
    for (const action of ['pause', 'resume', 'cancel'])
      document.querySelector(`[data-command="${action}"]`).disabled =
        !p.job_in_progress ||
        !p.command_project ||
        (action === 'pause' && p.job_is_paused) ||
        (action === 'resume' && !p.job_is_paused);
    renderFirmware(p);
    set(
      'settings-availability',
      workshopState.snapshot.ok && p.job_in_progress
        ? tr('Réglages disponibles')
        : tr('Disponibles pendant une impression'),
    );
    $('settings-form')
      .querySelectorAll('input,select,button')
      .forEach((e) => (e.disabled = !workshopState.snapshot.ok || !p.job_in_progress));
    if (!$('rename-form').dataset.loaded) {
      $('rename-form').elements.name.value = p.name || '';
      $('rename-form').dataset.loaded = 'yes';
    }

    const modes = p.speed_modes || [];
    if (JSON.stringify(modes) !== $('speed-mode').dataset.values) {
      const previous = $('speed-mode').value;
      $('speed-mode').replaceChildren(
        new Option(tr('Ne pas modifier'), ''),
        ...modes.map(
          (m) =>
            new Option(
              { Quiet: tr('Silencieux'), Standard: 'Standard', Sport: 'Sport' }[
                m.description ?? m.name ?? m.label
              ] ||
                m.description ||
                m.name ||
                m.label ||
                String(m.mode ?? m.value ?? m.code),
              m.mode ?? m.value ?? m.code ?? m.id,
            ),
        ),
      );
      $('speed-mode').value = previous;
      $('speed-mode').dataset.values = JSON.stringify(modes);
    }
  }
  /** N’autorise une mise à jour que si la machine est libre et la disponibilité explicitement annoncée. */
  function renderFirmware(p) {
    const printerButton = document.querySelector('[data-command=firmware]'),
      aceButton = document.querySelector('[data-command=ace-firmware]'),
      ace = p.ace_updates?.[0];
    const idle = !!p.printer_online && !!p.is_available && !p.job_in_progress,
      printerUpdate = p.firmware_update_available === true,
      aceUpdate = ace?.available === true;
    printerButton.disabled = !idle || !printerUpdate;
    aceButton.disabled = !idle || !aceUpdate;
    printerButton.title = !idle
      ? tr('Imprimante occupée ou hors ligne.')
      : printerUpdate
        ? tr('Installer la version ') + p.firmware_available
        : tr('Aucune mise à jour proposée par Anycubic.');
    aceButton.title = !idle
      ? tr('Imprimante occupée ou hors ligne.')
      : aceUpdate
        ? tr('Installer la version ') + (ace.target || tr('proposée')) + ' sur le module ACE.'
        : ace
          ? tr('Aucune mise à jour proposée par Anycubic.')
          : tr('Version de l’ACE non reçue. Actualisez les informations.');
    for (const [id, current, target, available] of [
      ['printer', p.firmware, p.firmware_available, p.firmware_update_available],
      ['ace', ace?.current ?? p.multi_color_box_fw_version, ace?.target, ace?.available],
    ]) {
      set(
        `firmware-${id}-version`,
        available === true
          ? `${fmt(current)} → ${fmt(target)}`
          : formatText('Version {0}', fmt(current)),
      );
      set(
        `firmware-${id}-status`,
        available === true
          ? tr('Mise à jour disponible')
          : available === false
            ? tr('À jour')
            : tr('À vérifier'),
      );
      $(`firmware-${id}-status`).className =
        'firmware-status ' +
        (available === true ? 'available' : available === false ? 'current' : 'unknown');
    }
    printerButton.dataset.confirm = formatText(
      tr(
        'Installer la version {0} sur l’imprimante ? Ne coupez pas son alimentation pendant la mise à jour.',
      ),
      p.firmware_available || '—',
    );
    aceButton.dataset.confirm = formatText(
      tr(
        'Installer la version {0} sur le module ACE ? Ne coupez pas son alimentation pendant la mise à jour.',
      ),
      ace?.target || '—',
    );
  }

  return { renderOverview };
}
