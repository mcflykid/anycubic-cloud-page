/* =====================================================================
   Parrilla · Moxen
   Un panel de widgets en rejilla (de 12 columnas) donde ARRASTRAR y
   REDIMENSIONAR empuja a los demás y todo vuelve a encajar.

   · Arrastras un widget por su cabecera: sigue al puntero (se levanta y se
     inclina un pelo), aparece la rejilla y una sombra de encaje (borde punteado
     azul y sombra naranja) marca dónde va a caer. Los vecinos se apartan con un
     resorte y, al soltar, todo flota hacia arriba para no dejar huecos.
   · El tirador de la esquina cambia el tamaño en pasos de rejilla; lo que hay dentro
     se recompone con el tamaño (más barras, una línea, una lista de detalle…).
   · La paleta de la derecha: arrastras un widget nuevo al panel y crece desde su hueco.
     Si lo sueltas fuera de la rejilla (o mueves uno hasta fuera), rebota y vuelve.
   · «Guardar disposición» entrega el diseño como un objeto de datos ({ id: [x, y, ancho, alto] }, con un ✓ que se
     dibuja) y «Restaurar» lo deshace: cada widget vuela a su sitio guardado con un resorte
     (los que sobran se apagan y los que faltan vuelven creciendo).
   · Teclado: con el foco en el asa de un widget, las flechas lo mueven una casilla; con el
     foco en el tirador, las flechas lo agrandan o lo achican; Supr lo quita.

   Cómo se monta (ver index.html):
     <main data-parrilla> … <div data-caja> <svg data-rejilla> <i data-encaje> <div data-widgets> … </main>
     const p = Parrilla(document.querySelector('[data-parrilla]'), {
       columnas: 12, alto: 52, hueco: 10, filas: 8,        // la rejilla: 12 columnas, casillas de 52 px de alto, huecos de 10 y 8 filas como mínimo
       widgets: [ { id: 'ingresos', tipo: 'cifra', x: 0, y: 0, w: 4, h: 3 }, … ],   // el diseño de partida
       paleta: ['linea', 'pedidos', 'alertas'],             // los tipos que se pueden arrastrar al panel
       alGuardar: objeto => { … },  alCambiar: items => { … },
     });
     p.disposicion();  p.guarda();  p.restaura();

   Qué se personaliza:
   · TIPOS reúne los widgets de ejemplo: el nombre, el tamaño mínimo y el HTML de cada uno. Para uno
     propio, añade una entrada y escribe su contenido con @container pa en el CSS, como los demás.
   · Los colores están al inicio del CSS: --pa-azul es lo que se pulsa, --pa-rejilla el azul de las casillas y
     --pa-naranja solo la sombra del hueco. ?tema=oscuro los redefine sobre grafito.
   · El algoritmo es la compactación vertical clásica: el widget que se mueve queda fijo, los demás se
     ordenan por (y, x), suben cuanto pueden y, si chocan, bajan por debajo del que estorba.
   · Los resortes salen de --pa-muelle (movimientos) y BOTE (rebotes), curvas linear() calculadas por
     muelle(). Solo se anima transform, width, height y opacity. Sin dependencias, sin Date y con azar de
     semilla: la página y el vídeo coinciden.
   ===================================================================== */
(function () {
  'use strict';

  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const lim = (v, a, b) => Math.max(a, Math.min(b, v));
  const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const NS = 'http://www.w3.org/2000/svg';
  const clona = a => a.map(i => Object.assign({}, i));
  const escapa = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // un resorte convertido en curva CSS linear(), para lo que se mueve con CSS o con WAAPI
  function muelle(k, c) {
    if (!(window.CSS && CSS.supports && CSS.supports('animation-timing-function', 'linear(0, 1)'))) return 'cubic-bezier(.34, 1.56, .64, 1)';
    const pts = [0];
    let x = 0, v = 0, t = 0;
    while (t < 3) {
      v += (k * (1 - x) - c * v) / 240; x += v / 240; t += 1 / 240;
      pts.push(x);
      if (t > .15 && Math.abs(1 - x) < .001 && Math.abs(v) < .01) break;
    }
    const out = [];
    for (let i = 0; i <= 40; i++) out.push(pts[Math.round(i / 40 * (pts.length - 1))].toFixed(4));
    out[40] = '1';
    return 'linear(' + out.join(', ') + ')';
  }

  /* =====================================================================
     Los widgets de ejemplo: cada uno es un nombre, un tamaño mínimo y un HTML.
     Lo que cambia con el tamaño lo decide el CSS con consultas de contenedor.
     ===================================================================== */
  const serie = (semilla, n, a, b) => { const r = mulberry32(semilla); let v = (a + b) / 2; return Array.from({ length: n }, () => { v = lim(v + (r() - .46) * (b - a) * .34, a, b); return v; }); };
  const ruta = (ys, ancho, alto) => ys.map((y, i) => (i ? 'L' : 'M') + (i / (ys.length - 1) * ancho).toFixed(1) + ' ' + (alto - y / 100 * alto).toFixed(1)).join(' ');
  const CAL = (ys, ancho, alto) => { const d = ruta(ys, ancho, alto); return '<svg viewBox="0 0 ' + ancho + ' ' + alto + '" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="' + d + ' L' + ancho + ' ' + alto + ' L0 ' + alto + 'Z"/><path class="linea" d="' + d + '"/></svg>'; };

  const TIPOS = {
    cifra: { nombre: 'Ingresos', etiqueta: 'Este mes', min: [3, 2], html: () => {
      return '<div class="pa-k"><p class="pa-k-v">$ 48.920</p><p class="pa-k-d"><b>+12,4 %</b><span>vs. mes anterior</span></p>' +
        '<div class="pa-k-g">' + CAL(serie(5, 14, 24, 92), 200, 60) + '</div>' +
        '<ul class="pa-k-lista"><li><span>Suscripciones</span><b>$ 31.200</b><i style="--v:64%"></i></li><li><span>Servicios</span><b>$ 12.640</b><i style="--v:34%"></i></li><li><span>Otros</span><b>$ 5.080</b><i style="--v:14%"></i></li></ul></div>';
    } },
    barras: { nombre: 'Visitas por hora', etiqueta: 'Hoy', min: [3, 2], html: () => {
      const r = mulberry32(9), v = Array.from({ length: 24 }, (_, i) => { const dia = .5 + .5 * Math.sin((i - 5) / 24 * Math.PI * 2 - .2); return Math.round(18 + dia * 62 + r() * 18); });
      const pico = v.indexOf(Math.max.apply(null, v));
      return '<div class="pa-b-w"><p class="pa-b-top">Pico a las <b>' + String(pico).padStart(2, '0') + ':00</b> · <b>' + (v[pico] * 14 + 120).toLocaleString('es') + '</b> visitas</p>' +
        '<div class="pa-b-bars" aria-hidden="true">' + v.map((h, i) => '<i style="--h:' + h + '"' + (i === pico ? ' class="pico"' : '') + '></i>').join('') + '</div>' +
        '<div class="pa-b-eje" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>';
    } },
    anillo: { nombre: 'Conversión', etiqueta: '', min: [2, 2], html: () =>
      '<div class="pa-a"><div class="pa-a-anillo"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="pa-a-pista" cx="60" cy="60" r="50"/><circle class="pa-a-arco" cx="60" cy="60" r="50" style="--p:.68"/></svg><span class="pa-a-num">68 %</span></div>' +
      '<ul class="pa-a-leyenda"><li><i></i>Visitas<b>12.480</b></li><li><i style="--c:#9db8ff"></i>Registros<b>3.940</b></li><li><i style="--c:#c9d6f5"></i>Compras<b>1.318</b></li></ul></div>' },
    calor: { nombre: 'Actividad', etiqueta: 'Por semana', min: [3, 2], html: () =>
      '<div class="pa-c"><div class="pa-c-malla" data-malla aria-hidden="true"></div><div class="pa-c-pie" aria-hidden="true"><span>Menos</span><span class="pa-c-esc"><i style="--a:.1"></i><i style="--a:.3"></i><i style="--a:.55"></i><i style="--a:.8"></i><i style="--a:1"></i></span><span>Más</span></div></div>' },
    lista: { nombre: 'Tareas', etiqueta: '', min: [3, 2], html: () => {
      const t = [['Revisar las métricas de la semana', 1], ['Responder las solicitudes de soporte', 1], ['Actualizar la documentación', 0], ['Probar el despliegue en pruebas', 0], ['Cerrar las incidencias abiertas', 0], ['Planear la próxima iteración', 0], ['Archivar los tableros viejos', 0], ['Agendar el mantenimiento', 0]];
      return '<div class="pa-l"><ul class="pa-l-filas">' + t.map(x => '<li class="' + (x[1] ? 'is-hecha' : '') + '" role="checkbox" tabindex="0" aria-checked="' + !!x[1] + '"><span class="pa-l-check"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.8 8.4l2.8 2.8L12.2 5.4" pathLength="1"/></svg></span><span>' + x[0] + '</span></li>').join('') + '</ul>' +
        '<div class="pa-l-pie"><span class="pa-l-cuenta"></span><span class="pa-l-barra"><i></i></span></div></div>';
    } },
    linea: { nombre: 'Latencia', etiqueta: 'p95', min: [3, 2], html: () =>
      '<div class="pa-n"><p class="pa-n-v">84 ms</p><p class="pa-n-s">Última hora · 9 % más rápida</p><div class="pa-n-g">' + CAL(serie(21, 18, 30, 88), 240, 80) + '</div></div>' },
    pedidos: { nombre: 'Pedidos', etiqueta: 'Hoy', min: [2, 2], html: () => {
      const r = mulberry32(33);
      return '<div class="pa-n"><p class="pa-n-v">1.284</p><p class="pa-n-s">+86 desde ayer</p><div class="pa-n-mini" aria-hidden="true">' + Array.from({ length: 9 }, () => '<i style="--h:' + Math.round(30 + r() * 65) + '"></i>').join('') + '</div></div>';
    } },
    alertas: { nombre: 'Alertas', etiqueta: '3 activas', min: [3, 2], html: () =>
      '<ul class="pa-al"><li><i style="--c:#2f6bff"></i>Disco al 82 %<em>hace 4 min</em></li><li><i style="--c:#6f9bff"></i>Despliegue en cola<em>hace 12 min</em></li><li><i style="--c:#9db8ff"></i>Certificado vence en 9 días<em>ayer</em></li><li><i style="--c:#c4d4fb"></i>Copia de respaldo lista<em>hace 2 h</em></li></ul>' },
  };
  const PALETA_ICONOS = {
    linea: '<svg viewBox="0 0 36 30" aria-hidden="true"><path d="M3 22l7-8 6 5 8-11 9 6"/></svg>',
    pedidos: '<svg viewBox="0 0 36 30" aria-hidden="true"><path d="M6 25V16M14 25V9M22 25V13M30 25V5"/></svg>',
    alertas: '<svg viewBox="0 0 36 30" aria-hidden="true"><path d="M18 4a8 8 0 0 0-8 8v6l-3 4h22l-3-4v-6a8 8 0 0 0-8-8zM15 26h6"/></svg>',
  };
  const TAM_PALETA = { linea: [6, 3], pedidos: [3, 2], alertas: [4, 3] };
  const INICIAL = [
    { id: 'ingresos', tipo: 'cifra', x: 0, y: 0, w: 4, h: 3 },
    { id: 'visitas', tipo: 'barras', x: 4, y: 0, w: 5, h: 3 },
    { id: 'conversion', tipo: 'anillo', x: 9, y: 0, w: 3, h: 3 },
    { id: 'actividad', tipo: 'calor', x: 0, y: 3, w: 6, h: 3 },
    { id: 'tareas', tipo: 'lista', x: 6, y: 3, w: 6, h: 3 },
  ];

  /* =====================================================================
     La rejilla: choques y compactación vertical
     ===================================================================== */
  const choca = (a, b) => a.id !== b.id && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const primero = (puestos, it) => puestos.find(p => choca(it, p));
  // el widget `fijoId` se queda donde está; los demás, ordenados por (y, x), suben cuanto pueden y bajan si chocan
  function compacta(items, fijoId) {
    const orden = clona(items).sort((a, b) => a.y - b.y || a.x - b.x);
    const puestos = [], res = {};
    if (fijoId != null) { const f = orden.find(i => i.id === fijoId); if (f) { puestos.push(f); res[f.id] = f; } }
    orden.forEach(it => {
      if (it.id === fijoId) return;
      const n = Object.assign({}, it);
      while (n.y > 0 && !primero(puestos, Object.assign({}, n, { y: n.y - 1 }))) n.y--;
      let c;
      while ((c = primero(puestos, n))) n.y = c.y + c.h;
      puestos.push(n); res[n.id] = n;
    });
    return items.map(i => res[i.id]);
  }
  // la disposición que saldría si `mov` se pusiera donde dice (a partir de la base, no del estado vivo: así es reversible)
  const previa = (base, mov) => compacta(base.filter(i => i.id !== mov.id).concat([mov]), mov.id);

  /* =====================================================================
     El componente
     ===================================================================== */
  function Parrilla(raiz, opciones) {
    const o = Object.assign({ columnas: 12, alto: 52, hueco: 10, filas: 8, widgets: INICIAL, paleta: ['linea', 'pedidos', 'alertas'], alGuardar: null, alCambiar: null }, opciones);
    const $ = s => raiz.querySelector(s);
    const caja = $('[data-caja]'), vacio = $('[data-vacio]'), cont = $('[data-widgets]'), rejilla = $('[data-rejilla]'), encaje = $('[data-encaje]'), paletaEl = $('[data-paleta]'),
      codigo = $('[data-codigo]'), datosOk = $('[data-datos-ok]'), btnGuardar = $('[data-guardar]'), btnRestaurar = $('[data-restaurar]'),
      guardarTxt = $('[data-guardar-txt]'), vivo = $('[data-vivo]');
    const reduce = () => reduceMQ.matches;
    const avisa = s => { vivo.textContent = ''; vivo.textContent = s; };
    const relojes = new Set();
    const luego = (fn, ms) => { const id = setTimeout(() => { relojes.delete(id); fn(); }, ms); relojes.add(id); return id; };
    raiz.style.setProperty('--pa-muelle', muelle(190, 16));
    const BOTE = muelle(120, 8.5);                 // el rebote al soltar fuera: se pasa más y vuelve

    // un degradado compartido por las líneas
    const defs = document.createElementNS(NS, 'svg');
    defs.setAttribute('width', '0'); defs.setAttribute('height', '0'); defs.setAttribute('aria-hidden', 'true'); defs.style.position = 'absolute';
    defs.innerHTML = '<defs><linearGradient id="pa-deg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color: var(--pa-azul); stop-opacity: .28"/><stop offset="1" style="stop-color: var(--pa-azul); stop-opacity: 0"/></linearGradient></defs>';
    raiz.appendChild(defs);

    /* ── el estado ─────────────────────────────────────────────────────── */
    let contador = 0;
    const S = { items: clona(o.widgets), guardada: clona(o.widgets), els: new Map(), cols: o.columnas, colW: 60, W: 0, fila: o.alto, hueco: o.hueco, arr: null, ancho: null };
    const tipoDe = it => TIPOS[it.tipo];

    /* ── medidas de la rejilla ─────────────────────────────────────────── */
    const filas = items => Math.max(o.filas, items.reduce((m, i) => Math.max(m, i.y + i.h), 0));
    const px = { x: i => i * (S.colW + S.hueco), y: i => i * (S.fila + S.hueco), w: i => i * S.colW + (i - 1) * S.hueco, h: i => i * S.fila + (i - 1) * S.hueco };
    function mide() {
      S.W = caja.clientWidth;
      const estrecha = S.W < 640;
      const cols = estrecha ? 4 : o.columnas;
      if (cols !== S.cols) adaptaColumnas(cols);
      S.cols = cols;
      S.hueco = estrecha ? 10 : o.hueco;
      S.fila = parseFloat(getComputedStyle(raiz).getPropertyValue('--pa-fila')) || o.alto;
      S.colW = (S.W - (cols - 1) * S.hueco) / cols;
    }
    // en pantallas estrechas la rejilla es de una columna: los widgets se apilan por orden; al volver, se recupera el diseño ancho
    function adaptaColumnas(cols) {
      if (cols < o.columnas && !S.ancho) {
        S.ancho = clona(S.items);
        S.items = compacta(clona(S.items).sort((a, b) => a.y - b.y || a.x - b.x).map(i => Object.assign(i, { x: 0, w: cols })), null);
      } else if (cols >= o.columnas && S.ancho) {
        const ids = new Set(S.items.map(i => i.id));
        S.items = compacta(S.ancho.filter(i => ids.has(i.id)).concat(S.items.filter(i => !S.ancho.some(a => a.id === i.id)).map(i => Object.assign(i, { x: 0, w: Math.min(6, o.columnas) }))), null);
        S.ancho = null;
      }
    }
    function pintaRejilla(items) {
      const n = filas(items), clave = S.cols + 'x' + n + ':' + S.colW.toFixed(1) + ':' + S.fila;
      if (rejilla.__k === clave) return;
      rejilla.__k = clave;
      rejilla.textContent = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < S.cols; c++) {
        const e = document.createElementNS(NS, 'rect');
        e.setAttribute('x', px.x(c).toFixed(1)); e.setAttribute('y', px.y(r).toFixed(1)); e.setAttribute('width', S.colW.toFixed(1)); e.setAttribute('height', S.fila);
        e.setAttribute('rx', 10);
        rejilla.appendChild(e);
      }
    }
    const poner = (el, k, v) => { if (el.__c === undefined) el.__c = {}; if (el.__c[k] !== v) { el.__c[k] = v; el.style[k] = v; } };
    function lugar(el, it) {
      poner(el, 'transform', 'translate(' + px.x(it.x).toFixed(1) + 'px,' + px.y(it.y).toFixed(1) + 'px)');
      poner(el, 'width', px.w(it.w).toFixed(1) + 'px');
      poner(el, 'height', px.h(it.h).toFixed(1) + 'px');
    }
    // pone cada widget en su sitio (salvo el que se está llevando, que va con el puntero)
    function aplica(items, omite) {
      items.forEach(it => { const el = S.els.get(it.id); if (el && it.id !== omite) lugar(el, it); });
      poner(caja, 'height', px.y(filas(items)) - S.hueco + 'px');
      pintaRejilla(items);
      // las filas libres del final se ofrecen como zona para soltar un widget
      const usadas = items.reduce((m, i) => Math.max(m, i.y + i.h), 0), libres = filas(items) - usadas;
      vacio.classList.toggle('is-visible', libres >= 1 && !S.arr);
      vacio.style.transform = 'translateY(' + px.y(usadas).toFixed(1) + 'px)';
      vacio.style.height = Math.max(0, px.h(Math.max(1, libres))).toFixed(1) + 'px';
    }
    function ponEncaje(it) {
      encaje.style.transform = 'translate(' + px.x(it.x).toFixed(1) + 'px,' + px.y(it.y).toFixed(1) + 'px)';
      encaje.style.width = px.w(it.w).toFixed(1) + 'px'; encaje.style.height = px.h(it.h).toFixed(1) + 'px';
    }

    /* ── un widget: cabecera con asa, contenido y tirador ──────────────── */
    function creaWidget(it, opcion) {
      const t = tipoDe(it);
      const el = document.createElement('article');
      el.className = 'pa-w'; el.dataset.id = it.id; el.setAttribute('role', 'listitem'); el.setAttribute('aria-label', t.nombre);
      el.innerHTML =
        '<header class="pa-cab"><button class="pa-grip" type="button" aria-label="Mover ' + escapa(t.nombre) + ' (flechas)"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="4" r="1.4"/><circle cx="11" cy="4" r="1.4"/><circle cx="5" cy="8" r="1.4"/><circle cx="11" cy="8" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="11" cy="12" r="1.4"/></svg></button>' +
          '<h3>' + escapa(t.nombre) + '</h3>' + (t.etiqueta ? '<span class="pa-etiq">' + escapa(t.etiqueta) + '</span>' : '') +
          '<button class="pa-x" type="button" aria-label="Quitar ' + escapa(t.nombre) + '"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></header>' +
        '<div class="pa-cuerpo-w">' + t.html() + '</div>' +
        '<button class="pa-tirador" type="button" aria-label="Cambiar el tamaño de ' + escapa(t.nombre) + ' (flechas)"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M10 4L4 10M10 8l-2 2"/></svg></button>';
      if (it.tipo === 'calor') preparaCalor(el);
      if (it.tipo === 'lista') preparaLista(el);
      const cab = el.querySelector('.pa-cab'), tir = el.querySelector('.pa-tirador'), grip = el.querySelector('.pa-grip'), x = el.querySelector('.pa-x');
      const actual = () => S.items.find(i => i.id === it.id);
      cab.addEventListener('pointerdown', ev => { if (ev.target.closest('.pa-x') || (ev.pointerType === 'mouse' && ev.button !== 0)) return; empiezaMover(actual(), el, ev); });
      tir.addEventListener('pointerdown', ev => { if (ev.pointerType === 'mouse' && ev.button !== 0) return; empiezaTamano(actual(), el, ev); });
      x.addEventListener('click', () => quita(it.id));
      grip.addEventListener('keydown', ev => teclaMover(ev, actual()));
      tir.addEventListener('keydown', ev => teclaTamano(ev, actual()));
      el.addEventListener('keydown', ev => { if (ev.key === 'Delete' && (ev.target === grip || ev.target === tir)) { ev.preventDefault(); quita(it.id); } });
      S.els.set(it.id, el);
      cont.appendChild(el);
      if (opcion && opcion.nace && !reduce()) el.classList.add('is-nace');
      return el;
    }
    // el mapa de calor: tantas semanas como quepan, con azar de semilla
    function preparaCalor(el) {
      const malla = el.querySelector('[data-malla]'), r = mulberry32(17), N = 7 * 30;
      let h = '';
      for (let i = 0; i < N; i++) { const dia = i % 7, base = dia < 5 ? .45 : .14; h += '<i style="--a:' + lim(base * (.3 + r() * 1.1) + (i % 11 === 0 ? .25 : 0), .06, 1).toFixed(2) + '"></i>'; }
      malla.innerHTML = h;
      const celdas = Array.from(malla.children);
      let cols = 0;
      const ajusta = () => {
        const c = lim(Math.floor((malla.clientWidth + 4) / 21), 4, 30);
        if (c === cols) return;
        cols = c; malla.style.gridTemplateColumns = 'repeat(' + c + ', minmax(0, 1fr))';
        celdas.forEach((e, i) => { e.hidden = i >= c * 7; });
      };
      new ResizeObserver(ajusta).observe(malla); ajusta();
    }
    // las tareas se marcan con un toque; la barra cuenta las hechas
    function preparaLista(el) {
      const filas = Array.from(el.querySelectorAll('.pa-l-filas li')), cuenta = el.querySelector('.pa-l-cuenta'), barra = el.querySelector('.pa-l-barra i');
      const pinta = () => { const n = filas.filter(f => f.classList.contains('is-hecha')).length; cuenta.textContent = n + ' de ' + filas.length; barra.style.setProperty('--v', (n / filas.length * 100) + '%'); };
      const alterna = f => { f.classList.toggle('is-hecha'); f.setAttribute('aria-checked', String(f.classList.contains('is-hecha'))); pinta(); };
      filas.forEach(f => { f.addEventListener('click', () => alterna(f)); f.addEventListener('keydown', ev => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); alterna(f); } }); });
      pinta();
    }

    /* ── arrastrar un widget por su cabecera ───────────────────────────── */
    function empiezaMover(it, el, ev) {
      if (S.arr || !it) return;
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      S.arr = { tipo: 'mover', id: it.id, el, base: clona(S.items), it, dx: ev.clientX - r.left, dy: ev.clientY - r.top, ult: null, fuera: false, pid: ev.pointerId, avisoFuera: false };
      el.classList.add('is-mueve'); caja.classList.add('is-arrastra'); encaje.classList.add('is-vivo'); raiz.classList.add('is-arrastrando');
      ponEncaje(it);
      aplica(S.items);
      window.addEventListener('pointermove', muevePuntero); window.addEventListener('pointerup', sueltaPuntero); window.addEventListener('pointercancel', sueltaPuntero);
    }
    // ¿está el puntero dentro de la zona de la rejilla (con un margen)?
    function dentroDe(ev) {
      const cr = caja.getBoundingClientRect();
      return ev.clientX >= cr.left - 36 && ev.clientX <= cr.right + 36 && ev.clientY >= cr.top - 40 && ev.clientY <= cr.bottom + 70;
    }
    function celda(ev, a, w) {
      const cr = caja.getBoundingClientRect();
      const x = ev.clientX - cr.left - a.dx, y = ev.clientY - cr.top - a.dy;
      return { px: x, py: y, gx: lim(Math.round(x / (S.colW + S.hueco)), 0, S.cols - w), gy: Math.max(0, Math.round(y / (S.fila + S.hueco))) };
    }
    function muevePuntero(ev) {
      const a = S.arr;
      if (!a || ev.pointerId !== a.pid && a.pid != null && a.tipo !== 'nuevo') return;
      if (a.tipo === 'tam') return mueveTamano(ev);
      if (a.tipo === 'nuevo') return muevePaleta(ev);
      const c = celda(ev, a, a.it.w);
      poner(a.el, 'transform', 'translate(' + c.px.toFixed(1) + 'px,' + c.py.toFixed(1) + 'px)');
      if (!dentroDe(ev)) {
        // fuera de la rejilla: todo vuelve a como estaba y el hueco se apaga
        if (!a.fuera) { a.fuera = true; a.ult = null; encaje.classList.remove('is-vivo'); aplica(a.base, a.id); S.items = clona(a.base); }
        return;
      }
      if (a.fuera) { a.fuera = false; encaje.classList.add('is-vivo'); }
      if (a.ult && a.ult.x === c.gx && a.ult.y === c.gy) return;
      a.ult = { x: c.gx, y: c.gy };
      const lay = previa(a.base, Object.assign({}, a.it, { x: c.gx, y: c.gy }));
      S.items = lay;
      aplica(lay, a.id);
      ponEncaje(lay.find(i => i.id === a.id));
    }
    function sueltaPuntero(ev) {
      const a = S.arr;
      if (!a) return;
      window.removeEventListener('pointermove', muevePuntero); window.removeEventListener('pointerup', sueltaPuntero); window.removeEventListener('pointercancel', sueltaPuntero);
      raiz.classList.remove('is-arrastrando');
      if (a.tipo === 'tam') return sueltaTamano(a);
      if (a.tipo === 'nuevo') return sueltaPaleta(a, ev);
      S.arr = null;
      const el = a.el;
      let final;
      if (a.fuera || ev.type === 'pointercancel') {
        // soltado fuera de límites: rebota a su sitio con un resorte más suelto
        final = clona(a.base);
        el.classList.add('is-rebota');
        el.style.setProperty('--pa-muelle', BOTE);
        luego(() => { el.classList.remove('is-rebota'); el.style.removeProperty('--pa-muelle'); }, 1100);
        avisa(tipoDe(a.it).nombre + ' vuelve a su sitio.');
      } else {
        // al soltar, todo flota hacia arriba para no dejar huecos
        final = compacta(S.items, null);
        const f = final.find(i => i.id === a.id);
        avisa(tipoDe(a.it).nombre + ' colocado en la columna ' + (f.x + 1) + ', fila ' + (f.y + 1) + '.');
      }
      S.items = final;
      el.classList.remove('is-mueve'); caja.classList.remove('is-arrastra'); encaje.classList.remove('is-vivo');
      aplica(final);
      cambio();
    }

    /* ── redimensionar con el tirador de la esquina ────────────────────── */
    function empiezaTamano(it, el, ev) {
      if (S.arr || !it) return;
      ev.preventDefault();
      S.arr = { tipo: 'tam', id: it.id, el, it, base: clona(S.items), x0: ev.clientX, y0: ev.clientY, w0: el.offsetWidth, h0: el.offsetHeight, ult: null, pid: ev.pointerId };
      el.classList.add('is-tamano'); caja.classList.add('is-arrastra'); encaje.classList.add('is-vivo'); raiz.classList.add('is-arrastrando');
      ponEncaje(it);
      window.addEventListener('pointermove', muevePuntero); window.addEventListener('pointerup', sueltaPuntero); window.addEventListener('pointercancel', sueltaPuntero);
    }
    function mueveTamano(ev) {
      const a = S.arr, t = tipoDe(a.it);
      const pw = Math.min(S.W - px.x(a.it.x), Math.max(S.colW, a.w0 + ev.clientX - a.x0)), ph = Math.max(S.fila, a.h0 + ev.clientY - a.y0);
      // el widget sigue al puntero sin saltos...
      poner(a.el, 'width', pw.toFixed(1) + 'px'); poner(a.el, 'height', ph.toFixed(1) + 'px');
      // ...y el hueco y los vecinos, en pasos de rejilla
      const gw = S.cols < 12 ? S.cols : lim(Math.round((pw + S.hueco) / (S.colW + S.hueco)), t.min[0], S.cols - a.it.x);
      const gh = Math.max(t.min[1], Math.round((ph + S.hueco) / (S.fila + S.hueco)));
      if (a.ult && a.ult.w === gw && a.ult.h === gh) return;
      a.ult = { w: gw, h: gh };
      const lay = previa(a.base, Object.assign({}, a.it, { w: gw, h: gh }));
      S.items = lay;
      aplica(lay, a.id);
      ponEncaje(lay.find(i => i.id === a.id));
    }
    function sueltaTamano(a) {
      S.arr = null;
      const final = compacta(S.items, null), f = final.find(i => i.id === a.id);
      S.items = final;
      a.el.classList.remove('is-tamano'); caja.classList.remove('is-arrastra'); encaje.classList.remove('is-vivo');
      aplica(final);
      avisa(tipoDe(a.it).nombre + ': ' + f.w + ' columnas por ' + f.h + ' filas.');
      cambio();
    }

    /* ── arrastrar un widget nuevo desde la paleta ─────────────────────── */
    o.paleta.forEach(tipo => {
      const t = TIPOS[tipo], tam = TAM_PALETA[tipo] || [4, 3];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pa-pal'; b.dataset.tipo = tipo;
      b.setAttribute('aria-label', 'Agregar ' + t.nombre + ' al panel');
      b.innerHTML = '<span class="pa-pal-mini">' + (PALETA_ICONOS[tipo] || '') + '</span><span><b>' + escapa(t.nombre) + '</b><small>' + tam[0] + ' × ' + tam[1] + ' casillas</small></span>';
      b.addEventListener('pointerdown', ev => { if (ev.pointerType === 'mouse' && ev.button !== 0) return; empiezaPaleta(tipo, b, ev); });
      b.addEventListener('click', ev => { if (ev.detail === 0) agrega(tipo, null); });           // con teclado: Intro o Espacio lo agrega
      paletaEl.appendChild(b);
    });
    function empiezaPaleta(tipo, boton, ev) {
      if (S.arr) return;
      ev.preventDefault();
      const tam = TAM_PALETA[tipo] || [4, 3], it = { id: '__nuevo', tipo, x: 0, y: 0, w: tam[0], h: tam[1] };
      const g = creaWidget(it);
      cont.removeChild(g); S.els.delete(it.id);
      document.body.appendChild(g);
      g.classList.add('is-mueve'); g.style.cssText += ';position:fixed;left:0;top:0;z-index:60;pointer-events:none;width:' + px.w(it.w).toFixed(0) + 'px;height:' + px.h(it.h).toFixed(0) + 'px';
      g.style.transition = 'box-shadow .35s, scale .35s, rotate .35s, opacity .3s';
      S.arr = { tipo: 'nuevo', g, it, boton, base: clona(S.items), dx: Math.min(60, px.w(it.w) / 2), dy: 24, ult: null, dentro: false, pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, movido: false };
      g.style.transform = 'translate(' + (ev.clientX - S.arr.dx) + 'px,' + (ev.clientY - S.arr.dy) + 'px)';
      caja.classList.add('is-arrastra'); raiz.classList.add('is-arrastrando');
      window.addEventListener('pointermove', muevePuntero); window.addEventListener('pointerup', sueltaPuntero); window.addEventListener('pointercancel', sueltaPuntero);
    }
    function muevePaleta(ev) {
      const a = S.arr;
      if (Math.abs(ev.clientX - a.x0) + Math.abs(ev.clientY - a.y0) > 6) a.movido = true;
      a.g.style.transform = 'translate(' + (ev.clientX - a.dx).toFixed(1) + 'px,' + (ev.clientY - a.dy).toFixed(1) + 'px)';
      if (!dentroDe(ev)) {
        if (a.dentro) { a.dentro = false; a.ult = null; encaje.classList.remove('is-vivo'); S.items = clona(a.base); aplica(S.items); }
        return;
      }
      a.dentro = true; encaje.classList.add('is-vivo');
      const c = celda(ev, a, a.it.w);
      if (a.ult && a.ult.x === c.gx && a.ult.y === c.gy) return;
      a.ult = { x: c.gx, y: c.gy };
      const lay = previa(a.base, Object.assign({}, a.it, { x: c.gx, y: c.gy }));
      aplica(lay.filter(i => i.id !== '__nuevo'));
      poner(caja, 'height', px.y(filas(lay)) - S.hueco + 'px');
      ponEncaje(lay.find(i => i.id === '__nuevo'));
      a.lay = lay;
    }
    function sueltaPaleta(a, ev) {
      S.arr = null;
      caja.classList.remove('is-arrastra'); encaje.classList.remove('is-vivo');
      if (a.dentro && a.lay && ev.type !== 'pointercancel') {
        // dentro: nace en su hueco y crece
        const nuevo = a.lay.find(i => i.id === '__nuevo');
        agrega(a.it.tipo, nuevo, a.lay.filter(i => i.id !== '__nuevo'));
        a.g.remove();
        return;
      }
      // un toque sin arrastre agrega el widget al final del panel
      if (!a.movido && ev.type !== 'pointercancel') { a.g.remove(); agrega(a.it.tipo, null); return; }
      // fuera de la rejilla: vuelve a su sitio en la paleta con un rebote y se desvanece
      S.items = clona(a.base); aplica(S.items);
      const dest = a.boton.getBoundingClientRect(), g = a.g;
      const actual = g.getBoundingClientRect();
      if (reduce() || !g.animate) { g.remove(); return; }
      g.style.transform = 'none';
      const an = g.animate([
        { transform: 'translate(' + actual.left + 'px,' + actual.top + 'px)', opacity: 1 },
        { transform: 'translate(' + (dest.left + dest.width / 2 - actual.width / 2) + 'px,' + (dest.top + dest.height / 2 - 24) + 'px) scale(.6)', opacity: 0 }], { duration: 750, easing: BOTE, fill: 'forwards' });
      an.onfinish = () => g.remove();
      luego(() => { if (g.isConnected) g.remove(); }, 1200);
      avisa('Suelta el widget dentro de la rejilla para agregarlo.');
    }
    // agrega un widget al panel (desde la paleta, el teclado o Restaurar)
    function agrega(tipo, lugarDado, layoutPrevio) {
      contador++;
      const t = TIPOS[tipo], tam = TAM_PALETA[tipo] || [4, 3];
      let id = tipo; while (S.items.some(i => i.id === id) || S.els.has(id)) id = tipo + '-' + (++contador);
      const it = lugarDado ? { id, tipo, x: lugarDado.x, y: lugarDado.y, w: lugarDado.w, h: lugarDado.h } : { id, tipo, x: 0, y: 9999, w: tam[0], h: tam[1] };
      const base = layoutPrevio || S.items;
      const lay = compacta(base.concat([it]), null);
      const f = lay.find(i => i.id === id);
      const el = creaWidget(f, { nace: true });
      lugar(el, f);
      S.items = lay;
      aplica(lay);
      avisa(t.nombre + ' agregado al panel.');
      cambio();
    }
    function quita(id) {
      const el = S.els.get(id), it = S.items.find(i => i.id === id);
      if (!el || !it) return;
      el.classList.add('is-sale');
      S.items = compacta(S.items.filter(i => i.id !== id), null);
      S.els.delete(id);
      luego(() => el.remove(), reduce() ? 0 : 350);
      aplica(S.items);
      avisa(tipoDe(it).nombre + ' quitado.');
      cambio();
    }

    /* ── teclado: flechas para mover y para cambiar de tamaño ──────────── */
    function teclaMover(ev, it) {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      if (!d || !it) return;
      ev.preventDefault();
      const n = Object.assign({}, it, { x: lim(it.x + d[0], 0, S.cols - it.w), y: Math.max(0, it.y + d[1]) });
      const lay = previa(S.items, n), f = lay.find(i => i.id === it.id);        // con el teclado el widget se queda donde se dejó (sin flotar)
      S.items = lay; aplica(lay);
      avisa(tipoDe(it).nombre + ' en la columna ' + (f.x + 1) + ', fila ' + (f.y + 1) + '.');
      cambio();
    }
    function teclaTamano(ev, it) {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      if (!d || !it) return;
      ev.preventDefault();
      const t = tipoDe(it);
      const n = Object.assign({}, it, { w: lim(it.w + d[0], t.min[0], S.cols - it.x), h: Math.max(t.min[1], it.h + d[1]) });
      const lay = previa(S.items, n), f = lay.find(i => i.id === it.id);        // con el teclado el widget se queda donde se dejó (sin flotar)
      S.items = lay; aplica(lay);
      avisa(t.nombre + ': ' + f.w + ' columnas por ' + f.h + ' filas.');
      cambio();
    }

    /* ── guardar y restaurar ───────────────────────────────────────────── */
    const objeto = items => ({ columnas: o.columnas, widgets: items.map(i => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h })) });
    function pintaCodigo(items, anima) {
      const lineas = ['{', '  columnas: <span class="n">' + o.columnas + '</span>,', '  widgets: {'].concat(
        items.slice().sort((a, b) => a.y - b.y || a.x - b.x).map(i => '    <span class="k">' + escapa(i.id) + '</span>: [<span class="n">' + i.x + '</span>, <span class="n">' + i.y + '</span>, <span class="n">' + i.w + '</span>, <span class="n">' + i.h + '</span>],'),
        ['  }', '}']);
      codigo.innerHTML = lineas.map((l, k) => '<span class="l" style="--k:' + k + '">' + l + '</span>').join('');
      if (anima && !reduce()) { codigo.classList.remove('is-guarda'); void codigo.offsetWidth; codigo.classList.add('is-guarda'); }
    }
    function guarda() {
      S.guardada = clona(S.items);
      pintaCodigo(S.guardada, true);
      btnGuardar.classList.add('is-ok'); guardarTxt.textContent = 'Guardada';
      datosOk.classList.remove('is-visto'); void datosOk.offsetWidth; datosOk.classList.add('is-visto');
      luego(() => datosOk.classList.remove('is-visto'), 4200);                // el ✓ de «Guardada» se apaga solo
      luego(() => { btnGuardar.classList.remove('is-ok'); guardarTxt.textContent = 'Guardar disposición'; }, 1900);
      avisa('Disposición guardada: ' + S.guardada.length + ' widgets.');
      if (typeof o.alGuardar === 'function') o.alGuardar(objeto(S.guardada));
    }
    // restaurar: cada widget vuela a su sitio guardado; los que sobran se apagan y los que faltan vuelven creciendo
    function restaura() {
      const meta = clona(S.guardada), ids = new Set(meta.map(i => i.id));
      S.items.forEach(i => { if (!ids.has(i.id)) { const el = S.els.get(i.id); if (el) { el.classList.add('is-sale'); luego(() => el.remove(), reduce() ? 0 : 350); S.els.delete(i.id); } } });
      meta.forEach(i => { if (!S.els.has(i.id)) { const el = creaWidget(i, { nace: true }); lugar(el, i); } });
      if (S.cols < o.columnas) { S.ancho = null; }
      S.items = S.cols < o.columnas ? compacta(clona(meta).sort((a, b) => a.y - b.y || a.x - b.x).map(i => Object.assign(i, { x: 0, w: S.cols })), null) : meta;
      aplica(S.items);
      avisa('Disposición restaurada.');
      cambio();
    }
    btnGuardar.addEventListener('click', guarda);
    btnRestaurar.addEventListener('click', restaura);
    function cambio() { if (typeof o.alCambiar === 'function') o.alCambiar(clona(S.items)); }

    /* ── al empezar ────────────────────────────────────────────────────── */
    mide();
    if (S.cols < o.columnas) adaptaColumnas(S.cols);
    S.items.forEach(i => { const el = creaWidget(i); lugar(el, i); });
    Array.from(cont.children).forEach((el, k) => el.style.setProperty('--k', k));
    aplica(S.items);
    pintaCodigo(S.guardada, false);
    new ResizeObserver(() => {
      if (S.arr) return;
      const antes = S.colW;
      mide();
      if (Math.abs(antes - S.colW) < .5) return;
      cont.classList.add('is-mide'); aplica(S.items); void cont.offsetWidth;          // al cambiar el ancho de la ventana no hay vuelos: todo se recoloca de golpe
      requestAnimationFrame(() => requestAnimationFrame(() => cont.classList.remove('is-mide')));
    }).observe(caja);
    if (!reduce()) { raiz.classList.add('is-entra'); luego(() => raiz.classList.remove('is-entra'), 1700); }

    return {
      disposicion: () => objeto(S.items),
      guarda, restaura,
      agrega: tipo => agrega(tipo, null),
      quita,
    };
  }

  window.Parrilla = Parrilla;
})();
