import { $, fmt, locale, mins, set, tr } from './workshop-ui.mjs';
import { workshopState } from './workshop-state.mjs';
import { openErrorSheet } from './workshop-error-catalogue.mjs';

let printTarget;
let statusAvailable = false;

/** Répercute le relevé courant dans la confirmation avant tout envoi. */
export function updatePrintConfirmation(available = statusAvailable) {
  statusAvailable = available;
  const dialog = $('print-dialog');
  if (!dialog.open || dialog.dataset.phase !== 'confirmation') return;
  const {selectedPrinter, snapshot, busy} = workshopState;
  const printer = snapshot?.printer;
  const state = printTarget !== selectedPrinter ? 'La cible a changé : commande annulée.'
    : busy ? 'Une opération est déjà en cours.'
    : !statusAvailable ? 'Cloud indisponible'
    : printer?.printer_online !== true ? 'Hors ligne'
    : printer.firmware_updating === true || printer.ace_updates?.some(entry => entry.updating === true) ? 'Mise à jour en cours'
    : printer.is_available !== true || printer.job_in_progress ? 'Imprimante non disponible'
    : '';
  $('print-yes').disabled = !!state;
  set('print-target', tr(state || 'Disponible'));
}

/** Rend les données connues de la source et demande une validation liée à l’imprimante affichée. */
export function confirmPrint({target, name, details = {}, image, advice = '', question, readSlots, mappingText = ''}) {
  const dialog = $('print-dialog');
  if (dialog.open) return Promise.resolve(null);
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
  mapping.value = '';
  mapping.oninput = () => mapping.setCustomValidity('');
  mapping.setCustomValidity('');
  $('print-advice').hidden = !advice;
  set('print-advice', advice);
  set('print-question', question);
  dialog.dataset.phase = 'confirmation';
  $('print-no').hidden = $('print-yes').hidden = false;
  for (const id of ['print-result', 'print-close', 'print-error-help', 'print-progress']) $(id).hidden = true;
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
    dialog.oncancel = event => { event.preventDefault(); finish(); };
    $('print-yes').onclick = () => {
      updatePrintConfirmation();
      if ($('print-yes').disabled) return;
      try {
        const slots = readSlots?.(mapping.value);
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
export function showPrintProgress(text) {
  const dialog = $('print-dialog');
  if (!dialog.open || dialog.dataset.phase !== 'confirmed') return;
  dialog.dataset.phase = 'pending';
  dialog.oncancel = event => event.preventDefault();
  $('print-no').hidden = $('print-yes').hidden = true;
  $('print-mapping').hidden = true;
  set('print-result', text);
  $('print-result').hidden = $('print-progress').hidden = false;
  $('print-result').focus();
}

/** Affiche la réponse de la demande et l’aide locale si le serveur a fourni un code reconnu. */
export function showPrintResult(text, sheet) {
  const dialog = $('print-dialog');
  if (!dialog.open || dialog.dataset.phase !== 'pending') return;
  dialog.dataset.phase = 'result';
  dialog.oncancel = null;
  $('print-progress').hidden = true;
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
