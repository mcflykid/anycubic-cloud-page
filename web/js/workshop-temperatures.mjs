import {
  $,
  fmt,
  formatText,
  locale,
  node,
  set,
  timeZone,
  tr,
} from './workshop-ui.mjs';

/** Crée un élément SVG avec attributs ; son texte reste littéral pour ne pas interpréter de balisage cloud. */
function chartElement(tag, attributes, text) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes || {})) e.setAttribute(key, String(value));
  if (text != null) e.textContent = text;
  return e;
}
const temperatures = {
  nozzle: [250, 'light-dark(#b85c35,#ffa980)'],
  bed: [100, 'light-dark(#3372a5,#83c4ff)'],
  ace: [80, 'light-dark(#42765c,#88d5ae)'],
};

const hour = (t) =>
  new Date(t * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone });

/** Trace les mesures et les consignes éventuelles en interrompant les séries aux lacunes. */
function renderChart(host, current, title, rows, hours, key, unit, minimumTop, color) {
  const valid = rows.filter((r) => Number.isFinite(r[key])),
    last = valid.at(-1);
  host.replaceChildren();
  current.textContent = last ? `${fmt(last[key], unit)} · ${hour(last.time)}` : '—';
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
    end = Date.now() / 1000,
    start = end - hours * 3600,
    top = Math.max(
      minimumTop,
      Math.ceil(
        Math.max(...valid.map((r) => r[key]), ...rows.map((r) => r[key + '_target'] || 0)) / 25,
      ) * 25,
    ),
    x = (t) => L + ((t - start) / (end - start)) * (W - L - R),
    y = (v) => T + (1 - v / top) * (H - T - B),
    svg = chartElement('svg', {
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': `${title} · ${current.textContent}`,
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
  svg.append(
    chartElement('text', { x: L, y: H - 6, class: 'chart-axis' }, hour(start)),
    chartElement(
      'text',
      { x: W - R, y: H - 6, 'text-anchor': 'end', class: 'chart-axis' },
      hour(end),
    ),
  );
  for (const target of [true, false]) {
    const field = key + (target ? '_target' : '');
    let previous = null,
      path = '';
    const stride = Math.max(1, Math.floor(rows.length / 600)),
      lastPoint = rows.findLast((r) => Number.isFinite(r[field]));
    rows.forEach((r, i) => {
      if (!Number.isFinite(r[field])) {
        previous = null;
        return;
      }
      const connected = previous && r.time - previous.time <= (hours > 24 ? 7200 : 120) && previous.material === r.material;
      if (!connected || i % stride === 0 || r === lastPoint)
        path += `${connected ? 'L' : 'M'}${x(r.time).toFixed(2)} ${y(r[field]).toFixed(2)} `;
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
    const source = row.source === 'mqtt' ? tr('Source : MQTT') : row.source === 'cloud' ? tr('Source : Cloud') : row.source === 'mixed' ? tr('Sources : Cloud et MQTT') : '';
    tip.textContent = `${hour(row.time)} · ${fmt(row[key], unit)}${source ? ' · ' + source : ''}`;
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

/** Garde l’identité du boîtier au-dessus de ses courbes, y compris pour les anciens relevés. */
function aceChartName(boxes, box) {
  const model = boxes.find((entry) => String(entry.box_id) === box)?.model;
  const number = Number(box) + 1;
  if (!model) return `ACE ${number}`;
  return boxes.filter((entry) => entry.model === model).length > 1 ? `${model} · ${number}` : model;
}

/** Regroupe humidité et emplacements par identifiant pour éviter de mélanger les séries de deux ACE. */
function renderAceCharts(rows, hours, boxes) {
  const humidity = $('chart-humidity'), other = $('statistics-other-ace'), filament = $('chart-filament');
  const primary = String(boxes[0]?.box_id ?? 0);
  const slots = new Map(), humidBoxes = new Set();
  for (const row of rows) {
    for (const [box, reading] of Object.entries(row.ace_boxes)) {
      if (Number.isFinite(reading.humidity)) humidBoxes.add(box);
      for (const [slot, spool] of Object.entries(reading.slots)) {
        if (!Number.isFinite(spool.remaining)) continue;
        if (!slots.has(box)) slots.set(box, new Set());
        slots.get(box).add(slot);
      }
    }
  }
  for (const host of [humidity, other, filament]) host.replaceChildren();
  const empty = () => node('p', tr('En attente des premiers relevés.'), 'muted');
  const ordered = (values) => [...values].sort((a, b) => Number(a) - Number(b));

  function group(host, box) {
    const section = node('section'), charts = node('div', null, 'temperature-charts');
    section.append(node('h4', aceChartName(boxes, box), 'ace-chart-group-name'), charts);
    host.append(section);
    return charts;
  }

  function chart(host, box, slot) {
    const isHumidity = slot === undefined;
    const title = isHumidity ? tr('Humidité') : formatText('Emplacement {0}', slot);
    const card = node('article', null, 'temperature-card'),
      heading = node('div', null, 'temperature-card-title'),
      current = node('strong'),
      plot = node('div', null, 'temperature-plot');
    heading.append(node('h4', title), current);
    card.append(heading, plot);
    host.append(card);
    const points = rows.map(({time, ace_boxes}) => {
      const reading = ace_boxes[box], spool = reading?.slots[slot];
      return { time, value: isHumidity ? reading?.humidity : spool?.remaining, material: spool?.material };
    });
    renderChart(plot, current, title, points, hours, 'value', ' %', 100,
      isHumidity ? temperatures.bed[1] : temperatures.ace[1]);
  }

  if (humidBoxes.delete(primary)) chart(humidity, primary);
  else humidity.append(empty());
  for (const box of ordered(humidBoxes)) chart(group(other, box), box);
  other.hidden = !humidBoxes.size;
  for (const box of ordered(slots.keys())) {
    const charts = group(filament, box);
    for (const slot of ordered(slots.get(box))) chart(charts, box, slot);
  }
  if (!slots.size) filament.append(empty());
}

/** Lie courbes, modèles de boîtiers et export à la cible et à la période des requêtes. */
export function createTemperatureLoader(request, getPrinter = () => '', getHardware = () => null) {
  let sequence = 0;
  const exportButton = $('temperature-export');
  if (exportButton) exportButton.onclick = async () => {
    exportButton.disabled = true;
    const hours = Number($('temperature-hours').value), printer = getPrinter();
    const sameContext = () => !!printer && printer === getPrinter()
      && hours === Number($('temperature-hours').value)
      && $('printer-selector').value === printer;
    const cancelled = () => set('temperature-export-state', tr('Export annulé : la période ou l’imprimante a changé.'));
    try {
      if (!sameContext()) { cancelled(); return; }
      const data = await request(`/temperatures?hours=${hours}&format=csv`);
      if (!sameContext()) { cancelled(); return; }
      const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = 'historique-temperatures.csv';
      link.click();
      URL.revokeObjectURL(url);
      set('temperature-export-state', tr('Export CSV téléchargé pour la période affichée.'));
    } catch (e) {
      if (sameContext()) set('temperature-export-state', e.message);
      else cancelled();
    } finally {
      exportButton.disabled = false;
    }
  };
  return async function loadTemperatures() {
    const current = ++sequence;
    try {
      const hours = Number($('temperature-hours').value),
        data = await request(`/temperatures?hours=${hours}`);
      if (current !== sequence) return;
      for (const [key, [top, color]] of Object.entries(temperatures)) {
        const plot = $(`chart-${key}`),
          title = plot.previousElementSibling.querySelector('h4').textContent;
        renderChart(plot, $(`temperature-${key}-current`), title, data.readings, hours, key, ' °C', top, color);
      }
      const hardware = getHardware();
      const boxes = hardware?.boxes || [];
      set('statistics-printer-name', hardware?.name || hardware?.machine_name || tr('Imprimante'));
      set('statistics-ace-name', boxes.length ? aceChartName(boxes, String(boxes[0].box_id ?? 0)) : tr('ACE'));
      renderAceCharts(data.readings.filter((row) => row.ace_boxes), hours, boxes);
      set(
        'temperature-note',
        tr(
        hours > 24
          ? 'Relevés reçus depuis l’activation, points sur 24 heures et moyennes horaires sur 30 jours. Survolez une courbe pour lire une mesure.'
          : 'Relevés reçus depuis l’activation, conservés 24 heures. Survolez une courbe pour lire une mesure.',
        ),
      );
    } catch (e) {
      if (current === sequence) set('temperature-note', e.message);
    }
  };
}
