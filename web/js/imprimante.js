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
} from './workshop-ui.mjs?v=694563e60115';
import { workshopState } from './workshop-state.mjs?v=71c71895c6b5';
import { createRequest } from './workshop-api.mjs?v=fa16ecec3947';
import { createCamera } from './workshop-camera.mjs?v=333b98e7918b';
import { createTemperatureLoader } from './workshop-temperatures.mjs?v=3063042e00ca';
import { createCommands } from './workshop-commands.mjs?v=4706603eff7c';
import { createOverview } from './workshop-overview.mjs?v=6b97acac21cb';
import { createAce } from './workshop-ace.mjs?v=580160a1d554';
import { createFiles } from './workshop-files.mjs?v=0d73b8c79480';
import { createHistory } from './workshop-history.mjs?v=cd11062543f6';
import { createSettings } from './workshop-settings.mjs?v=85c24bd2adfd';
import { createTimelapses } from './workshop-timelapses.mjs?v=3eb07d3fa4b9';
import './workshop-help.mjs?v=9fc52368ba84';
import { createMonitoring } from './workshop-monitoring.mjs?v=3f91f65e56f0';
import { createFleet } from './workshop-fleet.mjs?v=94fe70da75bf';
import { initializeWorkshopNavigation } from './workshop-navigation.mjs?v=2e0e603d8a51';
initializeWorkshopNavigation();
import { initializeInteractions } from './workshop-interactions.mjs?v=2c46634d5381';
initializeInteractions();
import { initializeLabLayout } from './workshop-lab.mjs?v=8fa41de04918';
initializeLabLayout();
export { previewJob } from './workshop-overview.mjs?v=6b97acac21cb';

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
const loadTemperatures = createTemperatureLoader(
  request,
  () => workshopState.selectedPrinter,
  () => workshopState.snapshot?.printer,
);
const loadFleet = createFleet(request);
const loadMonitoring = createMonitoring(request);
const camera = createCamera(request, () => workshopState.selectedPrinter);
/** Attend la libération du viewer avant de révoquer la session avec le POST natif. */
let logoutPending = false;
const logoutForm = document.querySelector('.logout-form');
if (logoutForm) logoutForm.addEventListener('submit', (event) => {
  if (logoutPending) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  logoutPending = true;
  const submit = logoutForm.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  void camera.close().finally(() => HTMLFormElement.prototype.submit.call(logoutForm));
});

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
  if (name === 'fleet') { void loadFleet(); void loadMonitoring(); }
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
setInterval(() => {
  if (workshopState.currentTab === 'fleet' && !document.hidden) void loadMonitoring();
}, 5000);
refresh();
setInterval(() => {
  if (!document.hidden) refresh();
}, 3000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refresh();
    if (workshopState.currentTab === 'fleet') { void loadFleet(); void loadMonitoring(); }
  }
});
window.addEventListener('pagehide', () => {
  void camera.close();
});
