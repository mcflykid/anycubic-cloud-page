import {
  $,
  fmt,
  formatText,
  locale,
  node,
  set,
  timeZone,
  tr,
} from './workshop-ui.mjs?v=7bd3fdd4bc0d';

/** Crée un élément SVG avec attributs ; son texte reste littéral pour ne pas interpréter de balisage cloud. */
function chartElement(tag, attributes, text) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes || {})) e.setAttribute(key, String(value));
  if (text != null) e.textContent = text;
  return e;
}
/** Trace mesures et consignes sur hours heures ; espace les points et interrompt la courbe aux lacunes. */
function renderTemperatureChart(key, rows, hours) {
  const host = $(`chart-${key}`),
    valid = rows.filter((r) => Number.isFinite(r[key]));
  host.replaceChildren();
  set(`temperature-${key}-current`, valid.length ? fmt(valid.at(-1)[key], ' °C') : '—');
  if (!valid.length) {
    host.append(node('p', tr('En attente des premiers relevés.'), 'muted'));
    return;
  }
  const W = 360,
    H = 180,
    L = 38,
    R = 12,
    T = 12,
    B = 28,
    colors = { nozzle: 'light-dark(#b85c35,#ffa980)', bed: 'light-dark(#3372a5,#83c4ff)', ace: 'light-dark(#42765c,#88d5ae)' },
    color = colors[key],
    end = Date.now() / 1000,
    start = end - hours * 3600,
    top = Math.max(
      { nozzle: 250, bed: 100, ace: 80 }[key],
      Math.ceil(
        Math.max(...valid.map((r) => r[key]), ...rows.map((r) => r[key + '_target'] || 0)) / 25,
      ) * 25,
    ),
    x = (t) => L + ((t - start) / (end - start)) * (W - L - R),
    y = (v) => T + (1 - v / top) * (H - T - B),
    svg = chartElement('svg', {
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': formatText(
        'Température {0}, {1} relevés. Dernière valeur : {2} degrés Celsius.',
        key === 'nozzle' ? tr('de la buse') : key === 'bed' ? tr('du plateau') : tr('de l’ACE'),
        valid.length,
        valid.at(-1)[key],
      ),
    });
  for (const value of [0, top / 2, top]) {
    svg.append(
      chartElement('line', {
        x1: L,
        x2: W - R,
        y1: y(value),
        y2: y(value),
        stroke: 'var(--line)',
        'stroke-width': 1,
      }),
      chartElement(
        'text',
        { x: L - 7, y: y(value) + 4, 'text-anchor': 'end', class: 'chart-axis' },
        String(Math.round(value)),
      ),
    );
  }
  const hour = (t) =>
    new Date(t * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone });
  svg.append(
    chartElement('text', { x: L, y: H - 6, class: 'chart-axis' }, hour(start)),
    chartElement(
      'text',
      { x: W - R, y: H - 6, 'text-anchor': 'end', class: 'chart-axis' },
      hour(end),
    ),
  );
  for (const target of [true, false]) {
    const field = key + (target ? '_target' : ''),
      points = rows.filter((r) => Number.isFinite(r[field]));
    let previous = null,
      path = '';
    /* Limiter les points évite de surcharger le SVG tout en conservant le dernier relevé. */ const stride =
      Math.max(1, Math.floor(points.length / 600));
    points
      .filter((r, i) => i % stride === 0 || i === points.length - 1)
      .forEach((r) => {
        path +=
          (previous && r.time - previous.time <= Math.max(120, stride * 20) ? 'L' : 'M') +
          x(r.time).toFixed(2) +
          ' ' +
          y(r[field]).toFixed(2) +
          ' ';
        previous = r;
      });
    if (path)
      svg.append(
        chartElement('path', {
          d: path,
          fill: 'none',
          stroke: target ? '#8f98a5' : color,
          'stroke-width': target ? 1.5 : 2,
          'stroke-dasharray': target ? '5 4' : 'none',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
  }
  const last = valid.at(-1);
  svg.append(chartElement('circle', { cx: x(last.time), cy: y(last[key]), r: 3, fill: color }));
  host.append(svg);
  const tip = node('div', null, 'chart-tooltip');
  tip.hidden = true;
  host.append(tip);
  svg.onpointermove = (e) => {
    const box = svg.getBoundingClientRect(),
      stamp =
        start + ((((e.clientX - box.left) / box.width) * W - L) / (W - L - R)) * (end - start);
    const row = valid.reduce(
      (best, r) => (Math.abs(r.time - stamp) < Math.abs(best.time - stamp) ? r : best),
      valid[0],
    );
    tip.textContent = `${hour(row.time)} · ${row[key]} °C`;
    tip.hidden = false;
  };
  svg.onpointerleave = () => {
    tip.hidden = true;
  };
  const legend = node('p', null, 'chart-legend');
  legend.append(node('span', tr('━ Mesurée')));
  if (rows.some((r) => r[key + '_target'] != null)) legend.append(node('span', '┄ Cible'));
  host.append(legend);
}
/** Réutilise la requête de la cible sélectionnée sans empiler les lectures de courbes. */
export function createTemperatureLoader(request) {
  let temperaturePending = false;
  return async function loadTemperatures() {
    if (temperaturePending) return;
    temperaturePending = true;
    try {
      const hours = Number($('temperature-hours').value),
        data = await request(`/temperatures?hours=${hours}`);
      for (const key of ['nozzle', 'bed', 'ace']) renderTemperatureChart(key, data.readings, hours);
      set(
        'temperature-note',
        tr(
          'Relevés reçus depuis l’activation, conservés 24 heures. Survolez une courbe pour lire une mesure.',
        ),
      );
    } catch (e) {
      set('temperature-note', e.message);
    } finally {
      temperaturePending = false;
    }
  };
}
