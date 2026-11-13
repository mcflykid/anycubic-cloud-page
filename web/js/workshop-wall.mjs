import { $, date, fmt, formatText, mins, node, set, tr } from './workshop-ui.mjs';
import { createRequest } from './workshop-api.mjs';

const root = document.documentElement;
root.dataset.theme = 'dark';
root.dataset.contrast = 'high';
const preferred = new URLSearchParams(location.search).get('printer');
const preview = $('wall-preview');
let target, printers = [], lastPreview, wakeLock, pending = false;
const request = createRequest(() => target);

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
    if (!printers.length) printers = (await request('/printers')).items || [];
    target = preferred || printers[Math.floor(Date.now() / 20000) % printers.length]?.key;
    if (!target) return;
    const {printer, ok, updated_at, mqtt_updated_at} = await request('/status');
    set('wall-printer', printer?.name || tr('Imprimante'));
    set('wall-state', tr(!ok ? 'Cloud indisponible' : !printer?.printer_online ? 'Hors ligne'
      : printer.job_is_paused ? 'En pause' : printer.job_in_progress ? 'Impression en cours' : 'Disponible'));
    const stamps = [updated_at, mqtt_updated_at].filter(Boolean);
    set('wall-updated', stamps.length ? formatText('Dernière actualisation : {0}', date(stamps.sort().at(-1))) : '');
    set('wall-job', printer?.job_name || tr('Aucune impression en cours.'));
    const progress = $('wall-progress');
    progress.hidden = !Number.isFinite(printer?.job_progress);
    if (!progress.hidden) progress.value = printer.job_progress;
    set('wall-progress-text', progress.hidden ? '' : fmt(printer.job_progress, ' %'));
    set('wall-timing', [
      printer?.job_current_layer != null ? formatText('Couche {0}', printer.job_current_layer) : '',
      printer?.job_in_progress && Number.isFinite(printer.job_time_remaining) ? mins(printer.job_time_remaining) : '',
      printer?.job_eta ? date(printer.job_eta) : '',
    ].filter(Boolean).join(' · '));
    $('wall-temperature').replaceChildren(...[
      ['Buse', printer?.curr_nozzle_temp], ['Plateau', printer?.curr_hotbed_temp],
    ].map(([label, value]) => {
      const item = node('div');
      item.append(node('dt', tr(label)), node('dd', fmt(value, ' °C')));
      return item;
    }));
    $('wall-ace').replaceChildren(...(printer?.boxes || []).map(box => {
      const item = node('article'), slots = node('ul');
      item.append(node('h2', box.model || tr('Module ACE')),
        node('p', tr(box.drying?.is_drying ? 'Séchage en cours' : 'Séchage inactif') + ' · ' + fmt(box.humidity, ' %')), slots);
      for (const spool of box.spools || []) {
        const row = node('li'), color = node('span', null, 'wall-swatch');
        const rgb = spool.color?.slice(0, 3);
        if (Array.isArray(rgb) && rgb.length === 3 && rgb.every(value => Number.isInteger(value) && value >= 0 && value <= 255))
          color.style.backgroundColor = `rgb(${rgb.join(',')})`;
        row.append(color, node('span', [spool.display_slot ?? spool.slot, spool.material_type, fmt(spool.remaining_percent, ' %'),
          box.loaded_slot === (spool.local_slot ?? spool.slot) - 1 ? tr('Bobine engagée') : ''].filter(Boolean).join(' · ')));
        slots.append(row);
      }
      return item;
    }));
    const project = printer?.command_project;
    const key = printer?.job_name && JSON.stringify([target, project, printer.job_name]);
    if (key !== lastPreview) {
      lastPreview = key;
      preview.hidden = true;
      preview.removeAttribute('src');
      if (key) {
        const result = await request('/preview', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({source:'active', project_key:project}),
        }).catch(() => null);
        if (result?.image) preview.src = result.image;
      }
    }
  } catch {
    set('wall-state', tr('Connexion indisponible'));
  } finally {
    pending = false;
  }
}

preview.onload = () => { preview.hidden = false; };
preview.onerror = () => { preview.hidden = true; };
document.addEventListener('visibilitychange', () => { void keepAwake(); void refresh(); });
void keepAwake();
void refresh();
setInterval(refresh, 3000);
