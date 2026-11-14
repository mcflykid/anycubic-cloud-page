const tabDialogs = {
  summary: ['queue-dialog', 'maintenance-dialog'],
  overview: ['controls-dialog', 'printer-timeline-dialog'],
  ace: ['spool-dialog', 'dry-dialog', 'filament-profile-dialog', 'filament-profile-create'],
  files: ['print-dialog'],
  upload: ['cloud-rename-dialog', 'cloud-download-dialog', 'print-dialog'],
  camera: [],
  history: ['history-period-dialog', 'past-task-dialog', 'task-rating-dialog', 'historical-notifications-dialog'],
  statistics: [],
  fleet: ['monitor-detail'],
  settings: ['ai-dialog', 'reset-dialog', 'reauth-dialog', 'settings-logs-dialog', 'firmware-notes-dialog'],
};

const routes = new Set([
  '/ai-settings', '/camera-close', '/camera-presence', '/camera-session',
  '/cloud/downloads', '/command', '/demo/scenario', '/diagnostic', '/extras/device', '/extras/rating',
  '/extras/storage', '/extras/task', '/extras/tasks', '/extras/videos', '/files/cloud',
  '/files/local', '/files/usb', '/fleet', '/history', '/history/delete', '/history/read',
  '/journal', '/maintenance', '/monitoring', '/preflight', '/preview', '/print-queue',
  '/print/cancel-transfer', '/printers', '/reauth', '/reset/challenge', '/status',
  '/temperatures', '/upload',
]);
const sharedDialogs = ['confirm-dialog', 'context-help-dialog', 'notification-error-dialog', 'notification-preview-dialog'];
const measures = [
  'printer_online', 'is_available', 'is_busy', 'job_in_progress', 'job_is_paused',
  'job_progress', 'job_current_layer', 'job_total_layers', 'job_time_elapsed', 'job_time_remaining',
  'axes_supported', 'camera_light', 'curr_nozzle_temp', 'target_nozzle_temp', 'curr_hotbed_temp',
  'target_hotbed_temp', 'fan_speed_pct', 'aux_fan_speed_pct', 'box_fan_level',
  'maintenance_due', 'firmware_updating', 'firmware_update_available',
];

function inventory(root, identifiers) {
  return [...root.querySelectorAll('button, select, input, textarea, details, a, dialog')].flatMap((control, index) => {
    if (control.closest('.developer-card,.developer-toggle')) return [];
    const hidden = !!control.closest('[hidden],dialog:not([open])') ||
      !control.getClientRects().length || getComputedStyle(control).visibility !== 'visible';
    const id = identifiers.has(control.id) ? control.id : null;
    const row = {
      repère: id || `#${index + 1}`,
      type: control.tagName.toLowerCase(),
      masqué: hidden,
      grisé: control.matches(':disabled,[aria-disabled="true"]'),
    };
    if (control instanceof HTMLSelectElement) {
      row.options = [...control.options].map((option, position) => ({
        position: position + 1,
        sélectionnée: option.selected,
        grisée: option.disabled || !!option.closest('optgroup:disabled') || row.grisé,
        masquée: option.hidden || !!option.closest('optgroup[hidden]'),
      }));
    }
    if (control.matches('input[type=radio], input[type=checkbox]')) row.coché = control.checked;
    return [row];
  });
}

const witnessFormats = ['stl', '3mf', 'gcode', 'gcode.3mf'];
const witnessPath = '/imprimante-api/ui/temoin/';
const witnessExpected = {
  stl: 'Maillage de la plaque, à trancher',
  '3mf': 'Projet avec une plaque et son profil, à trancher',
  gcode: 'Trajectoire et métadonnées monofilament',
  'gcode.3mf': 'Paquet tranché contenant le même G-code',
};
const preference = 'anycubic-developer-mode';
const demoScenarios = [
  ['standard', 'Données habituelles'],
  ['sechage-conseille', 'Humidité élevée avec du PETG'],
  ['humidite-absente', 'Humidité non transmise'],
  ['chauffe-lente', 'Plateau trop lent à chauffer'],
  ['chute-en-impression', 'Chute de la buse en impression'],
  ['mise-a-jour-notes', 'Mise à jour avec notes'],
  ['mise-a-jour-obligatoire', 'Mise à jour obligatoire sans notes'],
];

function clock() {
  const now = new Date();
  return `${now.toLocaleTimeString('fr-FR', {hour12: false})}.${String(now.getMilliseconds()).padStart(3, '0')}`;
}

const errorKinds = new Set(['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError',
  'EvalError', 'AggregateError', 'DOMException', 'AbortError', 'TimeoutError', 'NetworkError', 'NotAllowedError']);

// Le texte d’une exception peut citer un chemin, un fichier ou un identifiant : seuls le type,
// un module servi par l’atelier et la ligne sont conservés, à l’écran comme dans le rapport.
function errorRow(kind, source, line) {
  const module = String(source || '').split(/[?#]/)[0].split('/').pop();
  const known = /^(?:workshop-[a-z-]+\.mjs|imprimante\.js|discord-settings\.mjs|filament-profiles-data\.mjs)$/.test(module);
  const number = Number.isInteger(Number(line)) && Number(line) > 0 ? Number(line) : null;
  return {
    type: errorKinds.has(kind) ? kind : 'Erreur',
    module: known ? (number ? `${module}:${number}` : module) : 'module externe',
  };
}

function stackOrigin(stack) {
  const match = String(stack || '').match(/([\w.-]+\.m?js)(?:\?[^:]*)?:(\d+)/);
  return match ? [match[1], match[2]] : [null, null];
}

// Seules les routes publiques connues peuvent entrer dans le rapport.
function publicRoute(route) {
  return routes.has(route) ? route : '(autre)';
}

const findingsText = {
  cloud_stale: 'Données Cloud anciennes. Vérifiez la connexion au compte.',
  mqtt_stale: 'Rapports MQTT anciens. Vérifiez la connexion et attendez le prochain relevé.',
  ace_mismatch: 'Bobine engagée différente de la sélection. Vérifiez l’affectation ACE.',
};

function browserFamily() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Autre';
}

function version() {
  const text = document.getElementById('app-version').textContent;
  return text.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null;
}

function freshness(snapshot) {
  return Object.fromEntries(['updated_at', 'mqtt_updated_at'].map(key => {
    const stamp = snapshot?.[key];
    const ms = typeof stamp === 'number' ? stamp * 1000 : Date.parse(stamp);
    const age = Number.isFinite(ms) ? Math.max(0, Math.round((Date.now() - ms) / 1000)) : null;
    return [key, {âge_s: age, état: age === null ? 'inconnu' : age > 30 ? 'ancien' : 'récent'}];
  }));
}

function renderWitness(host, manifest) {
  const image = host.querySelector('img');
  if (!image.hasAttribute('src')) image.src = witnessPath + 'piece-temoin.svg';
  const dimensions = manifest.dimensions_mm.join(' × ');
  host.querySelector('p').textContent = `${dimensions} mm · encoche de ${manifest.encoche_mm.join(' × ')} mm · ${manifest.machine} · ${manifest.slicer} · profil ${manifest.profile} · buse ${manifest.nozzle_mm} mm · ${manifest.layers} couches à ${manifest.layer_mm} mm · ${manifest.filaments} filament ${manifest.material} · ${manifest.grams} g · ${manifest.length_mm} mm · ${manifest.seconds} s estimées.`;
  host.querySelector('[data-warnings]').textContent = `Avertissements du trancheur : ${manifest.warnings.join(', ')}. Validation physique à effectuer séparément.`;
  const files = host.querySelector('ul');
  files.replaceChildren(...witnessFormats.map(format => {
    const name = `piece-temoin.${format}`;
    const entry = manifest.files.find(item => item.name === name && item.format === format);
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = witnessPath + name;
    link.download = name;
    link.textContent = format.toUpperCase();
    const hash = document.createElement('code');
    hash.textContent = entry?.sha256 ?? '';
    item.append(link, ` · ${witnessExpected[format]} · SHA-256 `, hash);
    return item;
  }));
}

/** Conserve les observations en mémoire et limite les exports aux données prévues pour le diagnostic. */
export function createDeveloperTools(state, request, banner) {
  const toggle = document.getElementById('developer-mode');
  const tabButton = document.querySelector('[data-tab="developer"]');
  const unread = tabButton.querySelector('.developer-unread');
  const panel = document.getElementById('tab-developer');
  const readings = new Map();
  // Les identifiants ajoutés par les données d’installation ne deviennent pas des repères exportables.
  const identifiers = new Set([...document.querySelectorAll('[id]')].map(element => element.id));
  let tools;
  const signals = [];
  // Les relevés réguliers de /status chasseraient vite un incident du journal principal.
  const incidents = [];
  const errors = [];
  let sequence = 0;
  let active = false;
  let started = 0;
  let generation = 0;
  let currentService = null;
  let serviceReadAt = 0;
  let lastProgress;
  let progressRegressed = false;

  function observe(snapshot) {
    if (!active) return;
    const printer = snapshot?.printer;
    if (snapshot?.ok !== true || printer?.job_state !== 'printing' ||
        !printer.command_project || !Number.isFinite(printer.job_progress)) {
      lastProgress = undefined;
      progressRegressed = false;
      return;
    }
    if (lastProgress?.task !== printer.command_project) progressRegressed = false;
    else if (printer.job_progress < lastProgress.value) progressRegressed = true;
    lastProgress = {task: printer.command_project, value: printer.job_progress};
  }
  let lastRead = 0;
  let witnessPending;
  let witness;
  let simulation = null;
  let journalFrame = 0;
  let readingTimer = 0;
  const isDemo = !!document.querySelector('.demo-banner');
  let saved = false;
  try { saved = localStorage.getItem(preference) === '1'; } catch {}

  async function showWitness(host) {
    try {
      witnessPending ??= fetch(witnessPath + 'reference.json').then(response => {
        if (!response.ok) throw new Error();
        return response.json();
      });
      witness ??= await witnessPending;
      if (active) renderWitness(host, witness);
    } catch {
      witnessPending = null;
      if (active) host.querySelector('p').textContent = 'Référence indisponible. Rouvrez la section pour réessayer.';
    }
  }

  function report(server) {
    const target = state.snapshot?.printer || {};
    const current = Object.fromEntries(measures.flatMap(key =>
      typeof target[key] === 'boolean' || Number.isFinite(target[key]) ? [[key, target[key]]] : [],
    ));
    return {
      onglet: 'developer',
      version: version(),
      service: server,
      bandeaux: banner(),
      fraîcheur: freshness(state.snapshot),
      mesures: current,
      signaux_page: signals.slice(),
      incidents: incidents.slice(),
      erreurs_js: errors.slice(),
    };
  }

  function makeCard() {
    const card = document.createElement('section');
    card.className = 'atelier-card developer-card';
    card.setAttribute('aria-label', 'Outils de développement');
    card.innerHTML = `
      <header class="atelier-card-header"><h2>Outils de développement</h2><button type="button" class="atelier-control" data-disable aria-label="Désactiver le mode développeur">Ω</button></header>
      <div class="atelier-card-body">
        <nav data-summary data-wide aria-label="État en un coup d’œil"></nav>
        <details open data-wide><summary class="atelier-disclosure">À examiner</summary>
          <ul class="developer-log" data-findings aria-label="Constats à examiner"></ul>
        </details>
        <details data-wide><summary class="atelier-disclosure">Activité unifiée</summary>
          <div class="developer-filters">
            <label>Rechercher dans l’activité <input data-activity-search type="search"></label>
            <label>Gravité <select data-activity-level><option value="">Toutes</option><option value="incident">Incidents</option></select></label>
          </div>
          <ul class="developer-log" data-activity aria-label="Activité unifiée"></ul>
        </details>
        <details open data-trace><summary class="atelier-disclosure">Journal HTTP</summary>
          <div class="developer-filters">
            <label>Méthode <select data-method><option value="">Toutes</option>${['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(value => `<option>${value}</option>`).join('')}</select></label>
            <label>Statut <select data-status><option value="">Tous</option><option>2xx</option><option>4xx</option><option>5xx</option><option value="retry">Reprise</option><option value="interrupt">Interruption</option><option value="incident">Incidents</option></select></label>
            <label>Route <select data-route><option value="">Toutes</option></select></label>
          </div>
          <ul class="developer-log" aria-label="Requêtes" data-empty="Aucune requête depuis l’activation."></ul>
        </details>
        <details open data-diagnostic><summary class="atelier-disclosure">Diagnostic serveur</summary>
          <p data-ace-summary></p><p data-finish-summary></p>
          <ul class="developer-log" aria-label="Signaux serveur" data-server-signals data-empty="Relevez le diagnostic pour afficher les signaux Cloud et MQTT."></ul>
          <pre tabindex="0" aria-label="Diagnostic du serveur" data-service></pre>
        </details>
        <details data-errors><summary class="atelier-disclosure">Erreurs du navigateur</summary>
          <ul class="developer-log" aria-label="Erreurs du navigateur" data-error-list data-empty="Aucune erreur JavaScript depuis l’ouverture de la page."></ul>
        </details>
        <details data-banners><summary class="atelier-disclosure">Bandeaux et fraîcheur des données</summary>
          <button type="button" class="atelier-control" data-refresh-state>Actualiser les relevés</button>
          <pre data-state tabindex="0"></pre>
        </details>
        <details data-controls><summary class="atelier-disclosure">Contrôles relevés</summary>
          <label>Onglet relevé <select data-reading></select></label>
          <p data-reading-age></p><pre data-interface tabindex="0" aria-label="Contrôles de l’onglet relevé"></pre>
        </details>
        <details data-simulation hidden><summary class="atelier-disclosure">Simulation (démo uniquement)</summary>
          <label>État fictif de la démo <select data-scenario>${demoScenarios.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
          <button type="button" class="atelier-control" data-scenario-apply>Appliquer l’état fictif</button>
          <label>Simulation GET en démo <select data-fault><option value="">Désactivée</option><option value="delay">Latence de 1 s</option><option value="502">HTTP 502</option><option value="timeout">Délai dépassé</option></select></label>
          <label>Lecture à simuler <select data-simulation-route><option value="/diagnostic">Diagnostic</option>${[...routes].sort().filter(route => route !== '/diagnostic').map(route => `<option>${route}</option>`).join('')}</select></label>
          <button type="button" class="atelier-control" data-simulate>Armer la simulation</button>
        </details>
        <details data-witness><summary class="atelier-disclosure">Pièce témoin</summary>
          <img alt="Plaque rectangulaire avec encoche sur un angle" width="180" height="120" loading="lazy">
          <p>Chargement de la référence…</p><p data-warnings></p><ul></ul>
        </details>
        <details data-export data-wide><summary class="atelier-disclosure">Rapport expurgé</summary>
          <div class="developer-filters">
            <label><input type="checkbox" data-report-part="http" checked> HTTP</label>
            <label><input type="checkbox" data-report-part="browser" checked> Navigateur</label>
            <label><input type="checkbox" data-report-part="server" checked> Serveur et ACE</label>
            <label><input type="checkbox" data-report-part="status" checked> Bandeaux et fraîcheur</label>
          </div>
          <button type="button" class="atelier-control" data-copy>Copier un rapport expurgé</button>
          <textarea data-report rows="12" aria-label="Aperçu du rapport expurgé" readonly hidden></textarea>
        </details>
        <p data-feedback role="status"></p>
      </div>
      <footer class="atelier-card-footer">
        <button type="button" class="atelier-control" data-refresh>Relever le diagnostic</button>
        <button type="button" class="atelier-control" data-compare>Fixer un point de comparaison</button>
      </footer>`;
    const find = selector => card.querySelector(selector);
    const output = find('[data-service]');
    const summary = find('[data-ace-summary]');
    const journal = find('[data-trace] .developer-log');
    const [method, status, route] = [...find('[data-trace]').querySelectorAll('select')];
    const feedback = find('[data-feedback]');
    const witnessPanel = find('[data-witness]');
    const readingSelector = find('[data-reading]');
    find('[data-disable]').onclick = () => { setMode(false); toggle.focus(); };
    witnessPanel.ontoggle = () => { if (witnessPanel.open && active) void showWitness(witnessPanel); };
    find('[data-simulation]').hidden = !isDemo;
    find('[data-simulate]').onclick = async () => {
      const mode = find('[data-fault]').value;
      const route = find('[data-simulation-route]').value;
      simulation = mode ? {route, mode, remaining: mode === 'delay' ? 1 : 2} : null;
      if (simulation?.route === '/diagnostic') await readDiagnostic();
      else feedback.textContent = simulation ? 'Simulation armée pour la prochaine lecture de cette route.' : 'Simulation désactivée.';
    };
    find('[data-scenario-apply]').onclick = async () => {
      const name = find('[data-scenario]').value;
      try {
        // Cette route n’existe que dans la démonstration ; elle ne modifie que des données fictives.
        await request('/demo/scenario', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})});
        feedback.textContent = 'État fictif appliqué au prochain relevé.';
      } catch {
        feedback.textContent = 'État fictif indisponible.';
      }
    };

    function renderJournal() {
      const failing = event => event.phase === 'interruption';
      const known = new Set(signals.map(event => event.id));
      const all = [...incidents.filter(event => !known.has(event.id)), ...signals].sort((a, b) => a.id - b.id);
      const entries = all.filter(event =>
        (!method.value || event.méthode === method.value) &&
        (!route.value || event.route === route.value) &&
        (!status.value || (status.value === 'retry' && event.tentative > 1) ||
          (status.value === 'interrupt' && failing(event)) ||
          (status.value === 'incident' && event.incident) ||
          (Number.isInteger(event.HTTP) && `${Math.floor(event.HTTP / 100)}xx` === status.value)),
      );
      const seen = [...new Set([...routes, ...all.map(event => event.route)])].sort();
      if (route.options.length - 1 !== seen.length) {
        const chosen = route.value;
        route.replaceChildren(new Option('Toutes', ''), ...seen.map(value => new Option(value, value)));
        route.value = chosen;
      }
      journal.replaceChildren(...entries.toReversed().map(event => {
        const row = document.createElement('li');
        const label = event.tentative > 1 ? 'Reprise · ' : '';
        row.dataset.attention = String(failing(event) || event.tentative > 1 || event.HTTP >= 400);
        row.textContent = `${event.heure} · ${label}${event.méthode} ${event.route} · ${event.phase} ${event.HTTP ?? ''}`.trimEnd() +
          (event.durée_ms === undefined ? '' : ` · ${event.durée_ms} ms`);
        return row;
      }));
      renderActivity();
      find('[data-error-list]').replaceChildren(...errors.toReversed().map(error => {
        const row = document.createElement('li');
        row.dataset.attention = 'true';
        row.textContent = `${error.heure} · ${error.type} · ${error.module} · ${error.onglet}` + (error.nombre > 1 ? ` · ×${error.nombre}` : '');
        return row;
      }));
    }

    function renderActivity() {
      const query = find('[data-activity-search]').value.trim().toLowerCase();
      const incidentsOnly = find('[data-activity-level]').value === 'incident';
      const service = currentService?.developer;
      const entries = [
        ...signals.map(event => [event.at, event.incident, ['HTTP', event.méthode, event.route, event.HTTP ?? event.phase, event.reference].filter(Boolean).join(' · ')]),
        ...errors.map(event => [event.at, true, ['JS', event.type, event.module].join(' · ')]),
        ...(service?.signals || []).map(event => [
          Number.isFinite(service.signal_now_ms) ? serviceReadAt - (service.signal_now_ms - event.ms) : serviceReadAt,
          event.phase === 'error' || event.http >= 400,
          [event.transport.toUpperCase(), event.phase, event.endpoint || event.type, event.state, event.code].filter(Boolean).join(' · '),
        ]),
      ].sort((a, b) => b[0] - a[0]);
      find('[data-activity]').replaceChildren(...entries.filter(([, incident, label]) =>
        (!incidentsOnly || incident) && label.toLowerCase().includes(query),
      ).map(([at, incident, label]) => {
        const row = document.createElement('li');
        row.dataset.attention = String(incident);
        row.textContent = `${new Date(at).toLocaleTimeString('fr-FR')} · ${label}`;
        return row;
      }));
    }

    find('[data-activity-search]').oninput = renderActivity;
    find('[data-activity-level]').onchange = renderActivity;

    function renderOverview(latest) {
      const service = latest.service;
      const details = service?.developer;
      const age = latest.fraîcheur.updated_at.âge_s;
      const pending = latest.bandeaux?.commande;
      const examined = new Set((details?.findings || []).map(code => findingsText[code]).filter(Boolean));
      if (pending?.bandeau_visible && pending.attente_s > 30)
        examined.add('Confirmation en attente. Comparez la phase attendue avec le dernier relevé.');
      if (age > 30) examined.add(findingsText.cloud_stale);
      if (latest.fraîcheur.mqtt_updated_at.âge_s > 30) examined.add(findingsText.mqtt_stale);
      if (progressRegressed) examined.add('Progression en recul sur la même tâche. Vérifiez les rapports reçus.');
      find('[data-findings]').replaceChildren(...(examined.size ? [...examined] : ['Aucune incohérence détectée.']).map(text => {
        const row = document.createElement('li');
        row.textContent = text;
        return row;
      }));
      find('[data-summary]').replaceChildren(...[
        ['Service', service ? service.cloud_available === false ? 'Cloud indisponible' : 'relevé' : 'à relever', '[data-diagnostic]'],
        ['Données Cloud', age === null ? 'inconnues' : `${age} s`, '[data-banners]'],
        ['MQTT', details ? details.mqtt_connected ? 'connecté' : 'déconnecté' : 'inconnu', '[data-diagnostic]'],
        ['Commande', pending?.bandeau_visible ? 'en attente' : 'aucune attente', '[data-banners]'],
        ['Navigateur', `${errors.length} erreurs`, '[data-errors]'],
        ['ACE', details ? `${details.ace?.length ?? 0} module(s)` : 'à relever', '[data-diagnostic]'],
      ].map(([name, value, target]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'atelier-control';
        button.textContent = `${name} · ${value}`;
        button.onclick = () => {
          const pane = find(target);
          pane.open = true;
          pane.querySelector('summary').focus();
        };
        return button;
      }));
    }

    function renderServerSignals(rows) {
      const list = find('[data-server-signals]');
      list.replaceChildren(...(rows || []).slice(-60).toReversed().map(event => {
        const row = document.createElement('li');
        const subject = event.endpoint || [event.type, event.action].filter(Boolean).join('/');
        const result = event.http ?? (event.code === undefined || event.code === null ? '' : `code ${event.code}`);
        row.dataset.attention = String(event.phase === 'error' || event.http >= 400);
        row.textContent = [`+${event.ms} ms`, event.transport, event.phase, subject, event.state, result,
          event.duration_ms === undefined ? '' : `${event.duration_ms} ms`].filter(Boolean).join(' · ');
        return row;
      }));
    }
    for (const input of [method, status, route]) input.onchange = renderJournal;
    let baseline;

    function capture() {
      const latest = report(currentService);
      output.textContent = currentService ?
        JSON.stringify(currentService, null, 2) : '';
      output.hidden = !currentService;
      const developer = currentService?.developer;
      const print = developer?.last_stored_print;
      const selected = print?.requested_slots?.join(', ') || '—';
      const serialized = print?.serialized_mapping?.map(row => row.ams_index).join(', ') || '—';
      const observed = developer?.ace?.flatMap(box => box.observed_slot ?? []).join(', ') || '—';
      const evidence = [
        ['Nouveau projet', print?.fresh_project_reported],
        ['Fichier attendu', print?.expected_file_reported],
        ['Préparation identifiée', print?.preparation_identified],
      ].filter(([, value]) => typeof value === 'boolean')
        .map(([label, value]) => `${label} : ${value ? 'oui' : 'non'}`);
      summary.textContent = print ?
        [`Choix ACE ${selected} · Indice sérialisé ${serialized} · Emplacement actuellement engagé ${observed}`, ...evidence].join(' · ') : '';
      const finish = developer?.finish_timing;
      find('[data-finish-summary]').textContent = finish ?
        `Fin prévue : ${finish.elapsed_min ?? '—'} min écoulées · ${finish.reported_remaining_min ?? '—'} min annoncées` : '';
      renderServerSignals(developer?.signals);
      renderOverview(latest);
      find('[data-state]').textContent = JSON.stringify({
        bandeaux: latest.bandeaux, fraîcheur: latest.fraîcheur, mesures: latest.mesures,
        sections_modifiées: baseline ? Object.keys(latest).filter(key =>
          key !== 'signaux_page' && JSON.stringify(latest[key]) !== JSON.stringify(baseline[key])) : [],
      }, null, 2);
      renderJournal();
      return latest;
    }

    function renderReading() {
      const selected = readingSelector.value;
      readingSelector.replaceChildren(...[...readings].map(([tab, reading]) => new Option(reading.name, tab)));
      const last = [...readings.keys()].at(-1);
      readingSelector.value = readings.has(selected) ? selected : last ?? '';
      const reading = readings.get(readingSelector.value);
      find('[data-interface]').textContent = reading ? JSON.stringify(reading.controls, null, 2) : '';
      renderReadingAge();
    }

    function renderReadingAge() {
      if (!find('[data-controls]').open) return;
      const reading = readings.get(readingSelector.value);
      const age = reading ? Math.floor((performance.now() - reading.time) / 1000) : null;
      find('[data-reading-age]').textContent = reading
        ? `Dernier relevé : ${reading.name}, il y a ${age} s`
        : 'Quittez un onglet pour relever ses contrôles.';
    }
    readingSelector.onchange = renderReading;
    find('[data-controls]').ontoggle = renderReading;
    find('[data-refresh-state]').onclick = () => { capture(); renderReading(); };

    async function readDiagnostic() {
      const revision = generation;
      const read = ++lastRead;
      const printerKey = state.selectedPrinter;
      const stillCurrent = () => active && generation === revision && lastRead === read && printerKey === state.selectedPrinter;
      feedback.textContent = 'Lecture du diagnostic…';
      try {
        const response = await request('/diagnostic?developer=1', {printerKey, timeoutMs: 8000});
        if (stillCurrent()) {
          currentService = response;
          serviceReadAt = Date.now();
          feedback.textContent = 'Diagnostic relevé.';
        }
      } catch {
        if (stillCurrent()) feedback.textContent = 'Lecture du diagnostic interrompue. Le dernier relevé est conservé.';
      }
      if (stillCurrent() && state.currentTab === 'developer') capture();
    }

    find('[data-refresh]').onclick = readDiagnostic;
    find('[data-compare]').onclick = () => { baseline = capture(); capture(); feedback.textContent = 'Point de comparaison fixé.'; };
    find('[data-copy]').onclick = async () => {
      const captured = capture();
      const enabled = key => find(`[data-report-part="${key}"]`).checked;
      const withoutReference = ({reference, ...entry}) => entry;
      const text = JSON.stringify({
        version: captured.version, navigateur: browserFamily(),
        ...(enabled('http') ? {
          requêtes: captured.signaux_page.slice(-20).map(withoutReference),
          incidents: captured.incidents.slice(-20).map(withoutReference),
        } : {}),
        ...(enabled('browser') ? {erreurs_js: captured.erreurs_js} : {}),
        ...(enabled('status') ? {commande: captured.bandeaux?.commande, fraîcheur: captured.fraîcheur} : {}),
        ...(enabled('server') ? {
          fin_prévue: captured.service?.developer?.finish_timing ?? null,
          ace: captured.service?.developer?.ace ?? null,
          impression_mémoire: captured.service?.developer?.last_stored_print ?? null,
          mqtt: captured.service?.developer?.mqtt_connected ?? null,
        } : {}),
      }, null, 2);
      const preview = find('[data-report]');
      preview.value = text;
      preview.hidden = false;
      try {
        await navigator.clipboard.writeText(text);
        if (active) feedback.textContent = 'Rapport copié.';
      } catch {
        if (active) { preview.select(); feedback.textContent = 'Sélectionnez le rapport pour le copier.'; }
      }
    };
    panel.append(card);
    return {card, capture, renderJournal, renderReading, renderReadingAge};
  }

  function leave(tab) {
    if (tab === 'developer') {
      clearInterval(readingTimer);
      readingTimer = 0;
      return;
    }
    if (!active || !Object.hasOwn(tabDialogs, tab)) return;
    const previous = document.getElementById(`tab-${tab}`);
    if (!previous || previous.hidden) return;
    const name = document.querySelector(`#atelier-tabs [data-tab="${tab}"] span`)?.textContent.trim() || tab;
    const dialogs = Object.fromEntries([...tabDialogs[tab], ...sharedDialogs].flatMap(id => {
      const dialog = document.getElementById(id);
      return dialog ? [[id, {ouvert: dialog.open, contrôles: inventory(dialog, identifiers)}]] : [];
    }));
    // Seul le panneau encore affiché donne une mesure fidèle de la visibilité.
    readings.delete(tab);
    readings.set(tab, {name, time: performance.now(), controls: {
      contrôles: inventory(previous, identifiers), dialogues: dialogs,
    }});
  }

  function show() {
    if (!active || state.currentTab !== 'developer') return;
    unread.hidden = true;
    tools ??= makeCard();
    tools.capture();
    tools.renderReading();
    if (!readingTimer) readingTimer = setInterval(tools.renderReadingAge, 1000);
  }

  function activate(value) {
    active = value;
    if (!active && state.currentTab === 'developer') document.querySelector('#atelier-tabs [data-tab="settings"]').click();
    cancelAnimationFrame(journalFrame);
    journalFrame = 0;
    generation++;
    signals.length = 0;
    incidents.length = 0;
    readings.clear();
    currentService = null;
    lastProgress = undefined;
    progressRegressed = false;
    simulation = null;
    started = performance.now();
    unread.hidden = true;
    tabButton.hidden = tabButton.disabled = !active;
    // La grille du groupe prévoit une colonne par onglet visible ; sinon Développeur passe sous Réglages.
    const group = tabButton.closest('.atelier-nav-group');
    group.style.setProperty('--section-count', group.querySelectorAll('[data-tab]:not([hidden])').length);
    toggle.setAttribute('aria-pressed', String(active));
    if (!active) {
      tools?.card.remove();
      tools = undefined;
    }
  }

  function notify(alarm) {
    if (state.currentTab !== 'developer') {
      if (alarm) unread.hidden = false;
      return;
    }
    if (tools?.card.querySelector('[data-trace]').open && !journalFrame) {
      journalFrame = requestAnimationFrame(() => {
        journalFrame = 0;
        if (state.currentTab === 'developer') tools?.renderJournal();
      });
    }
  }

  // Les erreurs sont gardées même hors du mode : celle qui précède l’activation est souvent la cause.
  function recordError(kind, source, line) {
    const row = {...errorRow(kind, source, line), onglet: state.currentTab || '—'};
    const same = errors.find(error => error.type === row.type && error.module === row.module);
    if (same) {
      same.nombre++;
      same.heure = clock();
      same.at = Date.now();
    } else {
      errors.push({heure: clock(), at: Date.now(), nombre: 1, ...row});
      if (errors.length > 20) errors.shift();
    }
    if (active) notify(true);
  }
  addEventListener('error', event => {
    if (event.error || event.message) recordError(event.error?.name, event.filename, event.lineno);
  });
  addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const [source, line] = stackOrigin(reason?.stack);
    recordError(reason?.name, source, line);
  });

  function setMode(value) {
    activate(value);
    try { localStorage.setItem(preference, value ? '1' : '0'); } catch {}
  }
  toggle.onclick = () => setMode(!active);
  if (saved) queueMicrotask(() => activate(true));

  return {
    leave,
    show,
    observe,
    simulate(route) {
      if (!active || !isDemo || simulation?.route !== route || !simulation.remaining) return;
      simulation.remaining--;
      if (simulation.mode === '502') return Promise.resolve(new Response(null, {status: 502}));
      if (simulation.mode === 'timeout') return Promise.reject(new DOMException('Échéance simulée', 'TimeoutError'));
      return new Promise(resolve => setTimeout(resolve, 1000));
    },
    record(method, route, phase, attempt, duration, status, reference) {
      // L’envoi n’apporte rien de plus que sa réponse : une requête occupe une seule ligne.
      if (!active || phase === 'envoi') return;
      const event = {
        id: ++sequence, heure: clock(), at: Date.now(), ms: Math.round(performance.now() - started),
        méthode: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method) ? method : 'AUTRE',
        route: publicRoute(route), phase, tentative: attempt,
        durée_ms: duration, HTTP: status, reference: /^[a-f0-9]{32}$/.test(reference || '') ? reference : undefined,
      };
      event.incident = phase === 'interruption' || attempt > 1 || status >= 400;
      signals.push(event);
      if (signals.length > 200) signals.shift();
      if (event.incident) {
        incidents.push(event);
        if (incidents.length > 50) incidents.shift();
      }
      notify(event.incident && (phase === 'interruption' || attempt > 1 || status >= 500));
    },
  };
}
