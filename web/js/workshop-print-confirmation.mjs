import { $, fmt, locale, mins, set, tr } from './workshop-ui.mjs';
import { workshopState } from './workshop-state.mjs';

let printTarget;
let statusAvailable = false;

/** Répercute le relevé courant dans la confirmation avant tout envoi. */
export function updatePrintConfirmation(available = statusAvailable) {
  statusAvailable = available;
  if (!$('print-dialog').open) return;
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
  dialog.showModal();
  updatePrintConfirmation();
  return new Promise(resolve => {
    const finish = (result) => {
      dialog.onclose = null;
      dialog.close();
      resolve(result);
    };
    dialog.onclose = () => { if (!dialog.open) resolve(null); };
    $('print-no').onclick = () => finish(null);
    dialog.oncancel = event => { event.preventDefault(); finish(null); };
    $('print-yes').onclick = () => {
      updatePrintConfirmation();
      if ($('print-yes').disabled) return;
      try {
        finish({slots: readSlots?.(mapping.value)});
      } catch (error) {
        mapping.setCustomValidity(error.message);
        mapping.reportValidity();
      }
    };
  });
}
