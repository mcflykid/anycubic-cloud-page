import {
  $,
  date,
  fmt,
  formatText,
  message,
  mins,
  node,
  set,
  single,
  tr,
  valueUnit,
} from './workshop-ui.mjs?v=cda4532cd72a';
import { workshopState } from './workshop-state.mjs?v=f7c4c4153f8f';
import { definition } from './workshop-overview.mjs?v=eab6a8551e05';
import { api } from './workshop-api.mjs?v=56e4bef24031';

/** Gère les commandes courantes, le déplacement et les réglages de la machine. */
export function createSettings(request, command, camera) {
  let deviceOptions = null,
    resetTicket = null,
    resetDeadline = 0;
  const controlFeedback = (text) => set('control-feedback', text);
  /** Refuse les nouvelles commandes lorsque le serveur n’a plus d’état utilisable. */
  function disableQuickControls() {
    for (const button of $('controls-dialog').querySelectorAll(
      'form input,form select,form button,#control-light-on,#control-light-off',
    ))
      button.disabled = true;
    set('control-light-state', tr('État inconnu'));
  }
  function showControlView(settings) {
    $('controls-monitor').hidden = settings;
    $('settings-form').hidden = !settings;
    $('control-view-monitor').setAttribute('aria-pressed', String(!settings));
    $('control-view-settings').setAttribute('aria-pressed', String(settings));
  }
  $('control-view-monitor').onclick = () => showControlView(false);
  $('control-view-settings').onclick = () => showControlView(true);
  $('controls-open').onclick = () => {
    showControlView(false);
    controlFeedback('');
    $('controls-dialog').showModal();
  };
  $('settings-form').onsubmit = (e) => {
    e.preventDefault();
    controlFeedback('');
    void command(
      'settings',
      Object.fromEntries(new FormData(e.target)),
      tr('Appliquer ces réglages à l’impression active ?'),
      controlFeedback,
    );
  };
  $('rename-form').onsubmit = (e) => {
    e.preventDefault();
    command(
      'rename',
      Object.fromEntries(new FormData(e.target)),
      tr('Renommer l’imprimante dans le compte Anycubic ?'),
    );
  };
  for (const [id, enabled] of [
    ['light-on', true],
    ['light-off', false],
    ['control-light-on', true],
    ['control-light-off', false],
  ]) {
    const feedback = id.startsWith('control-') ? controlFeedback : undefined;
    $(id).onclick = () => {
      feedback?.('');
      void command(
        'light',
        { enabled, light_type: 3 },
        tr(
          enabled
            ? 'Allumer l’éclairage de l’imprimante ?'
            : 'Éteindre l’éclairage de l’imprimante ?',
        ),
        feedback,
      );
    };
  }
  /** Conditionne axes et IA aux capacités annoncées et à une imprimante disponible. */
  function updateNativeControls(p) {
    const canMove = !!p.axes_supported && p.is_available && !p.job_in_progress;
    for (const button of document.querySelectorAll('[data-axis],#axis-release,#axis-step input'))
      button.disabled = !canMove;
    set(
      'axis-state',
      !p.axes_supported
        ? tr('Contrôle non annoncé par cette imprimante')
        : p.job_in_progress
          ? tr('Indisponible pendant une impression')
          : canMove
            ? tr('Commandes disponibles')
            : tr('Imprimante occupée ou hors ligne'),
    );
    $('task-details-open').disabled = !p.task_details;
    $('ai-open').disabled = !p.printer_online || !p.is_available || p.job_in_progress;
    $('ai-open').dataset.tooltip = $('ai-open').disabled
      ? tr('Réglages disponibles lorsque l’imprimante est libre.')
      : tr('Régler la détection du filament enchevêtré et des objets étrangers.');
    if ($('task-dialog').open) renderTaskDetails();
    if ($('ai-dialog').open && aiLoaded) {
      $('ai-form').querySelector('fieldset').disabled = !p.is_available || p.job_in_progress;
    }
  }
  /** Affiche uniquement les paramètres de tranche transmis par le serveur et les données connues du projet courant. */
  function renderTaskDetails() {
    const p = workshopState.snapshot?.printer,
      d = p?.task_details;
    if (!d) return;
    set('task-name', p.job_name || tr('Tâche en cours'));
    set(
      'task-progress',
      formatText(
        '{0} · {1} / {2} couches · {3} restantes',
        fmt(p.job_progress, ' %'),
        p.job_current_layer ?? '—',
        p.job_total_layers ?? '—',
        mins(p.job_time_remaining),
      ),
    );
    if (!$('job-preview').hidden) {
      $('task-preview').src = $('job-preview').src;
      $('task-preview').hidden = false;
    } else $('task-preview').hidden = true;
    const params = d.parameters || {},
      time = d.estimated_time
        ? String(d.estimated_time)
            .replace(/(\d+)h/g, '$1 h ')
            .replace(/(\d+)m/g, '$1 min ')
            .replace(/(\d+)s/g, '$1 s')
            .replace(/\s+/g, ' ')
            .trim()
        : '—';
    definition('task-file', [
      [
        'Dimensions',
        d.dimensions?.every((v) => v != null)
          ? d.dimensions.map((v) => fmt(v)).join(' × ') + ' mm'
          : '—',
      ],
      ['Couches', fmt(d.layers)],
      ['Temps estimé', time],
      ['Filament estimé', fmt(d.material_grams, ' g')],
    ]);
    const yes = (v) =>
      v == null ? '—' : [true, 1, '1', 'true'].includes(single(v)) ? tr('Activé') : tr('Désactivé');
    definition('task-parameters', [
      ['Hauteur de couche', valueUnit(params.layer_height, ' mm')],
      ['Remplissage', valueUnit(params.fill_density, ' %')],
      ['Supports', yes(params.enable_support)],
      [
        'Adhérence au plateau',
        params.brim_type == null
          ? '—'
          : {
              no_brim: tr('Sans bordure'),
              auto_brim: 'Automatique',
              outer_only: tr('Bordure externe'),
              inner_only: tr('Bordure interne'),
              outer_and_inner: tr('Bordures interne et externe'),
            }[params.brim_type] || tr('Activée'),
      ],
      ['Buse', valueUnit(params.temperature, ' °C')],
      ['Plateau', valueUnit(params.bed_temperature, ' °C')],
      ['Ventilation maximale', valueUnit(params.fan_max_speed, ' %')],
      ['Rétraction', valueUnit(params.filament_retract_length, ' mm')],
      ['Parois', valueUnit(params.perimeters)],
      ['Largeur de paroi', valueUnit(params.perimeter_extrusion_width, ' mm')],
      ['Vitesse de paroi externe', valueUnit(params.outer_wall_speed, ' mm/s')],
      ['Déplacements', valueUnit(params.travel_speed, ' mm/s')],
    ]);
  }
  $('task-details-open').onclick = () => {
    renderTaskDetails();
    $('task-dialog').showModal();
  };
  let aiLoaded = false;
  let aiLoading = false;
  /** Masque les anciennes valeurs pendant la consultation IA pour éviter d’appliquer des réglages périmés. */
  async function loadAiSettings() {
    if (aiLoading) return;
    aiLoading = true;
    aiLoaded = false;
    const f = $('ai-form');
    f.hidden = true;
    f.querySelector('fieldset').disabled = true;
    $('ai-retry').hidden = true;
    set('ai-state', tr('Lecture des réglages de l’imprimante…'));
    try {
      const d = await request('/ai-settings'),
        a = d.settings,
        status = Number(a.status);
      f.elements.spaghetti.checked = !!(status & 1);
      f.elements.foreign.checked = !!(status & 2);
      f.elements.spaghetti_level.value = String(a.sensitivity_level?.[1] ?? 1);
      f.elements.foreign_level.value = String(a.sensitivity_level?.[0] ?? 1);
      f.elements.pause.value = String(a.notice_type?.[1] === 1);
      $('ai-foreign-option').hidden = !workshopState.snapshot?.printer?.foreign_detection_supported;
      aiLoaded = true;
      const printerBusy =
        workshopState.snapshot?.printer?.job_in_progress ||
        !workshopState.snapshot?.printer?.is_available;
      f.hidden = false;
      f.querySelector('fieldset').disabled = printerBusy;
      set(
        'ai-state',
        printerBusy
          ? tr('Imprimante occupée. Les modifications seront disponibles lorsqu’elle sera libre.')
          : tr('Réglages actuels de l’imprimante'),
      );
    } catch (e) {
      set(
        'ai-state',
        tr('Réglages indisponibles : ') +
          e.message +
          tr('. Réessayez lorsque l’imprimante est en ligne et libre.'),
      );
      $('ai-retry').hidden = false;
    } finally {
      aiLoading = false;
    }
  }
  $('ai-open').onclick = () => {
    $('ai-dialog').showModal();
    loadAiSettings();
  };
  $('ai-retry').onclick = loadAiSettings;
  $('ai-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!aiLoaded) return;
    const f = e.target,
      result = await command(
        'ai-settings',
        {
          spaghetti: f.elements.spaghetti.checked,
          foreign: f.elements.foreign.checked,
          spaghetti_level: Number(f.elements.spaghetti_level.value),
          foreign_level: Number(f.elements.foreign_level.value),
          pause: f.elements.pause.value === 'true',
        },
        tr('Appliquer ces réglages de détection IA à l’imprimante sélectionnée ?'),
      );
    if (result) $('ai-dialog').close();
  };
  for (const b of document.querySelectorAll('[data-axis]'))
    b.onclick = async () => {
      if (b.disabled) return;
      if (!camera.hasVideo) {
        await camera.open();
        if (!camera.hasVideo) {
          message(tr('Ouvrez la caméra avant de déplacer les axes.'), true);
          return;
        }
      }
      await command(
        'axis',
        {
          axis: Number(b.dataset.axis),
          direction: Number(b.dataset.direction),
          distance: Number($('axis-step').querySelector('input:checked').value),
        },
        tr('Déplacer les axes de l’imprimante avec ces paramètres ?'),
      );
    };
  $('axis-release').onclick = () =>
    command('axis-off', {}, tr('Libérer les moteurs de l’imprimante pour un déplacement manuel ?'));
  let journalLoad = 0;
  /** Affiche la dernière lecture demandée et garde l’export cohérent avec les filtres. */
  async function loadCommandJournal() {
    const generation = ++journalLoad,
      form = $('journal-filters'),
      filters = new URLSearchParams(new FormData(form));
    const exportLink = $('journal-export');
    exportLink.hidden = true;
    set('journal-state', tr('Chargement du journal…'));
    try {
      const { items, printers, actions } = await request('/journal?' + filters);
      if (generation !== journalLoad) return;
      const { printer, action } = form.elements;
      printer.replaceChildren(
        new Option(tr('Toutes les imprimantes'), ''),
        ...Object.entries(printers).map(([key, name]) => new Option(name || key, key)),
      );
      action.replaceChildren(
        new Option(tr('Toutes les actions'), ''),
        ...actions.map((value) => new Option(value, value)),
      );
      printer.value = filters.get('printer');
      action.value = filters.get('action');
      $('journal-entries').replaceChildren(
        ...items.map((row) => {
          const item = node('li');
          const details = Object.entries(row.parameters || {})
            .map(([key, value]) => key + ' ' + value)
            .join(' · ');
          item.append(
            node('strong', row.action + ' · ' + tr(row.outcome)),
            node('p', [date(row.time), row.printer_name, details].filter(Boolean).join(' · ')),
          );
          return item;
        }),
      );
      set(
        'journal-state',
        items.length
          ? items.length + tr(' entrée(s) récente(s)')
          : tr('Aucune commande pour ces filtres.'),
      );
      filters.set('export', '1');
      exportLink.href = api + '/journal?' + filters;
      exportLink.hidden = !items.length;
    } catch (error) {
      if (generation !== journalLoad) return;
      $('journal-entries').replaceChildren();
      set('journal-state', error.message);
    }
  }
  $('journal-panel').ontoggle = () => {
    if ($('journal-panel').open) void loadCommandJournal();
  };
  $('journal-filters').onsubmit = (event) => {
    event.preventDefault();
    void loadCommandJournal();
  };
  $('journal-filters').onchange = () => void loadCommandJournal();
  const assistLabels = {
    0: tr('Contrôle de la courroie'),
    1: tr('Détection de perte de pas'),
    2: tr('Relais automatique'),
    3: tr('Alerte de fin de filament'),
    4: tr('Alerte de blocage du filament'),
    5: tr('Suivi du filament restant'),
  };
  /** N’expose les réglages avancés que si les capacités et options constructeur les autorisent. */
  async function loadDeviceOptions() {
    const button = $('device-options-load');
    button.disabled = true;
    set('device-options-state', tr('Lecture des options du constructeur…'));
    try {
      const d = await request('/extras/device');
      deviceOptions = d;
      set('device-options-state', d.message || tr('Options reçues de l’imprimante'));
      $('calibration-choices').replaceChildren(
        ...d.calibrations.map((c) => {
          const label = node('label', null, 'check'),
            input = node('input');
          input.type = 'checkbox';
          input.name = 'items';
          input.value = c.key;
          label.append(input, document.createTextNode(tr(c.label)));
          return label;
        }),
      );
      $('calibration-fields').disabled = !d.calibrations.length;
      set(
        'calibration-help',
        d.calibrations.length
          ? tr('Choisissez les calibrations à lancer, plateau libre.')
          : d.calibration_advertised
            ? tr(
                'Le nivellement et la compensation sont annoncés, mais leur commande à distance n’est pas confirmée pour ce firmware.',
              )
            : tr('Aucune calibration à distance fournie pour ce firmware.'),
      );
      $('hardware-form').hidden = !d.hardware_editable;
      $('hardware-form').querySelector('fieldset').disabled = !d.hardware_editable;
      set(
        'hardware-help',
        d.hardware_editable
          ? tr('Réglages déclarés par le constructeur.')
          : tr('Le Cloud ne permet pas de modifier le matériel sur ce firmware.'),
      );
      if (d.hardware_editable) {
        for (const k of ['diameter', 'material'])
          if (d.hardware[k] != null) $('hardware-form').elements[k].value = d.hardware[k];
        if (d.bed.material != null) $('hardware-form').elements.bed.value = d.bed.material;
      }
      $('assist-options').replaceChildren(
        ...d.assistance
          .filter((r) => [0, 3, 4, 5].includes(r.option))
          .map((r) => {
            const label = node('label', null, 'check'),
              input = node('input');
            input.type = 'checkbox';
            input.name = String(r.option);
            input.checked = !!Number(r.value);
            label.append(
              input,
              document.createTextNode(
                assistLabels[r.option] || r.label || tr('Option constructeur'),
              ),
            );
            return label;
          }),
      );
      $('assist-form').querySelector('fieldset').disabled = !d.assistance.length;
      set(
        'assist-help',
        d.assistance.length
          ? tr('Options actuelles communiquées par la machine.')
          : tr('Options d’assistance non fournies par ce firmware.'),
      );
      $('screen-option').replaceChildren(
        ...d.screen
          .filter((r) => [0, 1].includes(r.option))
          .map(
            (r) =>
              new Option(
                r.option === 0 ? tr('Extinction de l’écran') : tr('Mise en veille'),
                r.option,
              ),
          ),
      );
      $('screen-form').querySelector('fieldset').disabled = !$('screen-option').options.length;
      set(
        'screen-help',
        d.screen.length
          ? tr('Délai avant la mise en veille.')
          : tr('Réglage de veille non fourni par ce firmware.'),
      );
      const visible = [
        d.calibrations.length > 0,
        d.hardware_editable,
        d.assistance.some((r) => [0, 3, 4, 5].includes(r.option)),
        d.screen.some((r) => [0, 1].includes(r.option)),
        d.factory_reset,
      ];
      document
        .querySelectorAll('.extras-settings-grid>section')
        .forEach((card, i) => (card.hidden = !visible[i]));
      document.querySelector('.extras-settings-grid').hidden = !visible.some(Boolean);
      document.querySelector('.extras-settings-heading').hidden = !visible.some(Boolean);
      $('reset-open').disabled = !d.factory_reset || !workshopState.snapshot?.printer?.is_available;
      set(
        'reset-help',
        d.factory_reset
          ? tr('Rétablit les réglages d’usine après saisie du code et du mot de passe web.')
          : tr('La réinitialisation Cloud n’est pas annoncée pour ce firmware.'),
      );
    } catch (e) {
      set('device-options-state', e.message);
    } finally {
      button.disabled = false;
    }
  }
  $('device-options-load').onclick = loadDeviceOptions;
  $('calibration-form').onsubmit = (e) => {
    e.preventDefault();
    command(
      'calibrate',
      { items: new FormData(e.target).getAll('items') },
      tr('Lancer les calibrations choisies ? Le plateau doit être libre.'),
    );
  };
  $('hardware-form').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    command(
      'hardware',
      {
        diameter: Number(f.elements.diameter.value),
        material: Number(f.elements.material.value),
        bed: Number(f.elements.bed.value),
      },
      tr('Mettre à jour la configuration du matériel ?'),
    );
  };
  $('assist-form').onsubmit = (e) => {
    e.preventDefault();
    command(
      'assist',
      {
        items: [...e.target.querySelectorAll('input[type=checkbox]')].map((i) => ({
          option: Number(i.name),
          value: i.checked,
        })),
      },
      tr('Appliquer ces options d’assistance ?'),
    );
  };
  $('screen-form').onsubmit = (e) => {
    e.preventDefault();
    command(
      'screen',
      {
        option: Number(e.target.elements.option.value),
        minutes: Number(e.target.elements.minutes.value),
      },
      tr('Modifier le délai de veille ?'),
    );
  };
  $('reset-open').onclick = () => {
    resetTicket = null;
    $('reset-understood').checked = false;
    $('reset-get-code').disabled = true;
    $('reset-form').hidden = true;
    $('reset-form').reset();
    $('reset-dialog').showModal();
  };
  $('reset-understood').onchange = (e) => ($('reset-get-code').disabled = !e.target.checked);
  $('reset-get-code').onclick = async () => {
    if (!$('reset-understood').checked) return;
    try {
      const d = await request('/reset/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      resetTicket = d.ticket;
      resetDeadline = Date.now() + d.expires_in * 1000;
      set('reset-code', d.code);
      $('reset-form').hidden = false;
      set('reset-state', tr('Ce code est à usage unique'));
      $('reset-form').elements.code.focus();
    } catch (e) {
      set('reset-help', e.message);
      message(e.message, true);
    }
  };
  $('reset-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!resetTicket || Date.now() > resetDeadline) {
      set('reset-state', tr('Code expiré. Demandez un nouveau code.'));
      return;
    }
    const ok = await command('factory-reset', {
      ticket: resetTicket,
      code: e.target.elements.code.value,
    });
    resetTicket = null;
    if (ok) $('reset-dialog').close();
    else set('reset-state', tr('Demandez un nouveau code avant de réessayer'));
  };

  function enter() {
    if (!deviceOptions) loadDeviceOptions();
  }

  return { disableQuickControls, updateNativeControls, enter };
}
