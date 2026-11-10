import {
  $,
  date,
  formatText,
  message,
  node,
  serverText,
  set,
  timeZone,
  tr,
} from './workshop-ui.mjs?v=4fb911698e53';
import { workshopState } from './workshop-state.mjs?v=f086eb175834';
import { createRequest } from './workshop-api.mjs?v=404f26d269c6';
import { createCamera } from './workshop-camera.mjs?v=c4d8c9db489f';
import { createTemperatureLoader } from './workshop-temperatures.mjs?v=dd79894e2b9a';
import { createCommands } from './workshop-commands.mjs?v=e2015bb986a1';
import { createOverview } from './workshop-overview.mjs?v=a0dd7fe11950';
import { createAce } from './workshop-ace.mjs?v=a7b41f2418cb';
import { createFiles } from './workshop-files.mjs?v=f900d2e0f7e8';
import { createHistory } from './workshop-history.mjs?v=954d214f9020';
import { createSettings } from './workshop-settings.mjs?v=9e053e390903';
import { createTimelapses } from './workshop-timelapses.mjs?v=a79ab46b8613';
import './workshop-help.mjs?v=0c6905c678cb';
import { createFleet } from './workshop-fleet.mjs?v=c6d0d14a939f';
export { previewJob } from './workshop-overview.mjs?v=a0dd7fe11950';

let printerCatalogueReady = false,
  printerCataloguePending = false,
  connectionFailure = false;
/** Le choix reste propre au navigateur ; les valeurs périmées se replient sur le défaut fourni par le serveur. */
async function loadPrinters() {
  if (printerCataloguePending) return;
  printerCataloguePending = true;
  try {
    const d = await request('/printers'),
      items = d.items || [];
    if (!items.length) return;
    let saved = '';
    try {
      saved = localStorage.getItem('cloud-page-printer') || '';
    } catch {}
    workshopState.selectedPrinter = items.some((x) => x.key === saved)
      ? saved
      : items.some((x) => x.key === d.default)
        ? d.default
        : items[0].key;
    const selector = $('printer-selector');
    selector.replaceChildren(...items.map((p) => new Option(p.name, p.key)));
    selector.value = workshopState.selectedPrinter;
    $('printer-selector-wrap').hidden = items.length < 2;
    printerCatalogueReady = true;
    if (workshopState.currentTab === 'files') void files.loadFiles();
    if (workshopState.currentTab === 'statistics') void loadTemperatures();
  } finally {
    printerCataloguePending = false;
  }
}
/** Une nouvelle page empêche de réutiliser un dialogue, un aperçu ou un cache de la machine précédente. */
async function choosePrinter() {
  const selector = $('printer-selector');
  if (workshopState.busy) {
    selector.value = workshopState.selectedPrinter;
    message(tr('Attendez la fin de l’opération avant de changer d’imprimante.'), true);
    return;
  }
  await camera.close();
  try {
    localStorage.setItem('cloud-page-printer', selector.value);
  } catch {
    message(tr('Le navigateur ne peut pas mémoriser ce choix.'), true);
    selector.value = workshopState.selectedPrinter;
    return;
  }
  location.reload();
}
$('printer-selector').onchange = choosePrinter;
const request = createRequest(() => workshopState.selectedPrinter);
const loadTemperatures = createTemperatureLoader(request);
const loadFleet = createFleet(request);
const camera = createCamera(request, () => workshopState.selectedPrinter);

const { command } = createCommands(request, refresh);
const overview = createOverview(request);
const ace = createAce(command, refresh);
const files = createFiles(request, command);
const history = createHistory(request, command, ace.selectedBox);
const settings = createSettings(request, command, camera);
const timelapses = createTimelapses(request);

/** Réaffiche les impressions déjà chargées. */
export function renderTasks() {
  history.renderTasks();
}

/** Actualise l’interface depuis l’état serveur et signale les erreurs de connexion sans répéter de commande. */
export function refresh() {
  if (!refreshPending)
    refreshPending = refreshState().finally(() => {
      refreshPending = null;
    });
  return refreshPending;
}

let refreshPending = null;

async function refreshState() {
  let received = false;
  try {
    if (!printerCatalogueReady) await loadPrinters();
    const d = await request('/status');
    received = true;
    if (connectionFailure && d.ok) {
      message('');
      connectionFailure = false;
    }
    workshopState.snapshot = d;
    if (workshopState.currentTab === 'camera') camera.updateDiagnostic(d.camera_diagnostic);
    if (d.notifications) history.syncNotifications(d.notifications);
    const p = d.printer;
    set(
      'connection',
      !d.ok ? tr('Cloud indisponible') : p?.printer_online ? tr('En ligne') : tr('Hors ligne'),
    );
    $('connection').classList.toggle('offline', !d.ok || !p?.printer_online);
    set(
      'updated',
      `${tr('Dernière actualisation')} : ${date([d.updated_at, d.mqtt_updated_at].filter(Boolean).sort().at(-1))} · ${timeZone}`,
    );
    if (!d.ok && d.message) {
      connectionFailure = true;
      message(d.message, true);
    }
    if (d.account_message)
      message(serverText(d.account_message, 'Échec de la lecture auprès d’Anycubic.'), true);
    const diagnosticLink = $('diagnostic-download'),
      diagnosticQuery = workshopState.selectedPrinter
        ? '?' + new URLSearchParams({printer: workshopState.selectedPrinter})
        : '';
    diagnosticLink.href = '/imprimante-api/diagnostic' + diagnosticQuery;
    const expiry = $('token-expiry');
    expiry.hidden = !Number.isFinite(d.token_expires_at);
    if (!expiry.hidden) {
      const remaining = d.token_expires_at - Date.now() / 1000;
      expiry.textContent = formatText(
        remaining <= 0
          ? 'Jeton Anycubic expiré le {0}.'
          : remaining <= 15 * 86400
            ? 'Le jeton Anycubic expire bientôt, le {0}.'
            : 'Expiration du jeton Anycubic le {0}.',
        date(d.token_expires_at),
      );
    }
    if (!p) {
      settings.disableQuickControls();
      return;
    }
    settings.updateNativeControls(p);
    files.updateUploadButton();
    overview.renderOverview(p);
    ace.renderAce(p);
    $('events').replaceChildren(
      ...d.events.map((e) =>
        node(
          'li',
          `${date(e.time)} — ${e.action} : ${serverText(e.state, 'Pas de diagnostic traduit pour cet événement.')}`,
        ),
      ),
    );
    files.update();
  } catch {
    if (received) console.warn('Échec du rendu après réception de l’état de l’atelier.');
    settings.disableQuickControls();
    connectionFailure = true;
    set('connection', tr('Connexion indisponible'));
    message(tr('Connexion au serveur momentanément indisponible.'), true);
  }
}
/** Change le panneau actif, charge ses données et ferme la session vidéo lorsque l’utilisateur quitte la caméra. */
function showTab(name) {
  workshopState.currentTab = name;
  for (const panel of document.querySelectorAll('.tab-panel'))
    panel.hidden = panel.id !== `tab-${name}`;
  for (const b of document.querySelectorAll('[data-tab]')) {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (name === 'files') {
    files.renderFiles();
    files.loadFiles();
  }
  if (name === 'history') history.loadTasks();
  if (name === 'statistics' && printerCatalogueReady) void loadTemperatures();
  if (name === 'fleet') void loadFleet();
  if (name === 'settings') settings.enter();
  if (name === 'camera') {
    timelapses.loadTimelapse();
    if (workshopState.snapshot?.demo) {
      const image = node('img');
      image.src = $('printer-illustration').src;
      image.alt = tr('Illustration de l’imprimante');
      $('camera-video').classList.add('demo-camera');
      $('camera-video').replaceChildren(
        image,
        node('p', tr('Zone vidéo · Démonstration sans flux caméra')),
      );
    }
  }
  if (name !== 'camera') void camera.close();
}
// Les onglets restent inactifs jusqu’au chargement des modules et de leurs gestionnaires.
for (const button of document.querySelectorAll('[data-tab]')) {
  button.onclick = () => showTab(button.dataset.tab);
  button.disabled = false;
}
document
  .querySelectorAll('[data-command]')
  .forEach((b) => (b.onclick = () => command(b.dataset.command, ace.boxData(), b.dataset.confirm)));
$('message-close').onclick = () => message('');
document
  .querySelectorAll('.dialog-close')
  .forEach((b) => (b.onclick = () => b.closest('dialog').close()));
$('temperature-hours').onchange = () => loadTemperatures();
setInterval(() => {
  if (workshopState.currentTab === 'fleet' && !document.hidden) void loadFleet();
  if (workshopState.currentTab === 'statistics' && printerCatalogueReady && !document.hidden)
    void loadTemperatures();
}, 30000);
refresh();
setInterval(() => {
  if (!document.hidden) refresh();
}, 3000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refresh();
    if (workshopState.currentTab === 'fleet') void loadFleet();
  }
});
window.addEventListener('pagehide', () => {
  void camera.close();
});
