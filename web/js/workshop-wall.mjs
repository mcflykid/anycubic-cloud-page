import { $, date, finishEstimate, fmt, formatText, mins, node, set, tr } from './workshop-ui.mjs';
import { measurement } from './workshop-overview.mjs';
import { createRequest } from './workshop-api.mjs';

const root = document.documentElement;
root.dataset.theme = 'dark';
root.dataset.contrast = 'high';
const preferred = new URLSearchParams(location.search).get('printer');
const preview = $('wall-preview');
let target, printers = [], rotationStarted, lastPreview, wakeLock, pending = false;
const request = createRequest(() => target);

const camera = $('wall-camera');
const cameraChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('cloud-page-wall-camera') : null;
let cameraRequest, cameraTimeout, previewReady = false, online = false;

/** Rend l’aperçu dès que le lecteur de l’atelier cesse de fournir des images. */
function clearCamera() {
  clearTimeout(cameraTimeout);
  camera.hidden = true;
  camera.removeAttribute('src');
  preview.hidden = !previewReady;
}

if (cameraChannel) {
  cameraChannel.onmessage = ({data}) => {
    if (data?.kind !== 'frame' || data.request !== cameraRequest || data.printer !== target ||
        !online || document.hidden || typeof data.image !== 'string' ||
        data.image.length > 1000000 || !/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(data.image)) return;
    camera.src = data.image;
    clearTimeout(cameraTimeout);
    cameraTimeout = setTimeout(clearCamera, 2500);
  };
  camera.onload = () => { camera.hidden = false; preview.hidden = true; };
  setInterval(() => {
    if (!target || !online || document.hidden || !globalThis.crypto?.randomUUID) return;
    cameraRequest = crypto.randomUUID();
    cameraChannel.postMessage({kind:'request', printer:target, request:cameraRequest});
  }, 1000);
}

/** Garde la tablette éveillée lorsque le navigateur autorise la demande. */
async function keepAwake() {
  if (document.hidden || !navigator.wakeLock || wakeLock && !wakeLock.released) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}

/** Réutilise les relevés d’atelier et ne commande aucun appareil. */
async function refresh() {
  if (pending || document.hidden) return;
  pending = true;
  try {
    if (!printers.length) {
      printers = (await request('/printers')).items || [];
      rotationStarted = Date.now();
    }
    const selected = preferred || printers[Math.floor((Date.now() - rotationStarted) / 20000) % printers.length]?.key;
    if (selected !== target) {
      online = false;
      previewReady = false;
      clearCamera();
    }
    target = selected;
    if (!target) return;
    const {printer, ok, updated_at, mqtt_updated_at} = await request('/status');
    online = ok && printer?.printer_online === true;
    if (!online) clearCamera();
    set('wall-printer', printer?.name || tr('Imprimante'));
    set('wall-state', tr(!ok ? 'Cloud indisponible' : !printer?.printer_online ? 'Hors ligne'
      : printer.job_is_paused ? 'En pause' : printer.job_in_progress ? 'Impression en cours' : 'Disponible'));
    const stamps = [updated_at, mqtt_updated_at].filter(Boolean);
    set('wall-updated', stamps.length ? formatText('Dernière actualisation : {0}', date(stamps.sort().at(-1))) : '');
    const active = printer?.job_in_progress === true;
    set('wall-job', printer?.job_name || tr('Aucune impression en cours.'));
    const result = printer?.job_complete ? 'Impression terminée' : printer?.job_failed ? 'Impression arrêtée' : '';
    set('wall-last-result', !active && result ? [tr(result), printer.job_finished_at && date(printer.job_finished_at)].filter(Boolean).join(' · ') : '');
    finishEstimate('wall-finish',
      printer?.job_state === 'printing' ? printer.job_time_remaining : null, stamps.at(-1));
    const progress = $('wall-progress');
    progress.hidden = !Number.isFinite(printer?.job_progress);
    if (!progress.hidden) progress.value = printer.job_progress;
    set('wall-progress-text', progress.hidden ? '' : fmt(printer.job_progress, ' %'));
    set('wall-timing', active ? [
      printer?.job_current_layer != null ? formatText('Couche {0}', printer.job_current_layer) : '',
      printer?.job_in_progress && Number.isFinite(printer.job_time_remaining) ? mins(printer.job_time_remaining) : '',
      printer?.job_eta ? date(printer.job_eta) : '',
    ].filter(Boolean).join(' · ') : '');
    $('wall-temperature').replaceChildren(...[
      ['Buse', 'curr_nozzle_temp'], ['Plateau', 'curr_hotbed_temp'],
    ].map(([label, key]) => {
      const item = node('div');
      item.append(node('dt', tr(label)), node('dd', measurement(printer?.[key], ' °C', printer?.measurement_freshness?.[key])));
      return item;
    }));
    $('wall-ace').replaceChildren(...(printer?.boxes || []).map(box => {
      const item = node('article'), slots = node('ul');
      const drying = box.drying?.is_drying;
      const dryingState = drying === true ? 'Séchage en cours' : drying === false ? 'Séchage inactif' : 'État du séchage inconnu';
      item.append(node('h2', box.model || tr('Module ACE')),
        node('p', tr(dryingState) + ' · ' + measurement(box.humidity, ' %', box.measurement_freshness?.humidity)), slots);
      for (const spool of box.spools || []) {
        const row = node('li'), color = node('span', null, 'wall-swatch');
        const rgb = spool.color?.slice(0, 3);
        if (Array.isArray(rgb) && rgb.length === 3 && rgb.every(value => Number.isInteger(value) && value >= 0 && value <= 255))
          color.style.backgroundColor = `rgb(${rgb.join(',')})`;
        const slot = spool.display_slot ?? spool.slot;
        const warning = printer.filament_shortfalls?.find(entry => entry.slot === slot);
        row.append(color, node('span', [slot, spool.material_type, fmt(spool.remaining_percent, ' %'),
          box.loaded_slot === (spool.local_slot ?? spool.slot) - 1 ? tr('Bobine engagée') : ''].filter(Boolean).join(' · ')));
        if (warning) row.append(node('span', formatText('Emplacement {0} : environ {1} g restants pour {2} g estimés.',
          slot, fmt(warning.grams), fmt(warning.needed)), 'wall-warning'));
        slots.append(row);
      }
      return item;
    }));
    const project = printer?.command_project;
    const key = printer?.job_name && JSON.stringify([target, project, printer.job_name]);
    if (key !== lastPreview) {
      lastPreview = key;
      previewReady = false;
      preview.hidden = true;
      preview.removeAttribute('src');
      if (key) {
        const result = await request('/preview', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({source:'active', project_key:project}),
        }).catch(() => null);
        if (result?.image) preview.src = result.image;
        else if (!result) lastPreview = null;
      }
    }
  } catch {
    online = false;
    clearCamera();
    set('wall-state', tr('Connexion indisponible'));
  } finally {
    pending = false;
  }
}

preview.onload = () => { previewReady = true; preview.hidden = !camera.hidden; };
preview.onerror = () => { previewReady = false; preview.hidden = true; };
document.addEventListener('visibilitychange', () => { void keepAwake(); void refresh(); });
void keepAwake();
void refresh();
setInterval(refresh, 3000);
