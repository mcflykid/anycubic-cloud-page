import {
  $,
  date,
  formatText,
  fmt,
  mins,
  finishEstimate,
  taskFinish,
  printTimeline,
  message,
  node,
  serverText,
  set,
  timeZone,
  tr,
} from './workshop-ui.mjs';
import { workshopState } from './workshop-state.mjs';
import { createDeveloperTools } from './workshop-developer.mjs';
import { createRequest } from './workshop-api.mjs';
import { createCamera } from './workshop-camera.mjs';
import { createTemperatureLoader } from './workshop-temperatures.mjs';
import { printTrackingQuery, updatePrintConfirmation } from './workshop-print-confirmation.mjs';
import { createCommands } from './workshop-commands.mjs';
import { createOverview } from './workshop-overview.mjs';
import { createAce } from './workshop-ace.mjs';
import { createFiles } from './workshop-files.mjs';
import { createHistory } from './workshop-history.mjs';
import { createSettings } from './workshop-settings.mjs';
import { createTimelapses } from './workshop-timelapses.mjs';
import './workshop-help.mjs';
import { createMonitoring } from './workshop-monitoring.mjs';
import { createFleet } from './workshop-fleet.mjs';
import { initializeWorkshopNavigation } from './workshop-navigation.mjs';
initializeWorkshopNavigation();
import { initializeInteractions } from './workshop-interactions.mjs';
initializeInteractions();
import { renderSummary } from './workshop-summary.mjs';
import { bindMaintenance } from './workshop-maintenance.mjs';
import { bindPrintQueue } from './workshop-print-queue.mjs';
export { previewJob } from './workshop-overview.mjs';

let printerCatalogueReady = false,
  printerCataloguePending = false,
  connectionNotice = null;
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
const developer = createDeveloperTools(workshopState, (...args) => request(...args), () => ({
  commande: commandDiagnostic(),
  incident_cloud: !!connectionNotice,
  bandeau_visible: !$("message").hidden,
}));
const request = createRequest(() => workshopState.selectedPrinter, developer.record, developer.simulate);
bindMaintenance(request);
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

const { command, observeCommand, diagnostic: commandDiagnostic } = createCommands(request, refresh);
const overview = createOverview(request);
const ace = createAce(command, refresh);
const printQueue = bindPrintQueue(request, command);
$('queue-add-files').onclick = () => {
  $('queue-dialog').close();
  showTab('files');
};
const files = createFiles(request, command, printQueue.add);
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

$('printer-timeline-open').onclick = () => $('printer-timeline-dialog').showModal();
// Le Résumé ouvre la même fenêtre que l’onglet Imprimante pour ne pas dupliquer le registre.
$('summary-maintenance-due').onclick = () => $('maintenance-open').click();

const correctFinish = $('correct-finish');
try { correctFinish.checked = localStorage.getItem('cloud-page-correct-finish') !== 'off'; } catch {}
correctFinish.onchange = () => {
  try { localStorage.setItem('cloud-page-correct-finish', correctFinish.checked ? 'on' : 'off'); } catch {}
  const estimate = workshopState.snapshot?.printer?.corrected_finish;
  finishEstimate('summary-finish', estimate);
  finishEstimate('printer-finish', estimate);
  taskFinish(estimate);
};

/** Un relevé répété conserve l’heure et respecte la fermeture manuelle du même incident. */
function showConnectionNotice(text) {
  if (text === connectionNotice?.text || (!text && !connectionNotice)) return;
  if (!text) {
    if ($('message-text').textContent === connectionNotice.rendered) message('');
    connectionNotice = null;
    return;
  }
  message(text, true);
  connectionNotice = { text, rendered: $('message-text').textContent };
}

async function refreshState() {
  let received = false;
  try {
    if (!printerCatalogueReady) await loadPrinters();
    const trackingQuery = printTrackingQuery();
    const d = await request('/status' + trackingQuery);
    received = true;
    workshopState.snapshot = d;
    observeCommand(d);
    updatePrintConfirmation(d.ok === true, new URLSearchParams(trackingQuery).get('print_tracking'));
    if (workshopState.currentTab === 'camera') camera.updateDiagnostic(d.camera_diagnostic);
    if (d.notifications) history.syncNotifications(d.notifications);
    const p = d.printer;
    const alerts = d.heat_alerts || [];
    for (const id of ['summary-heat-warning', 'printer-heat-warning']) {
      const banner = $(id);
      banner.replaceChildren(...alerts.map(alert => node('strong', formatText(
        alert.part === 'bed'
          ? 'Le plateau n’atteint pas sa cible : {0} depuis {1} pour {2}.'
          : 'La buse n’atteint pas sa cible : {0} depuis {1} pour {2}.',
        fmt(alert.actual, ' °C'), mins(alert.seconds / 60), fmt(alert.target, ' °C'),
      ))));
      if (alerts.length) banner.append(node('span', tr('Vérifiez la porte, un courant d’air ou le capteur. Aucune action n’a été envoyée à l’imprimante.')));
      banner.hidden = !alerts.length;
    }
    // La ligne concernée reste repérable dans le tableau, même après lecture du bandeau.
    for (const part of ['nozzle', 'bed']) {
      $(`printer-${part}-row`).classList.toggle('heat-alert', alerts.some(alert => alert.part === part));
    }
    $('summary-maintenance-due').hidden = !p?.maintenance_due;
    set('summary-maintenance-due', p?.maintenance_due ? formatText('Entretien : {0} à faire', p.maintenance_due) : '');
    $('maintenance-count').hidden = !p?.maintenance_due;
    set('maintenance-count', p?.maintenance_due ? formatText('{0} à faire', p.maintenance_due) : '');

    void printQueue.observe(p, workshopState.selectedPrinter);
    finishEstimate('summary-finish', p?.corrected_finish);
    finishEstimate('printer-finish', p?.corrected_finish);
    printTimeline('printer-timeline', p?.print_timeline);
    $('printer-timeline-open').hidden = $('printer-timeline').hidden;
    if ($('printer-timeline').hidden && $('printer-timeline-dialog').open) $('printer-timeline-dialog').close();
    set(
      'connection',
      !d.ok ? tr('Cloud indisponible') : p?.printer_online ? tr('En ligne') : tr('Hors ligne'),
    );
    $('connection').classList.toggle('offline', !d.ok || !p?.printer_online);
    const following = d.ok && d.mqtt_connected === true;
    set('settings-follow-state', tr(following ? 'Suivi en direct' : d.mqtt_connected === false ? 'Suivi suspendu' : 'État inconnu'));
    $('settings-follow-state').classList.toggle('offline', !following);
    set(
      'updated',
      `${tr('Dernière actualisation')} : ${date([d.updated_at, d.mqtt_updated_at].filter(Boolean).sort().at(-1))} · ${timeZone}`,
    );
    const cloudWarning = d.ok ? null : d.account_message || d.message;
    showConnectionNotice(cloudWarning
      ? serverText(cloudWarning, 'Échec de la lecture auprès d’Anycubic.')
      : null);
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
    renderSummary(d);
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
    else updatePrintConfirmation(false);
    settings.disableQuickControls();
    set('connection', tr('Connexion indisponible'));
    showConnectionNotice(tr('Connexion au serveur momentanément indisponible.'));
  }
}
/** Change le panneau actif, charge ses données et ferme la session vidéo lorsque l’utilisateur quitte la caméra. */
function showTab(name) {
  if (name === 'developer' && document.querySelector('[data-tab="developer"]').hidden) return;
  if (workshopState.currentTab !== name) developer.leave(workshopState.currentTab);
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
  if (name === 'upload') void files.loadCloudStorage();
  if (name === 'history') history.loadTasks();
  if (name === 'statistics' && printerCatalogueReady) void loadTemperatures();
  if (name === 'fleet') { void loadFleet(); void loadMonitoring(); }
  if (name === 'settings') settings.enter();
  if (name === 'camera') timelapses.loadTimelapse();
  if (name !== 'camera') void camera.close();
  developer.show();
}
// Les onglets restent inactifs jusqu’au chargement des modules et de leurs gestionnaires.
for (const button of document.querySelectorAll('[data-tab]')) {
  button.onclick = () => showTab(button.dataset.tab);
  button.disabled = button.hidden;
}
// Les liens du résumé ouvrent les sections déjà chargées sans émettre d’ordre.
for (const button of document.querySelectorAll('[data-summary-open]')) {
  button.onclick = () => {
    showTab(button.dataset.summaryOpen);
    const tab = document.querySelector(`#atelier-tabs [data-tab="${button.dataset.summaryOpen}"]`);
    const compact = $('section-menu-toggle').getClientRects().length > 0;
    (compact ? $('section-menu-toggle') : tab)?.focus();
  };
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
// La cloche des réglages Discord rejoint le panneau qui existe déjà dans l’atelier.
if (location.hash === '#notifications') $('notifications-toggle').click();
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
