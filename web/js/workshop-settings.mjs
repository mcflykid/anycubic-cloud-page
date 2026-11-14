import {
  $,
  fmt,
  formatText,
  message,
  mins,
  node,
  printTimeline,
  set,
  tr,
} from './workshop-ui.mjs';
import { workshopState } from './workshop-state.mjs';
import { bindCommandJournal } from './workshop-journal.mjs';
import { createCurrentControls } from './workshop-current-controls.mjs';
import { renderTaskDetails as renderTaskBands } from './workshop-task-details.mjs';

/** Gère les commandes courantes, le déplacement et les réglages de la machine. */
export function createSettings(request, command, camera) {
  let deviceOptions = null,
    resetTicket = null,
    resetDeadline = 0,
    resetTimer,
    resetRequest,
    resetAuthorization,
    resetPrinter;
  const currentControls = createCurrentControls(command);
  $('rename-form').onsubmit = (e) => {
    e.preventDefault();
    command(
      'rename',
      Object.fromEntries(new FormData(e.target)),
      tr('Renommer l’imprimante dans le compte Anycubic ?'),
    );
  };
  for (const [id, enabled] of [['light-on', true], ['light-off', false]])
    $(id).onclick = () => command('light', { enabled, light_type: 3 },
      tr(enabled ? 'Allumer l’éclairage de l’imprimante ?' : 'Éteindre l’éclairage de l’imprimante ?'));
  /** Conditionne axes et IA aux capacités annoncées et à une imprimante disponible. */
  function updateNativeControls(p) {
    currentControls.render(p);
    // L’état affiché vient de l’imprimante, y compris lorsqu’il est inconnu.
    const light = p.camera_light;
    set('camera-light-state', tr(light === true ? 'Allumé' : light === false ? 'Éteint' : 'État inconnu'));
    $('light-on').hidden = light === true;
    $('light-off').hidden = light === false;
    for (const id of ['light-on', 'light-off']) $(id).disabled = !p.printer_online;
    const canMove = !!p.axes_supported && p.is_available && !p.job_in_progress;
    for (const button of document.querySelectorAll('[data-axis],#axis-release,#axis-step input'))
      button.disabled = !canMove;
    $('axis-state').dataset.available = String(!!canMove);
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
    if ($('past-task-dialog').open && !$('past-task-extra').dataset.history) renderTaskDetails();
    if ($('ai-dialog').open) updateAiControls();
  }
  /** Alimente la fenêtre commune avec les données du projet courant sans compléter les valeurs absentes. */
  function renderTaskDetails() {
    const p = workshopState.snapshot?.printer,
      d = p?.task_details;
    if (!d) return;
    const state = {
      printing: tr('Impression en cours'),
      paused: tr('Impression en pause'),
      finished: tr('Impression terminée'),
      completed: tr('Impression terminée'),
    }[p.job_state] || tr('État inconnu');
    set('past-task-name', p.job_name || tr('Tâche en cours'));
    $('past-task-state').querySelector('span').textContent = state;
    $('past-task-state').dataset.state = p.job_state === 'paused' ? 'paused' : 'active';
    const image = $('past-task-preview'), fallback = $('past-task-preview-state');
    image.hidden = $('job-preview').hidden;
    if (!image.hidden) image.src = $('job-preview').src;
    fallback.hidden = !image.hidden;
    $('past-task-extra').hidden = true;
    printTimeline('past-print-timeline', p.print_timeline);
    renderTaskBands({
      progress: p.job_progress,
      currentLayer: p.job_current_layer,
      totalLayers: p.job_total_layers,
      layers: d.layers,
      remainingSeconds: p.job_time_remaining == null ? null : Number(p.job_time_remaining) * 60,
      dimensions: d.dimensions,
      estimatedTime: d.estimated_time || null,
      materialGrams: d.material_grams,
      parameters: d.parameters || {},
    });
  }
  $('task-details-open').onclick = () => {
    delete $('past-task-extra').dataset.history;
    $('past-task-photo-controls').hidden = $('past-task-photo-zoom').hidden = true;
    $('past-task-preview').parentElement.hidden = false;
    renderTaskDetails();
    $('past-task-dialog').showModal();
  };
  const aiDialog = $('ai-dialog'), aiForm = $('ai-form'), aiSave = $('ai-save');
  let aiInitial = null, aiGeneration = 0, aiLoading = false, aiSaving = false;
  /** Lit aussi les valeurs désactivées, car le serveur attend la configuration complète. */
  function aiValues() {
    const {spaghetti, foreign, spaghetti_level, foreign_level, pause} = aiForm.elements;
    return {
      spaghetti: spaghetti.checked,
      foreign: foreign.checked,
      spaghetti_level: Number(spaghetti_level.value),
      foreign_level: Number(foreign_level.value),
      pause: pause.value === 'true',
    };
  }
  /** Maintient les contrôles visibles tout en bloquant l’envoi hors ligne ou sans changement. */
  function updateAiControls() {
    const printer = workshopState.snapshot?.printer;
    const canEdit = !!aiInitial && printer?.printer_online && printer.is_available && !printer.job_in_progress && !aiSaving;
    const {spaghetti, foreign} = aiForm.elements;
    spaghetti.disabled = !canEdit;
    foreign.disabled = !canEdit || !printer?.foreign_detection_supported;
    $('ai-spaghetti-controls').disabled = !canEdit || !spaghetti.checked;
    $('ai-foreign-controls').disabled = foreign.disabled || !foreign.checked;
    $('ai-foreign-option').hidden = !printer?.foreign_detection_supported;
    $('ai-camera-note').hidden = camera.hasVideo;
    aiSave.disabled = !canEdit || JSON.stringify(aiValues()) === aiInitial;
    $('ai-retry').disabled = aiLoading || !printer?.printer_online;
    if (!printer?.printer_online) set('ai-state', tr('Hors ligne'));
    else if (aiInitial) set('ai-state', tr(canEdit || aiSaving ? 'Lecture à jour' : 'Imprimante occupée'));
    else if (!aiLoading) set('ai-state', tr('Lecture impossible'));
  }
  /** Ignore une réponse reçue après fermeture ou changement de cible. */
  async function loadAiSettings() {
    const generation = ++aiGeneration, target = workshopState.selectedPrinter;
    aiLoading = true;
    aiInitial = null;
    aiForm.reset();
    $('ai-read-error').hidden = true;
    set('ai-state', tr('Lecture des réglages de l’imprimante…'));
    updateAiControls();
    try {
      const {settings} = await request('/ai-settings', {printerKey: target});
      if (generation !== aiGeneration || target !== workshopState.selectedPrinter || !aiDialog.open) return;
      const status = Number(settings.status), f = aiForm.elements;
      f.spaghetti.checked = !!(status & 1);
      f.foreign.checked = !!(status & 2);
      f.spaghetti_level.value = String(settings.sensitivity_level?.[1] ?? 1);
      f.foreign_level.value = String(settings.sensitivity_level?.[0] ?? 1);
      f.pause.value = String(settings.notice_type?.[1] === 1);
      aiInitial = JSON.stringify(aiValues());
    } catch (error) {
      if (generation !== aiGeneration || !aiDialog.open) return;
      set('ai-error-detail', error.message);
      $('ai-read-error').hidden = false;
    } finally {
      if (generation === aiGeneration) {
        aiLoading = false;
        updateAiControls();
      }
    }
  }
  $('ai-open').onclick = () => {
    aiDialog.showModal();
    void loadAiSettings();
  };
  aiDialog.addEventListener('close', () => { aiGeneration++; });
  $('ai-retry').onclick = loadAiSettings;
  $('ai-camera-open').onclick = () => {
    aiDialog.close();
    const tab = document.querySelector('#atelier-tabs [data-tab=camera]');
    tab.click();
    const toggle = $('section-menu-toggle');
    (toggle.getClientRects().length ? toggle : tab).focus();
  };
  aiForm.oninput = updateAiControls;
  aiForm.onsubmit = async (event) => {
    event.preventDefault();
    if (aiSave.disabled) return;
    const values = aiValues();
    aiSaving = true;
    updateAiControls();
    try {
      const result = await command('ai-settings', values,
        tr('Appliquer ces réglages de détection IA à l’imprimante sélectionnée ?'));
      if (result && aiDialog.open) aiDialog.close();
    } finally {
      aiSaving = false;
      updateAiControls();
    }
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
        tr('Déplacer les axes de l’imprimante avec ces paramètres ? La surveillance à distance sera activée.'),
      );
    };
  $('axis-release').onclick = () =>
    command('axis-off', {}, tr('Libérer les moteurs de l’imprimante pour un déplacement manuel ?'));
  bindCommandJournal(request);
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
  const resetDialog = $('reset-dialog'), resetForm = $('reset-form'),
    resetSubmit = $('reset-submit'), resetGetCode = $('reset-get-code');
  /** Efface le défi si la fenêtre ferme ou si l’utilisateur retire son accord. */
  function clearResetChallenge() {
    resetRequest?.abort();
    resetRequest = null;
    resetAuthorization?.abort();
    resetAuthorization = null;
    clearInterval(resetTimer);
    resetTicket = null;
    resetPrinter = null;
    resetForm.hidden = true;
    resetForm.reset();
    resetSubmit.disabled = true;
    set('reset-code', '');
    set('reset-countdown', '');
    set('reset-password-state', '');
  }
  /** Recalcule le temps depuis l’échéance, même après suspension de l’onglet. */
  function updateResetCountdown() {
    const remaining = Math.max(0, Math.ceil((resetDeadline - Date.now()) / 1000));
    set('reset-countdown', Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0'));
    resetSubmit.disabled = !resetTicket || !!resetAuthorization ||
      !resetForm.elements.code.validity.valid || !resetForm.elements.password.validity.valid;
    if (!remaining) {
      resetTicket = null;
      resetSubmit.disabled = true;
      resetAuthorization?.abort();
      clearInterval(resetTimer);
      set('reset-state', tr('Code expiré. Demandez un nouveau code.'));
    }
  }
  $('reset-open').onclick = () => {
    clearResetChallenge();
    $('reset-understood').checked = false;
    resetGetCode.disabled = true;
    resetDialog.showModal();
  };
  resetDialog.addEventListener('close', clearResetChallenge);
  $('reset-understood').onchange = (e) => {
    if (!e.target.checked) clearResetChallenge();
    resetGetCode.disabled = !e.target.checked;
  };
  resetGetCode.onclick = async () => {
    if (!$('reset-understood').checked || resetGetCode.disabled) return;
    clearResetChallenge();
    const controller = new AbortController();
    resetRequest = controller;
    resetGetCode.disabled = true;
    const printerKey = workshopState.selectedPrinter;
    try {
      const d = await request('/reset/challenge', {
        method: 'POST',
        printerKey,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (resetRequest !== controller || !resetDialog.open || printerKey !== workshopState.selectedPrinter) return;
      resetTicket = d.ticket;
      resetPrinter = printerKey;
      resetDeadline = Date.now() + d.expires_in * 1000;
      set('reset-code', d.code);
      resetForm.hidden = false;
      set('reset-state', tr('Ce code est à usage unique'));
      updateResetCountdown();
      resetTimer = setInterval(updateResetCountdown, 250);
      resetForm.elements.code.focus();
    } catch (e) {
      if (resetRequest !== controller || !resetDialog.open) return;
      set('reset-help', e.message);
      message(e.message, true);
    } finally {
      if (resetRequest === controller) {
        resetRequest = null;
        resetGetCode.disabled = !$('reset-understood').checked;
      }
    }
  };
  resetForm.oninput = updateResetCountdown;
  resetForm.onsubmit = async (e) => {
    e.preventDefault();
    if (resetSubmit.disabled) return;
    if (!resetTicket || Date.now() >= resetDeadline) {
      updateResetCountdown();
      return;
    }
    if (resetPrinter !== workshopState.selectedPrinter) {
      clearResetChallenge();
      message(tr('La cible a changé : commande annulée.'), true);
      return;
    }
    const controller = new AbortController(), passwordField = resetForm.elements.password;
    const password = passwordField.value;
    passwordField.value = '';
    resetAuthorization = controller;
    resetSubmit.disabled = true;
    resetGetCode.disabled = true;
    set('reset-password-state', tr('Vérification…'));
    const ok = await command('factory-reset', {
      ticket: resetTicket,
      code: resetForm.elements.code.value,
    }, undefined, undefined, async (authorize) => {
      try {
        const token = await authorize(password, controller.signal);
        if (controller.signal.aborted || !resetDialog.open || Date.now() >= resetDeadline) return null;
        resetTicket = null;
        set('reset-password-state', '');
        return token;
      } catch (error) {
        if (!controller.signal.aborted && resetDialog.open) {
          set('reset-password-state', error.message);
          passwordField.focus();
        }
        return null;
      }
    });
    if (resetAuthorization !== controller) return;
    resetAuthorization = null;
    resetGetCode.disabled = !$('reset-understood').checked;
    if (ok) resetDialog.close();
    else {
      updateResetCountdown();
      if (!resetTicket && Date.now() < resetDeadline)
        set('reset-state', tr('Demandez un nouveau code avant de réessayer'));
    }
  };

  function enter() {
    if (!deviceOptions) loadDeviceOptions();
  }

  return { disableQuickControls: currentControls.disable, updateNativeControls, enter };
}
