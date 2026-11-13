import { $, fmt, formatText, locale, mins, node, set, tr } from './workshop-ui.mjs';
import { workshopState } from './workshop-state.mjs';
import { openErrorSheet } from './workshop-error-catalogue.mjs';

let printTarget;
let statusAvailable = false;
let tracking;
let trackingTimer;
let assignment;

/** Garde les numéros globaux utilisés par l’ordre d’impression. */
function slotChoices(printer) {
  return (printer?.boxes || []).flatMap(box => box.spools || [])
    .filter(spool => Number.isInteger(spool.display_slot ?? spool.slot) && (spool.display_slot ?? spool.slot) <= 8);
}

/** Actualise les choix après une modification des bobines, en préservant le focus. */
function renderAssignments() {
  const rows = $('print-ace-rows');
  const spools = slotChoices(workshopState.snapshot?.printer);
  const visible = !!assignment && spools.length > 0;
  $('print-ace').hidden = !visible;
  $('print-mapping').hidden = visible || !$('print-mapping').dataset.manual;
  $('print-mapping-summary').hidden = visible || !$('print-mapping-summary').textContent;
  if (!visible) return;
  const signature = JSON.stringify(spools.map(spool => [
    spool.display_slot ?? spool.slot, spool.material_type, spool.color, spool.spool_loaded,
  ]));
  if (assignment.signature === signature) return;
  const changed = assignment.signature != null;
  assignment.signature = signature;
  const focused = rows.contains(document.activeElement) ? Number(document.activeElement.dataset.filament) : -1;
  rows.replaceChildren(...assignment.materials.map((material, index) => {
    const label = node('label', undefined, 'atelier-field print-ace-row');
    const title = node('span', formatText('Filament {0} · {1}', index + 1, material || tr('Matière non renseignée')));
    const color = assignment.colors[index];
    if (color?.length === 3) {
      const swatch = node('span', undefined, 'material-color');
      swatch.style.backgroundColor = `rgb(${color.join(',')})`;
      title.prepend(swatch);
    }
    const select = node('select');
    select.dataset.filament = index;
    select.append(new Option(tr('Choisir un emplacement'), ''));
    for (const spool of spools) {
      const slot = spool.display_slot ?? spool.slot;
      const name = spool.spool_loaded === false ? tr('Emplacement vide')
        : spool.spool_loaded !== true ? tr('État inconnu')
        : spool.material_type || tr('Matière non renseignée');
      const color = spool.color?.slice(0, 3);
      const hex = color?.length === 3 && color.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
        ? ' · #' + color.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase() : '';
      const option = new Option(formatText('Emplacement {0} · {1}', slot, name) + hex, slot);
      option.disabled = spool.spool_loaded !== true;
      select.append(option);
    }
    select.value = assignment.slots[index] || '';
    if (!select.value || select.selectedOptions[0]?.disabled) {
      select.value = '';
      assignment.slots[index] = 0;
    }
    select.onchange = () => {
      assignment.slots[index] = Number(select.value);
      updatePrintConfirmation();
      void assignment.updateAdvice?.([...assignment.slots]);
    };
    label.append(title, select);
    return label;
  }));
  if (focused >= 0) rows.querySelector(`[data-filament="${focused}"]`)?.focus();
  if (changed) void assignment.updateAdvice?.([...assignment.slots]);
}

/** Demande la preuve MQTT de l’ordre courant uniquement pendant son suivi. */
export function printTrackingQuery() {
  return $('print-dialog').open && tracking?.reference
    ? '?' + new URLSearchParams({print_tracking: tracking.reference}) : '';
}

/** Répercute le relevé courant dans la confirmation avant tout envoi. */
export function updatePrintConfirmation(available = statusAvailable, observedReference = '') {
  statusAvailable = available;
  const dialog = $('print-dialog');
  if (!dialog.open) return;
  const {selectedPrinter, snapshot, busy} = workshopState;
  const printer = snapshot?.printer;
  if (dialog.dataset.phase === 'pending' && tracking?.reference) {
    const current = available && printTarget === selectedPrinter && tracking.reference === observedReference;
    $('print-cancel-transfer').hidden = !current || snapshot.print_cancellable !== true || !tracking.cancel || tracking.cancelled;
    if (current && snapshot.print_sending === true && !tracking.cancelled)
      set('print-result', tr('Envoi de l’ordre d’impression à Anycubic…'));
  }
  if (dialog.dataset.phase === 'tracking') {
    if (!available || printTarget !== selectedPrinter || printer?.printer_online !== true) {
      $('print-progress').removeAttribute('value');
      return;
    }
    const file = tracking.file;
    const matches = file && printer.command_project && printer.command_project !== file.previous_project &&
      printer.job_file_references?.some(reference => file.files.includes(reference));
    if (tracking.reference && observedReference === tracking.reference && snapshot.print_started === true) {
      showPrintResult(tr('Démarrage confirmé par l’imprimante.'));
    } else if (matches && ['checking', 'downloading', 'preheating', 'leveling', 'slicing'].includes(printer.job_state)) {
      const progress = $('print-progress');
      const measured = printer.job_state === 'downloading' && Number.isFinite(printer.job_download_progress) &&
        printer.job_download_progress > 0 && printer.job_download_progress <= 100;
      if (measured) {
        progress.max = 100;
        progress.value = printer.job_download_progress;
        set('print-result', formatText('Téléchargement par l’imprimante · {0}', fmt(progress.value, ' %')));
      } else {
        progress.removeAttribute('value');
        set('print-result', tr('Préparation en cours sur l’imprimante.'));
      }
    } else {
      $('print-progress').removeAttribute('value');
    }
    return;
  }
  if (dialog.dataset.phase !== 'confirmation') return;
  renderAssignments();
  const state = printTarget !== selectedPrinter ? 'La cible a changé : commande annulée.'
    : busy ? 'Une opération est déjà en cours.'
    : !statusAvailable ? 'Cloud indisponible'
    : printer?.printer_online !== true ? 'Hors ligne'
    : printer.firmware_updating === true || printer.ace_updates?.some(entry => entry.updating === true) ? 'Mise à jour en cours'
    : printer.is_available !== true || printer.job_in_progress ? 'Imprimante non disponible'
    : '';
  const missing = assignment && (assignment.requiresAce || !$('print-ace').hidden) &&
    ($('print-ace').hidden || assignment.materials.some((_, index) => !assignment.slots[index]));
  $('print-yes').disabled = !!state || !!missing;
  set('print-target', tr(state || (missing ? 'Choisissez un emplacement pour chaque filament.' : 'Disponible')));
}

/** Rend les données connues de la source et demande une validation liée à l’imprimante affichée. */
export function confirmPrint({target, name, details = {}, image, advice = '', question, readSlots, mappingText = '', filaments, checkAdvice, queue, initialSlots = []}) {
  const dialog = $('print-dialog');
  if (dialog.open) return Promise.resolve(null);
  clearTimeout(trackingTimer);
  tracking = null;
  assignment = filaments?.materials?.length
    ? {materials: filaments.materials, colors: filaments.colors || [], slots: [...(filaments.slots || [])],
        requiresAce: slotChoices(workshopState.snapshot?.printer).length > 0} : null;
  if (assignment && checkAdvice) {
    const current = assignment;
    let revision = 0;
    current.updateAdvice = async slots => {
      const checked = ++revision;
      // Les positions doivent rester alignées avec les matières tant que la sélection est incomplète.
      const advice = await checkAdvice(slots.every(Boolean) ? slots : []).catch(() => tr('Métadonnées de filament incomplètes : vérifiez les bobines et les emplacements.'));
      if (assignment !== current || checked !== revision || !dialog.open || dialog.dataset.phase !== 'confirmation') return;
      $('print-advice').hidden = !advice;
      set('print-advice', advice);
    };
  }
  $('print-ace-rows').replaceChildren();
  $('print-ace').disabled = false;
  $('print-options').open = false;
  $('print-drying-mode').value = 'off';
  printTarget = target;
  const title = $('print-name');
  title.textContent = title.title = name;
  set('print-printer', workshopState.snapshot?.printer?.name || tr('Imprimante sélectionnée'));
  set('print-duration', Number.isFinite(details.seconds) ? mins(details.seconds / 60) : tr('Donnée inconnue'));
  const grams = Number.isFinite(details.grams) ? fmt(details.grams, ' g') : tr('Masse inconnue');
  const metres = Number.isFinite(details.metres)
    ? `${details.metres.toLocaleString(locale, {maximumFractionDigits: 2})} m` : tr('Longueur inconnue');
  set('print-filament', `${grams} / ${metres}`);
  const preview = $('print-image'), fallback = $('print-no-preview');
  preview.hidden = true;
  fallback.hidden = false;
  preview.removeAttribute('src');
  preview.onload = () => { preview.hidden = false; fallback.hidden = true; };
  if (image) preview.src = image;
  $('print-mapping').hidden = !readSlots;
  $('print-mapping-summary').hidden = !mappingText;
  set('print-mapping-summary', mappingText);
  const mapping = $('print-slots');
  $('print-mapping').dataset.manual = readSlots ? 'yes' : '';
  mapping.value = initialSlots.join(', ');
  mapping.oninput = () => mapping.setCustomValidity('');
  mapping.setCustomValidity('');
  $('print-advice').hidden = !advice;
  set('print-advice', advice);
  set('print-question', question);
  dialog.dataset.phase = 'confirmation';
  $('print-no').hidden = $('print-yes').hidden = false;
  const enqueue = $('print-queue-add');
  enqueue.hidden = !queue;
  for (const id of ['print-result', 'print-close', 'print-error-help', 'print-progress', 'print-cancel-transfer']) $(id).hidden = true;
  dialog.showModal();
  updatePrintConfirmation();
  return new Promise(resolve => {
    const finish = () => {
      dialog.onclose = null;
      dialog.close();
      resolve(null);
    };
    dialog.onclose = () => { if (!dialog.open) resolve(null); };
    $('print-no').onclick = finish;
    const saveToQueue = async () => {
      if (!queue || enqueue.disabled || printTarget !== workshopState.selectedPrinter) return;
      try {
        const values = assignment && !$('print-ace').hidden ? assignment.slots : readSlots?.(mapping.value);
        enqueue.disabled = true;
        if (await queue(values?.every(Boolean) ? values : []) && dialog.open && enqueue.onclick === saveToQueue) finish();
      } catch (error) {
        mapping.setCustomValidity(error.message);
        mapping.reportValidity();
      } finally {
        enqueue.disabled = false;
      }
    };
    enqueue.onclick = saveToQueue;
    dialog.oncancel = event => { event.preventDefault(); finish(); };
    $('print-yes').onclick = () => {
      updatePrintConfirmation();
      if ($('print-yes').disabled || enqueue.disabled) return;
      try {
        const slots = assignment && !$('print-ace').hidden ? assignment.slots : readSlots?.(mapping.value);
        enqueue.hidden = true;
        dialog.dataset.phase = 'confirmed';
        $('print-yes').disabled = true;
        resolve({slots});
      } catch (error) {
        mapping.setCustomValidity(error.message);
        mapping.reportValidity();
      }
    };
  });
}

/** Garde le pied visible pendant l’appel et laisse la fermeture distincte de l’arrêt d’impression. */
export function showPrintProgress(text, reference, cancel) {
  const dialog = $('print-dialog');
  if (!dialog.open || dialog.dataset.phase !== 'confirmed') return;
  const transfer = tracking = {reference, cancel, cancelled:false};
  const button = $('print-cancel-transfer');
  button.disabled = false;
  button.onclick = async () => {
    button.disabled = true;
    try {
      const result = await cancel(reference);
      if (tracking !== transfer) return;
      if (result.cancelled) {
        transfer.cancelled = true;
        set('print-result', tr('Lancement annulé. Le transfert se termine.'));
      } else {
        set('print-result', tr('L’annulation n’a pas été confirmée.'));
      }
      button.hidden = true;
      $('print-result').focus();
    } catch {
      if (tracking === transfer) set('print-result', tr('L’annulation n’a pas été confirmée.'));
    } finally {
      button.disabled = false;
    }
  };
  dialog.dataset.phase = 'pending';
  dialog.oncancel = event => event.preventDefault();
  $('print-no').hidden = $('print-yes').hidden = true;
  $('print-mapping').hidden = true;
  $('print-ace').disabled = true;
  $('print-options').open = false;
  set('print-result', text);
  $('print-result').hidden = $('print-progress').hidden = false;
  $('print-progress').removeAttribute('value');
  $('print-result').focus();
}

/** Attend un rapport de démarrage corrélé à l’ordre, sans bloquer la fermeture de la fenêtre. */
export function followPrintStart(result) {
  const dialog = $('print-dialog');
  if (!dialog.open || dialog.dataset.phase !== 'pending') return;
  if (!result.print_reference) {
    showPrintResult(result.message || tr('Demande traitée. Vérifiez l’état de l’imprimante.'));
    return;
  }
  tracking = {reference: result.print_reference, file: result.print_tracking};
  dialog.dataset.phase = 'tracking';
  dialog.oncancel = null;
  set('print-result', tr('Demande acceptée par Anycubic. En attente du démarrage.'));
  const close = $('print-close');
  close.hidden = false;
  close.onclick = () => dialog.close();
  trackingTimer = setTimeout(() => showPrintResult(tr('Démarrage non confirmé. Vérifiez l’état de l’imprimante.')), 300000);
}

/** Affiche la réponse de la demande et l’aide locale si le serveur a fourni un code reconnu. */
export function showPrintResult(text, sheet) {
  const dialog = $('print-dialog');
  if (!dialog.open || !['pending', 'tracking'].includes(dialog.dataset.phase)) return;
  clearTimeout(trackingTimer);
  tracking = null;
  dialog.dataset.phase = 'result';
  dialog.oncancel = null;
  $('print-progress').hidden = true;
  $('print-cancel-transfer').hidden = true;
  set('print-result', text);
  const close = $('print-close'), help = $('print-error-help');
  close.hidden = false;
  close.onclick = () => dialog.close();
  help.hidden = !sheet;
  help.onclick = sheet ? () => openErrorSheet(sheet) : null;
  close.focus();
}

/** Ferme une confirmation invalidée avant le premier appel. */
export function closePrintConfirmation() {
  const dialog = $('print-dialog');
  if (dialog.dataset.phase === 'confirmed') dialog.close();
}
