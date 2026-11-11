/* =====================================================================
   Instrumental · Moxen
   Un tablero negro con nueve medidores de un servicio, cada uno con su
   propia forma de mostrar el dato: una línea que corre (peticiones), un
   histograma que respira (latencia), una tira de calor (errores), un dial
   de aguja (CPU), barras apiladas (memoria), un reloj de arena de datos
   (cola), un anillo de aciertos (caché), dos ondas espejadas (red) y una
   barra por tramos (disco). Las señales son sintéticas: sumas de senos con
   periodos que no se repiten, así que el panel "vive" sin servidor y se
   ve igual en la página y en el vídeo.

   Al hacer clic (o Intro) en una celda, el detalle CRECE desde ella con un
   resorte —un clip-path que parte del rectángulo de la celda y llega al
   bloque de 2 × 2 que la contiene— y entra escalonado: lecturas (actual,
   promedio, mínimo, máximo y percentil 95), un selector de rango (5 min ·
   1 h · 1 día) que hace morfar la serie, y un UMBRAL que se arrastra (o
   se mueve con ↑ ↓). Cuando la señal lo cruza, la celda late en naranja,
   el tramo que se pasa se pinta de naranja, el estado del tablero cambia
   y el resto de celdas baja de brillo. Esc o × lo cierran.

   Cómo se monta (ver index.html):
     <main data-instrumental> … nueve <button class="in-celda" data-m="…"> … </main>
     const t = Instrumental(document.querySelector('[data-instrumental]'), {
       semilla: 7,        // semilla del azar: las señales de ejemplo salen siempre iguales
       velocidad: 2.5,    // segundos simulados por segundo real
       alCambiar: ({ metrica, umbral, alerta }) => { … },
     });
     t.abre('latencia');  t.cierra();  t.rango('1h');  t.umbral(150);

   Qué se personaliza:
   · Las métricas: el arreglo METRICAS (más abajo) trae nombre, unidad,
     eje, valor base, amplitud y umbral de cada una. Con datos reales,
     reemplaza senal(m, s, pmin) por tu lectura (segundos → valor) y
     serie() por tu histórico.
   · Los colores están al inicio del CSS: --in-tinta (trazos y texto),
     --in-nar (el punto naranja) y --in-celda (superficie). ?tema=claro
     los redefine; el JS los lee de ahí.
   · Se anima con requestAnimationFrame y resortes; sin Date, y el azar
     usa semilla (mulberry32).
   ===================================================================== */
(function () {
  'use strict';

  /* ── resortes: el mismo solver de la familia Moxen ───────────────── */
  const resorte = (x, k, c) => ({ x, v: 0, meta: x, k, c });
  function avanza(r, h) { r.v += (r.k * (r.meta - r.x) - r.c * r.v) * h; r.x += r.v * h; }
  const reposo = r => Math.abs(r.v) < .002 && Math.abs(r.meta - r.x) < .0006;
  const entre = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const TAU = Math.PI * 2;

  // un resorte convertido en curva CSS linear(), para lo que se mueve con CSS (la píldora del rango)
  function muelle(k, c) {
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

  // azar con semilla
  function mulberry32(s) {
    return () => {
      s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // 1284.5 → «1.284,5»  (con coma decimal y punto de miles)
  function num(v, dec) {
    const [e, d] = Math.abs(v).toFixed(dec).split('.');
    return (v < 0 && +Math.abs(v).toFixed(dec) ? '−' : '') + e.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? ',' + d : '');
  }

  /* =====================================================================
     Las métricas y la señal sintética
     eje: el rango del gráfico grande y del umbral · vista: el rango que
     usa la línea pequeña · bajo: la alerta salta al quedar POR DEBAJO.
     ===================================================================== */
  const METRICAS = [
    { id: 'peticiones', nombre: 'Peticiones por segundo', desc: 'Solicitudes que entran al servicio, de todas las rutas.', unidad: 'req/s', dec: 0, eje: [400, 2000], vista: [820, 1760], base: 1290, amp: 330, umbral: 1750, paso: 10 },
    { id: 'latencia', nombre: 'Latencia p95', desc: 'Tiempo en que responde el 95 % de las solicitudes.', unidad: 'ms', dec: 0, eje: [0, 200], base: 86, amp: 30, umbral: 150, paso: 2 },
    { id: 'errores', nombre: 'Tasa de errores', desc: 'Respuestas con fallo del servidor o tiempo agotado.', unidad: '%', dec: 2, eje: [0, 2], base: .3, amp: .2, pk: 1.5, pico: 87, umbral: 1.2, paso: .05 },
    { id: 'cpu', nombre: 'Uso de CPU', desc: 'Carga media de las tres réplicas.', unidad: '%', dec: 0, eje: [0, 100], base: 46, amp: 20, umbral: 85, paso: 1 },
    { id: 'memoria', nombre: 'Memoria en uso', desc: 'Aplicación, caché y búferes sumados.', unidad: 'GB', dec: 1, eje: [0, 12], base: 6.4, amp: 1.5, umbral: 10, paso: .1 },
    { id: 'cola', nombre: 'Cola de trabajos', desc: 'Tareas esperando a que un trabajador quede libre.', unidad: 'en espera', dec: 0, eje: [0, 400], base: 214, amp: 78, umbral: 320, paso: 5 },
    { id: 'cache', nombre: 'Aciertos de caché', desc: 'Lecturas que se resuelven sin ir a la base de datos.', unidad: '%', dec: 1, eje: [80, 100], base: 96.2, amp: 1.5, umbral: 92, paso: .2, bajo: true },
    { id: 'red', nombre: 'Tráfico de red', desc: 'Datos que entran y salen del servicio.', unidad: 'MB/s', dec: 0, eje: [0, 80], base: 38, amp: 13, umbral: 65, paso: 1 },
    { id: 'disco', nombre: 'Disco ocupado', desc: 'Espacio usado del volumen de datos.', unidad: '% usado', dec: 0, eje: [0, 100], base: 68, amp: 4, umbral: 90, paso: 1 },
  ];
  // periodos (s) de los senos y cuánto pesa cada uno: los cortos dan el temblor, los largos la deriva
  const PER = [5.3, 11.7, 29, 83, 251, 760, 2300, 9200, 31000];
  const PESO = [.10, .14, .22, .30, .34, .30, .26, .30, .36];
  const STD = Math.sqrt(PESO.reduce((a, w) => a + w * w, 0) / 2);

  // el valor de la métrica en el segundo simulado s; pmin descarta los senos más rápidos que el muestreo
  function senal(m, s, pmin, fase) {
    const ph = fase || m.ph;
    let r = 0, w2 = 0;
    for (let k = 0; k < PER.length; k++) {
      if (pmin && PER[k] < pmin) continue;
      r += PESO[k] * Math.sin(TAU * s / PER[k] + ph[k]);
      w2 += PESO[k] * PESO[k];
    }
    if (pmin && w2) r *= Math.min(2.2, STD / Math.sqrt(w2 / 2));
    let p = 0;
    if (m.pk) {
      // los picos se espacian en los rangos largos para que sigan viéndose entre muestras
      const pc = !pmin || m.pico >= pmin ? m.pico : m.pico * Math.ceil(pmin / m.pico * 1.2);
      p = Math.pow(Math.max(0, Math.sin(TAU * s / pc + ph[0] * 2)), 10) * m.pk;
    }
    return entre(m.base + m.amp * (r + p), m.eje[0], m.eje[1]);
  }
  const RANGOS = { '5m': 300, '1h': 3600, '1d': 86400 };
  const ETIQ = {
    '5m': ['−5 min', '−4', '−3', '−2', '−1', 'ahora'],
    '1h': ['−60 min', '−48', '−36', '−24', '−12', 'ahora'],
    '1d': ['−24 h', '−19 h', '−14 h', '−10 h', '−5 h', 'ahora'],
  };
  const NS = 120;                                   // puntos de la serie del detalle
  function serie(m, R, T, n, desp, sal) {
    const paso = R / (n - 1), pmin = paso * 4.5, out = sal || new Array(n);
    for (let i = 0; i < n; i++) out[i] = senal(m, T - (desp || 0) - R + i * paso, pmin);
    return out;
  }
  const a = (c, al) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + al + ')';
  const mezcla = (p, q, u) => [lerp(p[0], q[0], u), lerp(p[1], q[1], u), lerp(p[2], q[2], u)].map(Math.round);
  function rr(ctx, x, y, w, h, r) {                 // rectángulo redondeado sin depender de ctx.roundRect
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function traza(ctx, xs, ys) {                     // curva suave por los puntos medios
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < xs.length - 1; i++) ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
    ctx.lineTo(xs[xs.length - 1], ys[ys.length - 1]);
  }
  const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", monospace';

  function Instrumental(raiz, opciones) {
    const o = Object.assign({ semilla: 7, velocidad: 2.5, alCambiar: null }, opciones);
    const $ = (s, r) => (r || raiz).querySelector(s);
    const $$ = (s, r) => Array.from((r || raiz).querySelectorAll(s));
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const movilMQ = matchMedia('(max-width: 860px)');
    const rnd = mulberry32(o.semilla);
    METRICAS.forEach(m => {
      if (m.ph) return;
      m.ph = PER.map(() => rnd() * TAU);
      m.ph2 = PER.map(() => rnd() * TAU);
      m.umbral0 = m.umbral; m.tocado = false; m.alerta = false;
    });
    const MET = {}; METRICAS.forEach(m => { MET[m.id] = m; });
    document.documentElement.style.setProperty('--in-spring', muelle(260, 22));

    /* ── colores: los lee de las variables CSS, para el tema claro ─── */
    const C = {};
    let patron = null;
    function leeColores() {
      const cs = getComputedStyle(raiz);
      const hex = n => { let h = cs.getPropertyValue(n).trim().replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0); };
      C.tinta = hex('--in-tinta'); C.nar = hex('--in-nar'); C.celda = hex('--in-celda');
      C.fria = mezcla(C.celda, C.tinta, .14); C.media = mezcla(C.celda, C.tinta, .58);
      patron = null;
    }
    const tin = al => a(C.tinta, al), nar = al => a(C.nar, al), cel = al => a(C.celda, al);

    /* ── el reloj: segundos simulados ────────────────────────────────── */
    const T0 = 3600 + o.semilla * 91;
    let T = T0, inicio = 0, previo = 0, resto = 0, raf = 0, ult = 0;
    const PASO = 1 / 120;

    /* =====================================================================
       Las celdas: cada una dibuja su dato con su propia forma
       ===================================================================== */
    const celdas = $$('.in-celda').map((el, i) => {
      const m = MET[el.dataset.m];
      el.style.setProperty('--k', i);
      return { m, el, i, cv: $('canvas', el), ctx: $('canvas', el).getContext('2d'), valEl: $('[data-valor]', el), w: 0, h: 0, dpr: 1, entra: resorte(0, 30, 10.4), retardo: .35 + i * .085, vivo: false, oculta: false, txt: '', x: {} };
    });
    const celdaDe = id => celdas.find(c => c.m.id === id);

    function mideCelda(c) {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.cv.clientWidth, h = c.cv.clientHeight;
      if (!w || !h) return;
      c.w = w; c.h = h; c.dpr = dpr;
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      if (c.cv.width !== W || c.cv.height !== H) { c.cv.width = W; c.cv.height = H; }
    }
    const lienzoListo = c => { c.ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0); c.ctx.clearRect(0, 0, c.w, c.h); return c.ctx; };
    const texto = (ctx, s, x, y, tam, col, alin) => { ctx.font = '400 ' + tam + 'px ' + MONO; ctx.fillStyle = col; ctx.textAlign = alin || 'left'; ctx.fillText(s, x, y); };

    /* ── 1 · peticiones: una línea que corre, con su cabeza naranja ─── */
    function dLinea(c, T, e) {
      const ctx = lienzoListo(c), { w, h, m } = c, N = 72, dt = 1.1, [lo, hi] = m.vista, t = 8, b = 6, W = w - 10;
      ctx.strokeStyle = tin(.07); ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) { const y = Math.round(t + (h - t - b) * i / 3) + .5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      const xs = [], ys = [];
      for (let i = 0; i < N; i++) { xs.push(W * i / (N - 1)); ys.push(t + (h - t - b) * (1 - (senal(m, T - (N - 1 - i) * dt) - lo) / (hi - lo))); }
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W * e + 3, h); ctx.clip();
      const g = ctx.createLinearGradient(0, t, 0, h); g.addColorStop(0, tin(.26)); g.addColorStop(1, tin(0));
      ctx.beginPath(); traza(ctx, xs, ys); ctx.lineTo(W, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); traza(ctx, xs, ys); ctx.strokeStyle = tin(.95); ctx.lineWidth = 1.7; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
      // la cabeza: punto naranja con un anillo que respira
      const hx = W * e, k = Math.min(N - 1, e * (N - 1)), i0 = Math.floor(k), hy = lerp(ys[i0], ys[Math.min(N - 1, i0 + 1)], k - i0), ph = (T * .5) % 1;
      ctx.beginPath(); ctx.arc(hx, hy, 3.4 + ph * 6, 0, TAU); ctx.strokeStyle = nar(.55 * (1 - ph) * e); ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy, 3.6, 0, TAU); ctx.fillStyle = nar(e); ctx.fill();
    }

    /* ── 2 · latencia: un histograma que respira ─────────────────────── */
    function dLatencia(c, T, e) {
      const ctx = lienzoListo(c), { w, h, m } = c, v = senal(m, T), nb = 30, x0 = 2, ww = w - 4, base = h - 17;
      const mu = Math.log(v * .46), sg = .46, xmax = v * 1.95;
      const pdf = x => Math.exp(-Math.pow(Math.log(x) - mu, 2) / (2 * sg * sg)) / x;
      const maxp = pdf(Math.exp(mu - sg * sg)), paso = ww / nb, bw = Math.max(3, paso - 3);
      for (let i = 0; i < nb; i++) {
        const x = (i + .5) / nb * xmax, ph = pdf(x) / maxp, resp = 1 + .13 * Math.sin(T * 1.7 + i * .55) + .05 * Math.sin(T * 3.1 - i * 1.3);
        const ei = entre(e * 1.7 - i / nb * .7, 0, 1), alto = Math.max(1.5, (base - 5) * ph * resp * ei);
        ctx.beginPath(); rr(ctx, x0 + i * paso + 1.5, base - alto, bw, alto, 2);
        ctx.fillStyle = x > v ? tin(.3) : tin(.55 + .4 * ph); ctx.fill();
      }
      ctx.fillStyle = tin(.18); ctx.fillRect(0, base + 3, w, 1);
      const px = x0 + v / xmax * ww;
      ctx.strokeStyle = nar(.9 * e); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(px, 6); ctx.lineTo(px, base + 3); ctx.stroke();
      ctx.fillStyle = nar(e); ctx.beginPath(); ctx.arc(px, base + 3, 3.2, 0, TAU); ctx.fill();
      texto(ctx, 'p95', px, h - 3, 10, a(C.nar, .95 * e), 'center');
      texto(ctx, '0', x0, h - 3, 10, tin(.5), 'left');
    }

    /* ── 3 · errores: una tira de calor que se desplaza ──────────────── */
    function dCalor(c, T, e) {
      const ctx = lienzoListo(c), { w, h, m } = c, filas = 3, cols = 34, x0 = 30, pitch = (w - x0) / cols, gap = 2.2, alto = (h - 20) / filas, paso = 2;
      const fr = (T / paso) % 1, base = Math.floor(T / paso);
      const fac = [1, .55, .3], et = ['4xx', '5xx', 'tmo'];
      ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, w - x0, h); ctx.clip();
      for (let r = 0; r < filas; r++) {
        for (let k = 0; k <= cols; k++) {
          const s = (base - (cols - k)) * paso, v = senal(m, s + r * 173, 0, r ? m.ph2 : m.ph) * fac[r], t = entre(v / .95, 0, 1);
          const sc = entre(e * 1.7 - k / cols * .7, 0, 1);
          if (sc <= 0) continue;
          const col = t < .42 ? mezcla(C.fria, C.media, t / .42) : mezcla(C.media, C.nar, (t - .42) / .58);
          const x = x0 + (k - fr) * pitch, y = r * alto + 3, cw = pitch - gap, ch = alto - gap;
          ctx.beginPath(); rr(ctx, x + cw * (1 - sc) / 2, y + ch * (1 - sc) / 2, cw * sc, ch * sc, 2.6); ctx.fillStyle = a(col, 1); ctx.fill();
        }
      }
      ctx.restore();
      for (let r = 0; r < filas; r++) texto(ctx, et[r], 0, r * alto + 3 + alto / 2 + 3, 10, tin(.55), 'left');
      texto(ctx, 'hace ' + (cols * paso) + ' s', x0, h - 3, 10, tin(.5), 'left');
      texto(ctx, 'ahora', w, h - 3, 10, tin(.5), 'right');
    }

    /* ── 4 · CPU: un dial de aguja con resorte ───────────────────────── */
    function dDial(c, T, e) {
      const ctx = lienzoListo(c), { w, h, m } = c;
      const x = c.x, v = senal(m, T);
      if (!x.ag) x.ag = resorte(0, 70, 7.2);
      x.ag.meta = e > .35 ? (v - m.eje[0]) / (m.eje[1] - m.eje[0]) : 0;
      const cx = w / 2, cy = h - 12, r = Math.min(w / 2 - 20, h - 24), A0 = Math.PI * 1.07, A1 = Math.PI * 1.93, ang = u => A0 + (A1 - A0) * u;
      // marcas: cortas cada 2 %, largas cada 10 %
      for (let i = 0; i <= 50; i++) {
        const u = i / 50, an = ang(u), mayor = i % 5 === 0, r1 = r, r0 = r - (mayor ? 11 : 6);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(an) * r0, cy + Math.sin(an) * r0); ctx.lineTo(cx + Math.cos(an) * r1, cy + Math.sin(an) * r1);
        ctx.strokeStyle = tin(u <= x.ag.x ? (mayor ? .9 : .6) : (mayor ? .35 : .18)); ctx.lineWidth = mayor ? 1.8 : 1.2; ctx.lineCap = 'round'; ctx.stroke();
      }
      // la zona de peligro, en naranja, y el arco de lectura
      const ru = r - 19, u85 = (m.umbral0 - m.eje[0]) / (m.eje[1] - m.eje[0]);
      ctx.lineCap = 'round'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(cx, cy, ru, ang(u85), ang(1)); ctx.strokeStyle = nar(.85 * e); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, ru, ang(0), ang(Math.max(.002, x.ag.x))); ctx.strokeStyle = tin(.28); ctx.stroke();
      // la aguja
      const an = ang(entre(x.ag.x, -.04, 1.04)), L = ru - 6;
      ctx.beginPath(); ctx.moveTo(cx - Math.cos(an) * 9, cy - Math.sin(an) * 9); ctx.lineTo(cx + Math.cos(an) * L, cy + Math.sin(an) * L);
      ctx.strokeStyle = tin(.96); ctx.lineWidth = 2.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + Math.cos(an) * L, cy + Math.sin(an) * L, 3.3, 0, TAU); ctx.fillStyle = nar(1); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 6, 0, TAU); ctx.fillStyle = cel(1); ctx.fill(); ctx.strokeStyle = tin(.9); ctx.lineWidth = 1.8; ctx.stroke();
      texto(ctx, '0', cx + Math.cos(ang(0)) * (r - 26), cy + Math.sin(ang(0)) * (r - 26) + 12, 10, tin(.5), 'center');
      texto(ctx, '100', cx + Math.cos(ang(1)) * (r - 26), cy + Math.sin(ang(1)) * (r - 26) + 12, 10, tin(.5), 'center');
    }

    /* ── 5 · memoria: barras apiladas que se desplazan ───────────────── */
    function dBarras(c, T, e) {
      const ctx = lienzoListo(c), { w, h, m } = c, cols = 20, x0 = 4, pitch = (w - 8) / cols, bw = pitch - 4, paso = 4, base = h - 8, top = 8;
      const fr = (T / paso) % 1, b0 = Math.floor(T / paso), escala = v => (base - top) * v / 11;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, w - x0 * 2, h); ctx.clip();
      for (let k = 0; k <= cols; k++) {
        const s = (b0 - (cols - k)) * paso, v = senal(m, s), x = x0 + (k - fr) * pitch, sc = entre(e * 1.7 - k / cols * .7, 0, 1);
        if (sc <= 0) continue;
        const tot = escala(v) * sc, partes = [.58, .27, .15], cols3 = [.95, .52, .22];
        let y = base;
        for (let j = 0; j < 3; j++) {
          const hh = Math.max(0, tot * partes[j] - 1.4);
          if (j < 2) { ctx.beginPath(); ctx.rect(x, y - hh, bw, hh); } else { ctx.beginPath(); rr(ctx, x, y - hh - 1, bw, hh + 1, 2.5); }
          ctx.fillStyle = tin(cols3[j]); ctx.fill(); y -= tot * partes[j];
        }
      }
      ctx.restore();
      ctx.fillStyle = tin(.18); ctx.fillRect(0, base + 2, w, 1);
      // el valor de ahora: un punto naranja y una línea punteada hasta el borde
      const vy = base - escala(senal(m, T)) * e;
      ctx.setLineDash([2, 4]); ctx.strokeStyle = nar(.55 * e); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, vy); ctx.lineTo(w - 7, vy); ctx.stroke(); ctx.setLineDash([]);
      const ph = (T * .5) % 1;
      ctx.beginPath(); ctx.arc(w - 7, vy, 3.3 + ph * 5, 0, TAU); ctx.strokeStyle = nar(.5 * (1 - ph) * e); ctx.lineWidth = 1.3; ctx.stroke();
      ctx.beginPath(); ctx.arc(w - 7, vy, 3.4, 0, TAU); ctx.fillStyle = nar(e); ctx.fill();
    }

    /* ── 6 · cola: un reloj de arena de datos ────────────────────────── */
    function patronArena() {
      if (patron) return patron;
      const p = document.createElement('canvas'); p.width = p.height = 6;
      const q = p.getContext('2d'); q.fillStyle = cel(.55);
      q.fillRect(1, 1, 1.4, 1.4); q.fillRect(4, 4, 1.4, 1.4); q.fillRect(4, 0, 1, 1);
      patron = p; return p;
    }
    function filasTexto(ctx, x, y, w, filas, e) {
      filas.forEach((f, i) => {
        const yy = y + i * 24;
        ctx.fillStyle = tin(.12 * e); ctx.fillRect(x, yy - 17, w, 1);
        texto(ctx, f[0], x, yy, 11, tin(.55 * e), 'left'); texto(ctx, f[1], x + w, yy, 12, tin(.95 * e), 'right');
      });
    }
    function dReloj(c, T, e) {
      const ctx = lienzoListo(c), { w, h, m } = c, x = c.x, v = senal(m, T), u = (v - m.eje[0]) / (m.eje[1] - m.eje[0]);
      if (!x.f) x.f = resorte(0, 30, 8);
      x.f.meta = e > .3 ? u : 0;
      const ancho = w > 270, cx = ancho ? 44 : w / 2, top = 4, bot = h - 4, mid = (top + bot) / 2, hw = Math.min(25, (bot - top) * .27), nk = 2.2, hh = mid - top;
      const camara = arriba => {
        const s = arriba ? 1 : -1, y0 = mid - s * hh;
        ctx.beginPath(); ctx.moveTo(cx - hw, y0); ctx.lineTo(cx + hw, y0);
        ctx.bezierCurveTo(cx + hw, mid - s * hh * .72, cx + nk, mid - s * hh * .5, cx + nk, mid);
        ctx.lineTo(cx - nk, mid); ctx.bezierCurveTo(cx - nk, mid - s * hh * .5, cx - hw, mid - s * hh * .72, cx - hw, y0); ctx.closePath();
      };
      ctx.save(); ctx.globalAlpha = e;
      const fu = entre(x.f.x, .05, .95), nivel = mid - (hh - 5) * (.12 + .8 * fu), mont = (hh - 6) * (.1 + .8 * (1 - fu));
      // la arena de arriba, con un embudo en la superficie
      ctx.save(); camara(true); ctx.clip();
      ctx.beginPath(); ctx.moveTo(cx - hw - 2, nivel - 1); ctx.lineTo(cx - 3, nivel + 4); ctx.lineTo(cx, nivel + 6); ctx.lineTo(cx + 3, nivel + 4); ctx.lineTo(cx + hw + 2, nivel - 1); ctx.lineTo(cx + hw + 2, mid + 2); ctx.lineTo(cx - hw - 2, mid + 2); ctx.closePath();
      ctx.fillStyle = tin(.78); ctx.fill(); ctx.fillStyle = ctx.createPattern(patronArena(), 'repeat'); ctx.fill();
      ctx.restore();
      // el montón de abajo
      ctx.save(); camara(false); ctx.clip();
      ctx.beginPath(); ctx.moveTo(cx - hw - 2, bot + 2); ctx.lineTo(cx - hw - 2, bot); ctx.quadraticCurveTo(cx - hw * .16, bot - 1, cx, bot - mont); ctx.quadraticCurveTo(cx + hw * .16, bot - 1, cx + hw + 2, bot); ctx.lineTo(cx + hw + 2, bot + 2); ctx.closePath();
      ctx.fillStyle = tin(.78); ctx.fill(); ctx.fillStyle = ctx.createPattern(patronArena(), 'repeat'); ctx.fill();
      ctx.restore();
      // los granos que caen: cuadraditos de datos, el primero en naranja
      const cae = bot - mont - mid, n = 9;
      for (let i = 0; i < n; i++) {
        const ph = (T * 1.9 + i / n) % 1, gy = mid - 2 + ph * Math.max(4, cae + 2), gx = cx + Math.sin(i * 7.3 + 1) * .9;
        ctx.fillStyle = i === 0 ? nar(1) : tin(.9); ctx.fillRect(gx - 1.1, gy, 2.2, 2.2);
      }
      ctx.strokeStyle = tin(.5); ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; camara(true); ctx.stroke(); camara(false); ctx.stroke();
      ctx.strokeStyle = tin(.9); ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx - hw - 4, top - 1); ctx.lineTo(cx + hw + 4, top - 1); ctx.moveTo(cx - hw - 4, bot + 1); ctx.lineTo(cx + hw + 4, bot + 1); ctx.stroke();
      ctx.restore();
      if (ancho) {
        const m2 = MET.cola, proc = 52 + 18 * Math.sin(T * .31 + m2.ph[3]) + 8 * Math.sin(T * .9 + m2.ph[1]), espera = v / proc, re = 3 + Math.round(2.2 * Math.sin(T * .17 + m2.ph[5]) + 1.5 * Math.sin(T * .7));
        filasTexto(ctx, 104, 36, w - 108, [['Procesadas', num(proc, 0) + ' /s'], ['Espera media', num(espera, 1) + ' s'], ['Reintentos', String(Math.max(0, re))]], e);
      }
    }

    /* ── 7 · caché: un anillo de marcas que se llenan ────────────────── */
    function dAnillo(c, T, e) {
      const ctx = lienzoListo(c), { w, h, m } = c, x = c.x, v = senal(m, T), u = (v - m.eje[0]) / (m.eje[1] - m.eje[0]);
      if (!x.an) x.an = resorte(0, 34, 8.6);
      x.an.meta = e > .3 ? u : 0;
      const ancho = w > 270, R = Math.min(h / 2 - 2, 52), cx = ancho ? w - R - 6 : w / 2, cy = h / 2, N = 60;
      const lleno = entre(x.an.x, 0, 1) * N, real = u * N;
      for (let i = 0; i < N; i++) {
        const an = -Math.PI / 2 + i / N * TAU, mayor = i % 5 === 0, r0 = R - (mayor ? 13 : 10);
        let col;
        if (i + 1 <= lleno) col = tin(.94);
        else if (i < lleno) col = tin(.2 + .74 * (lleno - i));
        else if (i >= Math.floor(real) && x.an.x > .5) col = nar(.95);
        else col = tin(.16);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(an) * r0, cy + Math.sin(an) * r0); ctx.lineTo(cx + Math.cos(an) * R, cy + Math.sin(an) * R);
        ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.stroke();
      }
      texto(ctx, num(entre(x.an.x, 0, 1) * (m.eje[1] - m.eje[0]) + m.eje[0], 1), cx, cy + 2, 14, tin(.95 * e), 'center');
      texto(ctx, 'ACIERTOS', cx, cy + 16, 8.5, tin(.5 * e), 'center');
      if (ancho) {
        const hit = 1180 + 90 * Math.sin(T * .27 + m.ph[3]) + 30 * Math.sin(T * 1.1 + m.ph[1]), fallos = hit * (1 - v / 100) / (v / 100), ex = 2 + Math.round(1.6 * Math.sin(T * .2 + m.ph[5]) + 1.2 * Math.sin(T * .8));
        filasTexto(ctx, 0, 36, cx - R - 22, [['Aciertos', num(hit, 0) + ' /s'], ['Fallos', num(fallos, 0) + ' /s'], ['Expulsiones', String(Math.max(0, ex)) + ' /s']], e);
      }
    }

    /* ── 8 · red: dos ondas espejadas, entrada arriba y salida abajo ── */
    function dOndas(c, T, e) {
      const ctx = lienzoListo(c), { w, h, m } = c, N = 64, dt = .95, mid = h / 2 - 2, amp = h / 2 - 14, W = w - 10;
      const xs = [], yi = [], yo = [];
      for (let i = 0; i < N; i++) {
        const s = T - (N - 1 - i) * dt; xs.push(W * i / (N - 1));
        yi.push(mid - 2 - amp * senal(m, s) / 62); yo.push(mid + 2 + amp * senal(m, s + 411, 0, m.ph2) * .72 / 62);
      }
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W * e + 3, h); ctx.clip();
      let g = ctx.createLinearGradient(0, mid - amp, 0, mid); g.addColorStop(0, tin(.3)); g.addColorStop(1, tin(.02));
      ctx.beginPath(); traza(ctx, xs, yi); ctx.lineTo(W, mid); ctx.lineTo(0, mid); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); traza(ctx, xs, yi); ctx.strokeStyle = tin(.95); ctx.lineWidth = 1.7; ctx.stroke();
      g = ctx.createLinearGradient(0, mid + amp, 0, mid); g.addColorStop(0, tin(.2)); g.addColorStop(1, tin(.02));
      ctx.beginPath(); traza(ctx, xs, yo); ctx.lineTo(W, mid); ctx.lineTo(0, mid); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); traza(ctx, xs, yo); ctx.strokeStyle = tin(.55); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
      ctx.setLineDash([2, 4]); ctx.strokeStyle = tin(.22); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke(); ctx.setLineDash([]);
      texto(ctx, '↓ entrada', 0, 9, 10, tin(.55), 'left');
      texto(ctx, '↑ salida', 0, h - 2, 10, tin(.55), 'left');
      const hx = W * e, ph = (T * .5) % 1, k = Math.min(N - 1, e * (N - 1)), i0 = Math.floor(k), hy = lerp(yi[i0], yi[Math.min(N - 1, i0 + 1)], k - i0);
      ctx.beginPath(); ctx.arc(hx, hy, 3.4 + ph * 6, 0, TAU); ctx.strokeStyle = nar(.55 * (1 - ph) * e); ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, TAU); ctx.fillStyle = nar(e); ctx.fill();
    }

    /* ── 9 · disco: una barra por tramos que se enciende en orden ───── */
    function dTramos(c, T, e) {
      const ctx = lienzoListo(c), { w, h, m } = c, v = senal(m, T), u = (v - m.eje[0]) / (m.eje[1] - m.eje[0]), N = 34, pitch = (w - 2) / N, sw = pitch - 3, by = 8, bh = Math.min(40, h * .34);
      const lleno = u * N * Math.min(1, e * 1.25), ult = Math.floor(lleno - .0001);
      for (let i = 0; i < N; i++) {
        const sc = entre(e * 2.2 - i / N * 1.2, 0, 1), on = i + 1 <= lleno, parcial = !on && i < lleno;
        ctx.beginPath(); rr(ctx, 1 + i * pitch + sw * (1 - sc) / 2, by + (bh * (1 - sc)) / 2, sw * sc, bh * sc, 3);
        ctx.fillStyle = i === ult && on ? nar(1) : on ? tin(.92 - .1 * (1 - i / N)) : parcial ? tin(.2 + .7 * (lleno - i)) : tin(.12); ctx.fill();
      }
      const ty = by + bh + 8;
      ctx.fillStyle = tin(.18);
      for (let i = 0; i <= 4; i++) ctx.fillRect(Math.min(w - 1, 1 + i / 4 * (w - 2)) - (i === 4 ? 1 : 0), ty, 1, 5);
      texto(ctx, '0', 0, ty + 17, 10, tin(.5), 'left'); texto(ctx, '50', w / 2, ty + 17, 10, tin(.5), 'center'); texto(ctx, '100 %', w, ty + 17, 10, tin(.5), 'right');
      const usado = u * 600, libre = 600 - usado;
      texto(ctx, num(usado, 0) + ' GB usados', 0, h - 3, 11, tin(.85 * e), 'left'); texto(ctx, num(libre, 0) + ' GB libres', w, h - 3, 11, tin(.5 * e), 'right');
    }
    const FORMA = { peticiones: dLinea, latencia: dLatencia, errores: dCalor, cpu: dDial, memoria: dBarras, cola: dReloj, cache: dAnillo, red: dOndas, disco: dTramos };

    /* =====================================================================
       El detalle: crece desde la celda, con lecturas, rango y umbral
       ===================================================================== */
    const rejilla = $('[data-rejilla]'), det = $('[data-det]'), clip = $('[data-clip]');
    const dcv = $('[data-d-lienzo]'), dctx = dcv.getContext('2d'), area = $('[data-area]');
    const handle = $('[data-umbral]'), umTxt = $('[data-um-txt]');
    const rangoEl = $('[data-rango]'), rbtn = $$('button', rangoEl), pildora = $('.in-rango-pildora', rangoEl);
    const lect = { prom: $('[data-l="prom"]'), min: $('[data-l="min"]'), max: $('[data-l="max"]'), p95: $('[data-l="p95"]') };
    const dValor = $('[data-d-valor]'), dUnidad = $('[data-d-unidad]'), dDelta = $('[data-d-delta]'), dNombre = $('[data-d-nombre]'), dDesc = $('[data-d-desc]');
    const estadoTxt = $('[data-d-estado-txt]'), cierraBtn = $('[data-cierra]'), aviso = $('[data-aviso]');
    const ap = resorte(0, 150, 17.6);                 // cuánto ha crecido el detalle (0 = celda, 1 = bloque)
    let abierta = null, cerrando = false, pendiente = null, rango = '5m', rangoPrev = null;
    const morf = resorte(1, 150, 17);
    let vals = new Array(NS).fill(0), valsPrev = null, etqPrev = null;
    let SB = 14, dW = 0, dH = 0, hov = null, arrastra = false, textos = 0;
    const MG = { l: 46, r: 106, t: 14, b: 26 };

    function mideDetalle() {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = dcv.clientWidth, h = dcv.clientHeight;
      if (!w || !h) return;
      dW = w; dH = h;
      MG.r = w < 420 ? 84 : 106; MG.l = w < 420 ? 38 : 46;
      if (dcv.width !== Math.round(w * dpr) || dcv.height !== Math.round(h * dpr)) { dcv.width = Math.round(w * dpr); dcv.height = Math.round(h * dpr); }
      dcv.dataset.dpr = dpr;
      ponTirador();
    }
    const yDe = (m, v) => MG.t + (1 - (v - m.eje[0]) / (m.eje[1] - m.eje[0])) * (dH - MG.t - MG.b);
    function ponTirador() {
      if (!abierta) return;
      const m = abierta.m, y = yDe(m, m.umbral);
      handle.style.transform = 'translateY(' + y.toFixed(1) + 'px)';
      handle.setAttribute('aria-valuemin', m.eje[0]); handle.setAttribute('aria-valuemax', m.eje[1]); handle.setAttribute('aria-valuenow', m.umbral);
      handle.setAttribute('aria-valuetext', num(m.umbral, m.dec) + ' ' + m.unidad);
      umTxt.textContent = num(m.umbral, m.dec);
    }

    /* el bloque de 2 × 2 celdas que contiene a la abierta (en pantallas medianas, la ventana) */
    function coloca() {
      const c = abierta; if (!c) return;
      const movil = movilMQ.matches; SB = movil ? 0 : 14;
      det.style.setProperty('--in-sangrado', SB + 'px');
      if (!movil) {
        const col = c.i % 3, fila = Math.floor(c.i / 3), c0 = col === 2 ? 1 : 0, f0 = fila === 2 ? 1 : 0;
        const A = celdas[f0 * 3 + c0].el, B = celdas[(f0 + 1) * 3 + c0 + 1].el;
        det.style.left = (A.offsetLeft - SB) + 'px'; det.style.top = (A.offsetTop - SB) + 'px';
        det.style.width = (B.offsetLeft + B.offsetWidth - A.offsetLeft + SB * 2) + 'px'; det.style.height = (B.offsetTop + B.offsetHeight - A.offsetTop + SB * 2) + 'px';
        celdas.forEach(k => { k.oculta = Math.floor(k.i / 3) >= f0 && Math.floor(k.i / 3) <= f0 + 1 && k.i % 3 >= c0 && k.i % 3 <= c0 + 1; });
      } else {
        det.style.left = det.style.top = det.style.width = det.style.height = '';
        celdas.forEach(k => { k.oculta = false; });
      }
      const dr = det.getBoundingClientRect(), cr = c.el.getBoundingClientRect();
      inicioClip = { t: cr.top - dr.top, r: dr.right - cr.right, b: dr.bottom - cr.bottom, l: cr.left - dr.left };
    }
    let inicioClip = { t: 0, r: 0, b: 0, l: 0 };
    function ponClip() {
      const u = ap.x, f = SB, i = inicioClip;
      clip.style.clipPath = 'inset(' + [lerp(i.t, f, u), lerp(i.r, f, u), lerp(i.b, f, u), lerp(i.l, f, u)].map(v => v.toFixed(1) + 'px').join(' ') + ' round ' + lerp(18, 24, entre(u, 0, 1)).toFixed(1) + 'px)';
    }

    function llenaDetalle(m) {
      dNombre.textContent = m.nombre; dDesc.textContent = m.desc; dUnidad.textContent = m.unidad;
      det.setAttribute('aria-label', 'Detalle de ' + m.nombre);
    }
    function pildoraRango() {
      const b = rbtn.find(x => x.getAttribute('aria-checked') === 'true');
      pildora.style.width = b.offsetWidth + 'px'; pildora.style.transform = 'translateX(' + b.offsetLeft + 'px)';
    }
    function ponRango(id, enfoca) {
      if (!RANGOS[id] || id === rango) return;
      valsPrev = vals.slice(); etqPrev = ETIQ[rango]; rango = id; morf.x = 0; morf.v = 0; morf.meta = 1;
      if (reduce) { morf.x = 1; valsPrev = null; }
      rbtn.forEach(b => { const on = b.dataset.r === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
      if (enfoca) rbtn.find(b => b.dataset.r === id).focus();
      pildoraRango(); textos = -1; despierta();
    }
    rbtn.forEach(b => {
      b.addEventListener('click', () => ponRango(b.dataset.r));
      b.addEventListener('keydown', ev => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key]; if (!d) return;
        ev.preventDefault(); ponRango(rbtn[(rbtn.indexOf(b) + d + rbtn.length) % rbtn.length].dataset.r, true);
      });
    });

    function abre(c) {
      if (typeof c === 'string') c = celdaDe(c);
      if (!c || abierta === c) return;
      if (abierta) { pendiente = c; cierra(); return; }
      abierta = c; cerrando = false; pendiente = null; hov = null;
      const m = c.m;
      llenaDetalle(m);
      rango = '5m'; valsPrev = null; morf.x = 1; morf.v = 0; morf.meta = 1;
      rbtn.forEach(b => { const on = b.dataset.r === '5m'; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
      det.classList.add('is-vivo'); det.classList.remove('is-alerta');
      coloca(); mideDetalle(); pildoraRango(); ponTirador();
      celdas.forEach(k => { if (k.oculta) k.el.setAttribute('inert', ''); k.el.setAttribute('aria-expanded', String(k === c)); k.el.classList.toggle('is-abierta', k === c); });
      ap.k = 150; ap.c = 17.6; ap.x = reduce ? 1 : 0; ap.v = 0; ap.meta = 1; ponClip();
      textos = -1;
      void det.offsetWidth;
      det.classList.add('is-abierto');
      aviso.textContent = 'Detalle de ' + m.nombre + '. Usa las flechas del umbral para ajustarlo y Escape para cerrar.';
      setTimeout(() => { if (abierta === c && !cerrando) cierraBtn.focus({ preventScroll: true }); }, 140);
      despierta();
    }
    function cierra() {
      if (!abierta || cerrando) return;
      cerrando = true; arrastra = false; handle.classList.remove('is-agarrado');
      det.classList.remove('is-abierto');
      ap.k = 230; ap.c = 29; ap.meta = 0;
      if (reduce) { ap.x = 0; ap.v = 0; }
      const c = abierta;
      celdas.forEach(k => k.el.removeAttribute('inert'));   // un elemento inerte no admite foco
      if (document.activeElement && det.contains(document.activeElement)) c.el.focus({ preventScroll: true });
      despierta();
    }
    function terminaCierre() {
      const c = abierta;
      det.classList.remove('is-vivo', 'is-alerta');
      celdas.forEach(k => { k.el.removeAttribute('inert'); k.el.setAttribute('aria-expanded', 'false'); k.el.classList.remove('is-abierta'); k.oculta = false; });
      abierta = null; cerrando = false;
      if (c) estadoAlertas();
      if (pendiente) { const p = pendiente; pendiente = null; abre(p); }
    }
    celdas.forEach(c => c.el.addEventListener('click', () => { if (abierta === c && !cerrando) cierra(); else abre(c); }));
    cierraBtn.addEventListener('click', cierra);
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && abierta && !cerrando) { ev.preventDefault(); cierra(); } });

    /* ── el umbral: arrastre, dedo y flechas ──────────────────────────── */
    function ponUmbral(v) {
      const m = abierta.m, q = Math.round((v - m.eje[0]) / m.paso) * m.paso + m.eje[0];
      m.umbral = +entre(q, m.eje[0], m.eje[1]).toFixed(4); m.tocado = true;
      ponTirador(); textos = -1; despierta();
    }
    const vDeY = ev => { const r = dcv.getBoundingClientRect(), m = abierta.m; return m.eje[0] + (1 - (ev.clientY - r.top - MG.t) / Math.max(1, r.height - MG.t - MG.b)) * (m.eje[1] - m.eje[0]); };
    handle.addEventListener('pointerdown', ev => {
      if (!abierta) return;
      arrastra = true; handle.classList.add('is-agarrado');
      try { handle.setPointerCapture(ev.pointerId); } catch (_) { /* sin captura */ }
      ev.preventDefault(); ponUmbral(vDeY(ev));
    });
    handle.addEventListener('pointermove', ev => { if (arrastra && abierta) ponUmbral(vDeY(ev)); });
    const suelta = () => { if (!arrastra) return; arrastra = false; handle.classList.remove('is-agarrado'); };
    handle.addEventListener('pointerup', suelta); handle.addEventListener('pointercancel', suelta);
    handle.addEventListener('keydown', ev => {
      if (!abierta) return;
      const m = abierta.m, g = (ev.shiftKey ? 10 : 1) * m.paso;
      let v = m.umbral;
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') v += g; else if (ev.key === 'ArrowDown' || ev.key === 'ArrowLeft') v -= g;
      else if (ev.key === 'Home') v = m.eje[0]; else if (ev.key === 'End') v = m.eje[1]; else return;
      ev.preventDefault(); ponUmbral(v);
    });
    // el cursor sobre el gráfico: guía vertical con el valor de ese instante
    dcv.addEventListener('pointermove', ev => {
      if (!abierta || arrastra) return;
      const r = dcv.getBoundingClientRect(), u = (ev.clientX - r.left - MG.l) / Math.max(1, r.width - MG.l - MG.r);
      hov = u < 0 || u > 1 ? null : Math.round(u * (NS - 1)); despierta();
    });
    dcv.addEventListener('pointerleave', () => { hov = null; despierta(); });

    /* ── dibujo del gráfico grande ───────────────────────────────────── */
    function dibujaDetalle() {
      if (!abierta || !dW) return;
      const m = abierta.m, R = RANGOS[rango], dpr = +dcv.dataset.dpr || 1, ctx = dctx, w = dW, h = dH;
      const cur = serie(m, R, T, NS, 0);
      const u = entre(morf.x, 0, 1.06), mostrados = new Array(NS);
      for (let i = 0; i < NS; i++) mostrados[i] = valsPrev ? lerp(valsPrev[i], cur[i], u) : cur[i];
      if (valsPrev && reposo(morf)) valsPrev = null;
      vals = cur.slice();
      const px = MG.l, pw = w - MG.l - MG.r, py = MG.t, ph = h - MG.t - MG.b;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const y = v => yDe(m, v), x = i => px + pw * i / (NS - 1);
      // rejilla y ejes
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const yy = Math.round(py + ph * i / 4) + .5, val = m.eje[1] - (m.eje[1] - m.eje[0]) * i / 4;
        ctx.strokeStyle = tin(i === 4 ? .22 : .08); ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px + pw, yy); ctx.stroke();
        texto(ctx, num(val, m.dec && (m.eje[1] - m.eje[0]) < 30 ? Math.min(m.dec, 1) : 0), px - 9, yy + 3.5, 10, tin(.52), 'right');
      }
      const mitad = valsPrev && morf.x < .5, et = mitad ? etqPrev : ETIQ[rango], aE = valsPrev ? Math.abs(morf.x * 2 - 1) : 1;
      // en anchos pequeños se dejan solo cuatro marcas para que no se pisen
      et.forEach((s, i) => { if (w < 420 && (i === 1 || i === 3)) return; texto(ctx, s, px + pw * i / (et.length - 1), h - 7, 10, tin(.52 * aE), i === 0 ? 'left' : i === et.length - 1 ? 'right' : 'center'); });
      // la serie, con el tramo fuera de umbral en naranja
      const xs = [], ys = [];
      for (let i = 0; i < NS; i++) { xs.push(x(i)); ys.push(y(mostrados[i])); }
      const yT = y(m.umbral), rev = entre(ent.x, 0, 1);
      ctx.save(); ctx.beginPath(); ctx.rect(px - 2, 0, pw * rev + 3, h); ctx.clip();
      const g = ctx.createLinearGradient(0, py, 0, py + ph); g.addColorStop(0, tin(.24)); g.addColorStop(1, tin(0));
      ctx.beginPath(); traza(ctx, xs, ys); ctx.lineTo(xs[NS - 1], py + ph); ctx.lineTo(xs[0], py + ph); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      // región «fuera»: arriba del umbral (o abajo, en la caché)
      ctx.save(); ctx.beginPath(); if (m.bajo) ctx.rect(px - 2, yT, pw + 4, h); else ctx.rect(px - 2, 0, pw + 4, yT); ctx.clip();
      ctx.beginPath(); traza(ctx, xs, ys); ctx.lineTo(xs[NS - 1], yT); ctx.lineTo(xs[0], yT); ctx.closePath(); ctx.fillStyle = nar(.3); ctx.fill();
      ctx.beginPath(); traza(ctx, xs, ys); ctx.strokeStyle = nar(1); ctx.lineWidth = 2.1; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.beginPath(); if (m.bajo) ctx.rect(px - 2, 0, pw + 4, yT); else ctx.rect(px - 2, yT, pw + 4, h); ctx.clip();
      ctx.beginPath(); traza(ctx, xs, ys); ctx.strokeStyle = tin(.96); ctx.lineWidth = 2.1; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
      ctx.restore();
      // la línea del umbral
      ctx.setLineDash([5, 5]); ctx.strokeStyle = nar(.95); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(px, yT); ctx.lineTo(px + pw + 6, yT); ctx.stroke(); ctx.setLineDash([]);
      // la cabeza, en naranja, y el valor al pasar el cursor
      const hx = px + pw * rev, k = rev * (NS - 1), i0 = Math.min(NS - 2, Math.floor(k)), hy = lerp(ys[i0], ys[i0 + 1], k - i0), ph2 = (T * .5) % 1;
      ctx.beginPath(); ctx.arc(hx, hy, 4 + ph2 * 7, 0, TAU); ctx.strokeStyle = nar(.55 * (1 - ph2) * rev); ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy, 4, 0, TAU); ctx.fillStyle = nar(rev); ctx.fill();
      if (hov != null && !valsPrev) {
        const hx2 = x(hov), hy2 = ys[hov], txt = num(mostrados[hov], m.dec) + ' ' + m.unidad;
        ctx.strokeStyle = tin(.35); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx2 + .5, py); ctx.lineTo(hx2 + .5, py + ph); ctx.stroke();
        ctx.beginPath(); ctx.arc(hx2, hy2, 4, 0, TAU); ctx.fillStyle = cel(1); ctx.fill(); ctx.strokeStyle = tin(1); ctx.lineWidth = 2; ctx.stroke();
        ctx.font = '400 11px ' + MONO; const tw = ctx.measureText(txt).width + 18, tx = entre(hx2 - tw / 2, px, px + pw - tw), ty = hy2 < py + 36 ? hy2 + 14 : hy2 - 36;
        ctx.beginPath(); rr(ctx, tx, ty, tw, 24, 8); ctx.fillStyle = tin(1); ctx.fill();
        texto(ctx, txt, tx + tw / 2, ty + 16, 11, cel(1), 'center');
      }
      // lecturas, estado y alerta del detalle (varias veces por segundo, no en cada cuadro)
      if (textos <= 0) {
        textos = 14;
        let s = 0, mn = Infinity, mx = -Infinity;
        for (let i = 0; i < NS; i++) { const q = cur[i]; s += q; if (q < mn) mn = q; if (q > mx) mx = q; }
        const orden = cur.slice().sort((p, q) => p - q), p95 = orden[Math.floor(NS * .95)], d = m.dec;
        lect.prom.textContent = num(s / NS, d); lect.min.textContent = num(mn, d); lect.max.textContent = num(mx, d); lect.p95.textContent = num(p95, d);
        dValor.textContent = num(cur[NS - 1], d);
        const ant = serie(m, R, T, 24, R), pa = ant.reduce((p, q) => p + q, 0) / 24, pr = s / NS, dv = (pr - pa) / (pa || 1) * 100;
        dDelta.textContent = (dv >= 0 ? '↑ ' : '↓ ') + num(Math.abs(dv), 1) + ' % frente al periodo anterior';
      } else textos--;
      m.ultimo = vals[NS - 1];
    }
    const ent = resorte(0, 26, 9.6);                  // la serie del detalle se traza al abrir

    /* ── alertas: cruzar el umbral ───────────────────────────────────── */
    function enAlerta(m) {
      const v = abierta && abierta.m === m ? vals[NS - 1] : senal(m, T);
      return m.tocado && (m.bajo ? v < m.umbral : v > m.umbral);
    }
    function estadoAlertas() {
      let alguna = null;
      celdas.forEach(c => {
        const al = enAlerta(c.m);
        if (al !== c.m.alerta) {
          c.m.alerta = al; c.el.classList.toggle('is-alerta', al);
          aviso.textContent = al ? c.m.nombre + ': ' + (c.m.bajo ? 'por debajo' : 'por encima') + ' del umbral de ' + num(c.m.umbral, c.m.dec) + ' ' + c.m.unidad + '.' : c.m.nombre + ': de vuelta dentro del umbral.';
          if (typeof o.alCambiar === 'function') o.alCambiar({ metrica: c.m.id, umbral: c.m.umbral, alerta: al });
        }
        if (al && !alguna) alguna = c.m;
      });
      raiz.classList.toggle('is-alerta', !!alguna);
      rejilla.classList.toggle('is-alerta', !!alguna);
      const propia = abierta && abierta.m.alerta;
      det.classList.toggle('is-alerta', !!propia);
      const txt = alguna ? 'Alerta · ' + alguna.nombre.split(' ')[0] : 'En línea';
      if (estadoGTxt.textContent !== txt) estadoGTxt.textContent = txt;
      if (abierta) {
        const et = propia ? (abierta.m.bajo ? 'Por debajo del umbral' : 'Umbral superado') : 'Dentro del umbral';
        if (estadoTxt.textContent !== et) estadoTxt.textContent = et;
      }
    }
    const estadoGTxt = $('[data-estado-txt]');

    /* =====================================================================
       El bucle
       ===================================================================== */
    function cuadro(ms) {
      raf = 0;
      if (document.hidden) return;
      if (!inicio) inicio = ms;
      const dt = previo ? Math.min(.1, (ms - previo) / 1000) : 0, seg = (ms - inicio) / 1000;
      previo = ms; resto += dt;
      if (!reduce) T = T0 + seg * o.velocidad;
      // física de las entradas, de las agujas y del detalle
      let vivo = !reduce;
      while (resto >= PASO) {
        celdas.forEach(c => {
          if (!c.vivo && seg > c.retardo) { c.vivo = true; c.entra.meta = 1; }
          avanza(c.entra, PASO); if (c.x.ag) avanza(c.x.ag, PASO); if (c.x.f) avanza(c.x.f, PASO); if (c.x.an) avanza(c.x.an, PASO);
        });
        avanza(ap, PASO); avanza(morf, PASO); avanza(ent, PASO);
        resto -= PASO;
      }
      if (reduce) { celdas.forEach(c => { c.entra.x = c.entra.meta = 1; if (c.x.ag) c.x.ag.x = c.x.ag.meta; if (c.x.f) c.x.f.x = c.x.f.meta; if (c.x.an) c.x.an.x = c.x.an.meta; }); ap.x = ap.meta; morf.x = 1; ent.x = ent.meta = 1; }
      // las celdas: se dibujan todas menos las que el detalle tapa por completo
      const tapadas = abierta && ap.x > .985 && !cerrando;
      celdas.forEach(c => {
        if (!c.w) mideCelda(c);
        if (tapadas && c.oculta) return;
        if (!c.w) return;
        const e = reduce ? 1 : entre(c.entra.x, 0, 1.0);
        if (e <= 0.001) { lienzoListo(c); return; }
        FORMA[c.m.id](c, T, e);
        // la cifra grande se refresca unas cuatro veces por segundo
        const v = senal(c.m, T), t = num(v, c.m.dec);
        if (t !== c.txt && (ms - ult > 240 || !c.txt)) { c.txt = t; c.valEl.textContent = t; }
      });
      if (ms - ult > 240) ult = ms;
      if (abierta) {
        if (ap.x > .02 || cerrando) { ponClip(); }
        if (!cerrando) ent.meta = ap.x > .55 ? 1 : 0; else ent.meta = 0;
        if (ap.x > .3) dibujaDetalle();
        if (cerrando && ap.meta === 0 && ap.x < .004 && Math.abs(ap.v) < .08) terminaCierre();
        else estadoAlertas();
      } else { ent.x = ent.meta = 0; estadoAlertas(); }
      if (!reduce) { raf = requestAnimationFrame(cuadro); return; }
      if (abierta || !reposo(ap)) raf = requestAnimationFrame(cuadro);
    }
    function despierta() { if (!raf) { previo = 0; raf = requestAnimationFrame(cuadro); } }
    document.addEventListener('visibilitychange', () => { previo = 0; if (!document.hidden) despierta(); });
    if (reduce) setInterval(() => { T += 5; despierta(); }, 2000);

    /* ── tamaño ──────────────────────────────────────────────────────── */
    const ro = new ResizeObserver(() => { celdas.forEach(mideCelda); if (abierta) { coloca(); mideDetalle(); pildoraRango(); ponClip(); } despierta(); });
    celdas.forEach(c => ro.observe(c.cv)); ro.observe(area);
    movilMQ.addEventListener && movilMQ.addEventListener('change', () => { if (abierta) { coloca(); mideDetalle(); ponClip(); } });

    /* ── el tema ─────────────────────────────────────────────────────── */
    const temaBtn = $('[data-tema-btn]');
    const claro = () => document.documentElement.dataset.tema === 'claro';
    function ponTemaTxt() { temaBtn.setAttribute('aria-label', claro() ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'); }
    temaBtn.addEventListener('click', () => { document.documentElement.dataset.tema = claro() ? 'oscuro' : 'claro'; ponTemaTxt(); leeColores(); despierta(); });
    ponTemaTxt();

    /* ── al empezar ──────────────────────────────────────────────────── */
    leeColores();
    if (!reduce) raiz.classList.add('is-entra');
    celdas.forEach(mideCelda);
    if (reduce) { celdas.forEach(c => { c.vivo = true; c.entra.x = c.entra.meta = 1; }); }
    if (document.fonts) document.fonts.ready.then(() => { leeColores(); celdas.forEach(mideCelda); pildoraRango(); despierta(); });
    despierta();

    return {
      abre: id => abre(id), cierra, rango: id => ponRango(id),
      umbral: v => { if (abierta) ponUmbral(v); },
      get abierta() { return abierta ? abierta.m.id : null; },
    };
  }

  window.Instrumental = Instrumental;
})();
