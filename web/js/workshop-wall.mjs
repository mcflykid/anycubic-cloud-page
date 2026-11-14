import { $, date, finishEstimate, fmt, formatText, measurement, mins, node, set, tr, locale, timeZone } from './workshop-ui.mjs';
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
  $('wall-live').hidden = true;
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
  camera.onload = () => { camera.hidden = false; preview.hidden = true; $('wall-live').hidden = false; };
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
    $('wall-state').dataset.active = String(online && active);
    set('wall-job', printer?.job_name || tr('Aucune impression en cours.'));
    const result = printer?.job_complete ? 'Impression terminée' : printer?.job_failed ? 'Impression arrêtée' : '';
    set('wall-last-result', !active && result ? [tr(result), printer.job_finished_at && date(printer.job_finished_at)].filter(Boolean).join(' · ') : '');
    finishEstimate('wall-finish',
      printer?.job_state === 'printing' ? printer.job_time_remaining : null, stamps.at(-1));
    const progress = $('wall-progress');
    progress.hidden = !Number.isFinite(printer?.job_progress);
    if (!progress.hidden) progress.value = printer.job_progress;
    set('wall-progress-text', progress.hidden ? '' : fmt(printer.job_progress, ' %'));
    $('wall-no-finish').hidden = !$('wall-finish').hidden;
    if (!$('wall-finish').hidden) {
      const time = new Date(Date.parse(stamps.at(-1)) + printer.job_time_remaining * 60000);
      set('wall-finish', wallClock.format(time));
    }
    set('wall-layer', active && printer?.job_current_layer != null
      ? formatText('Couche {0}', printer.job_total_layers
          ? printer.job_current_layer + ' / ' + printer.job_total_layers : printer.job_current_layer) : '');
    set('wall-timing', active ? mins(printer.job_time_remaining) : '—');
    for (const [id, key, targetKey] of [
      ['wall-nozzle', 'curr_nozzle_temp', 'target_nozzle_temp'],
      ['wall-bed', 'curr_hotbed_temp', 'target_hotbed_temp'],
    ]) {
      const value = measurement(printer?.[key], ' °C', printer?.measurement_freshness?.[key]);
      $(id).replaceChildren(value);
      if (Number.isFinite(printer?.[targetKey]))
        $(id).append(node('small', ' / ' + fmt(printer[targetKey]), 'wall-muted'));
    }
    $('wall-ace').replaceChildren(...(printer?.boxes || []).flatMap(box => {
      const drying = box.drying?.is_drying;
      const dryingState = drying === true ? 'Séchage en cours' : drying === false ? 'Inactif' : 'État du séchage inconnu';
      const summary = node('article', null, 'wall-drying');
      summary.append(node('p', box.model || tr('Module ACE'), 'wall-muted'), node('h2', tr(dryingState)),
        node('p', [measurement(box.humidity, ' %', box.measurement_freshness?.humidity),
          measurement(box.temperature, ' °C', box.measurement_freshness?.temperature)].join(' · '), 'wall-muted'));
      return [...(box.spools || []).map(spool => {
        const row = node('article', null, 'wall-spool'), color = node('span', null, 'wall-swatch');
        const rgb = spool.color?.slice(0, 3);
        if (Array.isArray(rgb) && rgb.length === 3 && rgb.every(value => Number.isInteger(value) && value >= 0 && value <= 255))
          color.style.backgroundColor = `rgb(${rgb.join(',')})`;
        const slot = spool.display_slot ?? spool.slot;
        const engaged = active && box.loaded_slot === (spool.local_slot ?? spool.slot) - 1;
        row.dataset.engaged = String(engaged);
        const heading = node('h2');
        heading.append(color, [slot, spool.material_type].filter(Boolean).join(' · '));
        if (engaged) heading.append(node('span', tr('En cours'), 'wall-engaged'));
        row.append(heading);
        const remaining = spool.remaining_percent;
        const warning = printer.filament_shortfalls?.find(entry => entry.slot === slot);
        if (Number.isFinite(remaining) && remaining >= 0) {
          const label = node('p', null, 'wall-remaining');
          label.append(node('span', tr('Restant')), node('strong', fmt(remaining, ' %')));
          const level = node('progress');
          level.max = 100; level.value = remaining;
          level.setAttribute('aria-label', formatText('Emplacement {0}', slot));
          if (warning || remaining <= 10) row.dataset.low = 'true';
          row.append(label, level);
        }
        if (warning) row.append(node('p', formatText('Emplacement {0} : environ {1} g restants pour {2} g estimés.',
          slot, fmt(warning.grams), fmt(warning.needed)), 'wall-warning'));
        return row;
      }), summary];
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

const wallClock = new Intl.DateTimeFormat(locale, {timeStyle:'short', timeZone});
function updateClock() { set('wall-clock', wallClock.format(new Date())); }
updateClock();
setInterval(updateClock, 1000);

preview.onload = () => { previewReady = true; preview.hidden = !camera.hidden; };
preview.onerror = () => { previewReady = false; preview.hidden = true; };
document.addEventListener('visibilitychange', () => { void keepAwake(); void refresh(); });
void keepAwake();
void refresh();
setInterval(refresh, 3000);
