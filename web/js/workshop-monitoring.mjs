import { signalChange, $, fmt, formatText, locale, node, tr } from './workshop-ui.mjs?v=a063449a11af';

const NS = 'http://www.w3.org/2000/svg';
/** Décrit les unités et la provenance des neuf séries rendues dans le panneau local. */
const SERIES = {
  requests: {
    label: 'Requêtes par seconde',
    unit: 'req/s',
    description: 'Débit moyen calculé sur la fenêtre HTTP, raccourcie pendant les premières minutes.',
    value: (data) => {
      const uptime = number(data.system?.uptime_seconds),
        window = number(data.http?.window_seconds),
        requests = number(data.http?.requests_window),
        divisor = uptime == null || window == null ? null : Math.min(uptime, window);
      return divisor > 0 && requests != null ? requests / divisor : null;
    },
    /** Calcule le débit entre deux compteurs cumulatifs plutôt que de tracer leur total. */
    history: (rows) => {
      let previous = null;
      return rows.map((row) => {
        const current = { uptime: number(row.uptime_seconds), total: number(row.requests_total) };
        let value = null;
        if (
          previous && current.uptime != null && previous.uptime != null &&
          current.total != null && previous.total != null &&
          current.uptime > previous.uptime && current.total >= previous.total
        ) value = (current.total - previous.total) / (current.uptime - previous.uptime);
        previous = current;
        return { at: row.at, value };
      });
    },
  },
  latency: {
    label: 'Latence HTTP moyenne', unit: 'ms',
    description: 'Durée moyenne des requêtes observées dans la fenêtre HTTP.',
    value: (data) => number(data.http?.average_latency_ms),
    history: (rows) => rows.map((row) => ({ at: row.at, value: number(row.average_latency_ms) })),
  },
  errors: {
    label: 'Erreurs HTTP', unit: '',
    description: 'Nombre cumulé de réponses HTTP en erreur depuis le démarrage du serveur.',
    value: (data) => number(data.http?.errors_total),
    history: (rows) => rows.map((row) => ({ at: row.at, value: number(row.errors_total) })),
  },
  cpu: {
    label: 'CPU du processus', unit: '%',
    description: 'Temps CPU du processus entre deux relevés; peut dépasser 100 % sur plusieurs cœurs.',
    value: (data) => number(data.system?.cpu_percent),
    history: (rows) => rows.map((row) => ({ at: row.at, value: number(row.cpu_percent) })),
  },
  memory: {
    label: 'Mémoire locale', unit: 'Mio',
    description: 'Usage courant du conteneur si disponible, sinon RSS courant du processus; jamais le maximum historique.',
    value: (data) => toMiB(data.system?.memory_bytes),
    history: (rows) => rows.map((row) => ({ at: row.at, value: toMiB(row.memory_bytes) })),
  },
  disk: {
    label: 'Espace libre des données', unit: 'Gio',
    description: 'Espace libre actuellement disponible sur le volume de données de l’application.',
    value: (data) => toGiB(data.system?.data_free_bytes),
    history: (rows) => rows.map((row) => ({ at: row.at, value: toGiB(row.data_free_bytes) })),
  },
  uptime: {
    label: 'Durée de fonctionnement', unit: '',
    description: 'Temps écoulé depuis le démarrage de ce processus serveur.',
    value: (data) => number(data.system?.uptime_seconds),
    history: (rows) => rows.map((row) => ({ at: row.at, value: number(row.uptime_seconds) })),
  },
  cloud: {
    label: 'Cloud Anycubic', unit: '',
    description: 'État de session déjà connu du moteur; cette vue ne déclenche aucune requête Cloud.',
    value: (data) => stateLabel(data.services?.cloud),
    history: () => [],
  },
  mqtt: {
    label: 'Connexion MQTT', unit: '',
    description: 'État MQTT déjà connu du moteur; cette vue ne démarre aucune connexion.',
    value: (data) => stateLabel(data.services?.mqtt),
    history: () => [],
  },
};

/** Accepte seulement une mesure numérique finie et non négative. */
function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Convertit des octets en mébioctets, ou garde la mesure absente. */
function toMiB(value) {
  const bytes = number(value);
  return bytes == null ? null : bytes / (1024 ** 2);
}

/** Convertit des octets en gibioctets, ou garde la mesure absente. */
function toGiB(value) {
  const bytes = number(value);
  return bytes == null ? null : bytes / (1024 ** 3);
}

/** Traduit un état de service connu sans inventer d’état lorsqu’il manque. */
function stateLabel(value) {
  return ({
    connected: 'Connecté',
    disconnected: 'Déconnecté',
    unavailable: 'Indisponible',
    unknown: 'Inconnu',
  })[value] || tr('Inconnu');
}

/** Formate une durée en jours, heures et minutes à partir de secondes valides. */
function duration(value) {
  const seconds = number(value);
  if (seconds == null) return '—';
  const days = Math.floor(seconds / 86400),
    hours = Math.floor((seconds % 86400) / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    parts = [];
  if (days) parts.push(formatText('{0} j', fmt(days)));
  if (hours || days) parts.push(formatText('{0} h', fmt(hours)));
  parts.push(formatText('{0} min', fmt(minutes)));
  return parts.join(' ');
}

/** Formate une valeur numérique, un état, une durée ou une mesure absente. */
function displayValue(key, value) {
  if (key === 'uptime') return duration(value);
  if (typeof value === 'string') return tr(value);
  return value == null ? '—' : SERIES[key].unit ? `${fmt(value)} ${tr(SERIES[key].unit)}` : fmt(value);
}

/** Crée un nœud SVG avec attributs et texte, sans interpréter de HTML. */
function svgElement(tag, attributes = {}, text = null) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text != null) element.textContent = text;
  return element;
}

/** Utilise l’horodatage d’un point et retombe sur son index si celui-ci est invalide. */
function pointTime(point, index) {
  const parsed = typeof point.at === 'string' ? Date.parse(point.at) : NaN;
  return Number.isFinite(parsed) ? parsed : index;
}

/** Formate l’heure locale d’un point ou signale un horaire inconnu. */
function pointTimeLabel(point) {
  const parsed = typeof point.at === 'string' ? Date.parse(point.at) : NaN;
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : tr('heure inconnue');
}

/** Transforme uniquement l’historique fourni en points de la métrique choisie. */
function chartPoints(key, data) {
  const rows = Array.isArray(data.history) ? data.history.slice(-120) : [];
  return SERIES[key].history(rows)
    .map((point, index) => ({ ...point, x: pointTime(point, index) }))
}

/** Dessine les échantillons présents; une mesure absente coupe la courbe en segments. */
function makeChart(points, key, large, sampleCount) {
  const valid = points.filter((point) => point.value != null);
  if (!valid.length) return null;
  const width = large ? 640 : 220,
    height = large ? 220 : 52,
    padding = large ? { left: 52, right: 16, top: 18, bottom: 32 } : { left: 3, right: 3, top: 4, bottom: 4 },
    values = valid.map((point) => point.value),
    min = Math.min(...values),
    max = Math.max(...values),
    spread = max - min || Math.max(Math.abs(max) * 0.1, 1),
    low = min - (max === min ? spread / 2 : spread * 0.08),
    high = max + (max === min ? spread / 2 : spread * 0.08),
    innerWidth = width - padding.left - padding.right,
    innerHeight = height - padding.top - padding.bottom,
    x = (index) => padding.left + (points.length < 2 ? innerWidth / 2 : index / (points.length - 1) * innerWidth),
    y = (value) => padding.top + (1 - (value - low) / (high - low)) * innerHeight,
    svg = svgElement('svg', {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': `${tr(SERIES[key].label)} · ${formatText('minimum {0}, maximum {1} {2}', fmt(min), fmt(max), SERIES[key].unit)}`,
      'data-monitor-chart': '',
      'data-sample-count': sampleCount,
      class: large ? 'monitor-chart monitor-chart-large' : 'monitor-sparkline',
    });
  if (large) {
    for (const value of [low, (low + high) / 2, high]) {
      const py = y(value);
      svg.append(
        svgElement('line', { x1: padding.left, x2: width - padding.right, y1: py, y2: py, class: 'monitor-chart-gridline' }),
        svgElement('text', { x: padding.left - 7, y: py + 4, 'text-anchor': 'end', class: 'monitor-chart-axis' }, fmt(value)),
      );
    }
    svg.append(
      svgElement('text', { x: padding.left, y: height - 7, class: 'monitor-chart-axis' }, pointTimeLabel(points[0])),
      svgElement('text', { x: width - padding.right, y: height - 7, 'text-anchor': 'end', class: 'monitor-chart-axis' }, pointTimeLabel(points.at(-1))),
    );
  }
  let path = '', segmentOpen = false, lastIndex = -1;
  points.forEach((point, index) => {
    if (point.value == null) {
      segmentOpen = false;
      return;
    }
    path += `${segmentOpen ? 'L' : 'M'}${x(index).toFixed(1)} ${y(point.value).toFixed(1)} `;
    segmentOpen = true;
    lastIndex = index;
  });
  svg.append(svgElement('path', { d: path, class: 'monitor-chart-line' }));
  svg.append(svgElement('circle', { cx: x(lastIndex), cy: y(points[lastIndex].value), r: large ? 4 : 2.5, class: 'monitor-chart-point' }));
  return { svg, min, max };
}

/** Réutilise la carte existante afin de préserver son nœud, son focus et ses événements. */
function ensureCard(host, key, onOpen) {
  let button = host.querySelector(`[data-monitor-key="${key}"]`);
  if (button) return button;
  button = node('button');
  button.type = 'button';
  button.className = 'monitor-card';
  button.dataset.monitorKey = key;
  button.append(
    node('span', tr(SERIES[key].label), 'monitor-card-label'),
    node('strong', '—', 'monitor-card-value'),
    node('span', '', 'monitor-card-context'),
  );
  const graph = node('span', null, 'monitor-card-graph');
  button.append(graph);
  button.setAttribute('aria-haspopup', 'dialog');
  button.onclick = () => onOpen(key, button);
  host.append(button);
  return button;
}

/** Met à jour une carte et son graphique à partir des seules valeurs reçues. */
function updateCard(button, key, data) {
  const value = SERIES[key].value(data);
  const current = button.querySelector('.monitor-card-value');
  const label = displayValue(key, value);
  if (current.textContent !== label) {
    const hasPreviousMeasure = current.textContent !== '—';
    current.textContent = label;
    if (hasPreviousMeasure && label !== '—') signalChange(current);
  }
  const context = button.querySelector('.monitor-card-context');
  context.textContent = key === 'requests'
    ? formatText('{0} requêtes sur {1} s', fmt(data.http?.requests_window), fmt(Math.min(number(data.http?.window_seconds) ?? 0, number(data.system?.uptime_seconds) ?? 0)))
    : key === 'latency'
      ? formatText('{0} requêtes dans la fenêtre', fmt(data.http?.requests_window))
      : key === 'errors'
        ? formatText('{0} erreurs sur {1} s', fmt(data.http?.errors_window), fmt(data.http?.window_seconds))
        : ['cloud', 'mqtt'].includes(key)
          ? formatText('Imprimantes : {0} / {1} en ligne', fmt(data.services?.printers?.online), fmt(data.services?.printers?.monitored))
          : tr('Mesure locale');
  const host = button.querySelector('.monitor-card-graph'), points = chartPoints(key, data).slice(-24), chart = makeChart(points, key, false, points.length);
  host.replaceChildren(...(chart ? [chart.svg] : []));
  button.setAttribute('aria-label', formatText('{0} : {1}. Ouvrir le détail.', tr(SERIES[key].label), displayValue(key, value)));
}

/** Prépare une seule fois la boîte de dialogue accessible et ses contrôles de fenêtre. */
function setupDialog(dialog, select, onWindow) {
  if (!dialog.dataset.monitorReady) {
    dialog.classList.add('monitor-detail');
    const top = node('div', null, 'monitor-detail-top'), heading = node('h2'), close = node('button', tr('Fermer'), 'dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', tr('Fermer le détail de la métrique'));
    close.onclick = () => dialog.close();
    top.append(heading, close);
    const current = node('p', null, 'monitor-detail-value'), description = node('p', null, 'monitor-detail-description');
    const printers = node('p', null, 'monitor-detail-printers'), windowButtons = node('div', null, 'monitor-detail-windows');
    for (const count of [120, 30]) {
      const button = node('button', formatText('Derniers {0} relevés', fmt(count)));
      button.type = 'button';
      button.dataset.monitorSamples = String(count);
      button.onclick = () => onWindow(count);
      windowButtons.append(button);
    }
    const chartHost = node('div', null, 'monitor-detail-chart'), range = node('p', null, 'monitor-detail-range');
    dialog.replaceChildren(top, current, description, printers, windowButtons, chartHost, range);
    dialog.dataset.monitorReady = 'true';
    dialog._monitorNodes = { heading, current, description, printers, windowButtons, chartHost, range };
  }
  if (select && !select.dataset.monitorReady) {
    select.onchange = () => onWindow(Number(select.value));
    select.dataset.monitorReady = 'true';
  }
  return dialog._monitorNodes;
}

/** Lie les cartes locales au point de lecture protégé; l’appelant décide quand le panneau est visible. */
export function createMonitoring(request) {
  let pending = false, paused = false, selected = null, samples = 120, lastData = null;
  const grid = $('monitor-grid'), state = $('monitor-state'), dialog = $('monitor-detail'), windowSelect = $('monitor-window'), pauseButton = $('monitor-pause');
  const detail = setupDialog(dialog, windowSelect, (count) => {
    samples = count === 30 ? 30 : 120;
    if (windowSelect) windowSelect.value = String(samples);
    if (detailData()) updateDetail();
  });

  /** Renvoie les données du détail seulement après un choix et un relevé. */
  function detailData() { return selected && lastData; }

  /** La fenêtre s’ouvre depuis la carte activée et garde le focus natif du dialogue. */
  function selectCard(key, button) {
    selected = key;
    updateDetail();
    if (dialog.open) return;
    const origin = button.getBoundingClientRect();
    dialog.removeAttribute('data-card-origin');
    dialog.showModal();
    const target = dialog.getBoundingClientRect();
    dialog.style.setProperty('--monitor-origin-x', `${origin.x + origin.width / 2 - target.x - target.width / 2}px`);
    dialog.style.setProperty('--monitor-origin-y', `${origin.y + origin.height / 2 - target.y - target.height / 2}px`);
    dialog.dataset.cardOrigin = '';
  }

  /** Rafraîchit le détail, ses états accessibles et un graphique basé sur l’historique réel. */
  function updateDetail() {
    if (!selected || !lastData) return;
    const metric = SERIES[selected], value = metric.value(lastData), points = chartPoints(selected, lastData).slice(-samples), chart = makeChart(points, selected, true, points.length);
    detail.heading.textContent = tr(metric.label);
    detail.current.textContent = formatText('Valeur actuelle : {0}', displayValue(selected, value));
    detail.description.textContent = lastData.data_mode === 'demo'
      ? tr('Valeurs fictives pour démonstration; elles ne décrivent pas le Mac, le serveur ou une imprimante.')
      : tr(metric.description);
    const printers = lastData.services?.printers || {};
    detail.printers.textContent = formatText('Imprimantes suivies : {0} · en ligne : {1} · hors ligne : {2} · inconnues : {3}', fmt(printers.monitored), fmt(printers.online), fmt(printers.offline), fmt(printers.unknown));
    detail.printers.hidden = !['cloud', 'mqtt'].includes(selected);
    detail.windowButtons.querySelectorAll('[data-monitor-samples]').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.monitorSamples) === samples));
    });
    if (windowSelect) windowSelect.value = String(samples);
    detail.chartHost.replaceChildren();
    if (chart) {
      detail.chartHost.append(chart.svg);
      detail.range.textContent = formatText('Minimum : {0} · maximum : {1} · unité : {2} · source : {3}', displayValue(selected, chart.min), displayValue(selected, chart.max), metric.unit || tr('état'), tr(lastData.data_mode === 'demo' ? 'démonstration' : 'métrique locale'));
    } else {
      detail.chartHost.append(node('p', tr('Aucun historique disponible.'), 'muted'));
      detail.range.textContent = tr('Cette métrique est un état courant et son historique n’est pas fourni.');
    }
  }

  /** Suspend les chargements demandés par le minuteur parent ou les relance à la reprise. */
  function setPaused(value) {
    paused = value;
    if (pauseButton) {
      pauseButton.setAttribute('aria-pressed', String(paused));
      pauseButton.textContent = tr(paused ? 'Reprendre les mesures' : 'Suspendre les mesures');
    }
    if (!paused) void loadMonitoring();
  }

  if (pauseButton && !pauseButton.dataset.monitorReady) {
    pauseButton.onclick = () => setPaused(!paused);
    pauseButton.dataset.monitorReady = 'true';
  }

  /** Charge un relevé local sur demande, sans créer de minuteur ni de connexion MQTT. */
  async function loadMonitoring() {
    if (paused || pending) return;
    pending = true;
    try {
      const data = await request('/monitoring');
      if (!data || !data.system || !data.http || !['live_local', 'demo'].includes(data.data_mode)) throw new Error('local-metrics-unavailable');
      lastData = data;
      for (const key of Object.keys(SERIES)) updateCard(ensureCard(grid, key, selectCard), key, data);
      state.textContent = data.data_mode === 'demo'
        ? tr('Données fictives de démonstration.')
        : formatText('Données locales · relevé à {0}', data.collected_at ? new Date(data.collected_at).toLocaleTimeString(locale) : tr('heure inconnue'));
      if (dialog.open) updateDetail();
    } catch {
      state.textContent = tr('La supervision locale est temporairement indisponible.');
    } finally {
      pending = false;
    }
  }

  return loadMonitoring;
}
