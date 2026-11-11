import { $, formatText, node, set, tr } from './workshop-ui.mjs';

// Le catalogue partagé garde son empreinte même lorsque seule une fiche a changé.
const catalogueURL = new URL('./workshop-error-catalogue.json', import.meta.url);
const integrity = '__ERROR_CATALOGUE_INTEGRITY__';

/** Garde le message du constructeur disponible même si la ressource d’aide échoue. */
async function loadErrorCatalogue() {
  try {
    const response = await fetch(catalogueURL, { integrity, signal: AbortSignal.timeout(1400) });
    if (response.ok) return await response.json();
  } catch {}
  return {};
}

const catalogue = await loadErrorCatalogue();

/** Exclut les codes d’événement et les chaînes qui ne peuvent pas désigner une erreur. */
export function isDeviceErrorCode(code) {
  return (typeof code === 'string' || Number.isInteger(code)) &&
    /^[1-9]\d{0,9}$/.test(code) && String(code) !== '200';
}

/** Renvoie une fiche rédigée pour le code exact, sans déduire de proximité. */
export function errorSheet(code) {
  return isDeviceErrorCode(code) && Object.hasOwn(catalogue, code) ? catalogue[code] : null;
}

/** La fiche s’ouvre localement ; le lien facultatif reste limité au wiki officiel. */
export function openErrorSheet(item) {
  const code = String(item.reason_code);
  const sheet = errorSheet(code);
  const dialog = $('notification-error-dialog');
  if (dialog.open) return;
  set('notification-error-dialog-title', formatText('Code d’erreur : {0}', code));
  set('notification-error-subject', [item.printer, item.name].filter(Boolean).join(' · '));
  $('notification-error-heading').hidden = !sheet?.title;
  set('notification-error-heading', sheet ? tr(sheet.title) : '');
  set('notification-error-explanation', tr(sheet?.description || 'Ce code n’est pas encore documenté dans l’atelier.'));
  $('notification-error-message').hidden = !item.reason;
  set('notification-error-message-text', item.reason || '');
  $('notification-error-models').hidden = !sheet?.models.length;
  set('notification-error-models-list', sheet?.models.join(' · ') || '');
  $('notification-error-checks').hidden = !sheet?.steps.length;
  $('notification-error-steps').replaceChildren(
    ...(sheet?.steps || []).map((step) => node('li', tr(step))),
  );

  const source = $('notification-error-source');
  const url = sheet?.source || safeErrorSource(item.help_url);
  source.hidden = !url;
  if (url) source.href = url;
  else source.removeAttribute('href');
  dialog.showModal();
}

/** Refuse les hôtes voisins, les redirections et les paramètres provenant de la notification. */
export function safeErrorSource(value) {
  try {
    const url = new URL(value);
    if (
      url.origin === 'https://wiki.anycubic.com' &&
      !url.username && !url.password && !url.search && !url.hash &&
      url.pathname.length <= 240 &&
      /^\/(?:en|fr|zh)\/(?:error-codes|fdm-3d-printer)(?:\/[a-z0-9-]+)*\/?$/.test(url.pathname)
    ) return url.href;
  } catch {}
  return '';
}
