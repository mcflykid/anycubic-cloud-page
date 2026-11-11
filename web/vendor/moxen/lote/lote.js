/* =====================================================================
   Lote · Moxen
   Una tabla de datos que se selecciona PINTANDO. Hace falta tan poco como
   arrastrar el dedo por la columna de casillas:

   · Arrastras por la columna de casillas y las filas se marcan una tras otra
     como una pincelada: el relleno azul de cada fila entra de izquierda a
     derecha, la casilla se hincha y el visto se dibuja. Una pastilla azul (el
     pincel) se estira con resorte entre la fila donde empezaste y la del
     puntero. Si empiezas sobre una fila ya marcada, el pincel borra. Si
     vuelves atrás sin soltar, lo que dejaste atrás recupera su estado.
   · Mayús + clic marca un rango desde la última fila tocada; un clic en
     cualquier parte de la fila la alterna; el teclado funciona como una
     cuadrícula: ↑ ↓ Inicio Fin se mueven, Espacio alterna, Mayús + flechas
     extiende, Ctrl/⌘ + A marca todo y Esc quita la selección.
   · La casilla de la cabecera tiene tres estados (nada, parte, todo): si hay
     una parte, un clic la quita; si no hay nada, marca todo con una ola.
   · En cuanto hay algo marcado, sube con resorte una barra flotante: «4
     seleccionadas» (la cifra rueda), el peso total que suma y las acciones.
   · «Archivar» hunde las filas elegidas y las demás cierran el hueco con FLIP;
     la barra se convierte en un aviso con ✓ y una línea que se vacía mientras
     se puede «Deshacer»: las filas vuelven y se vuelven a marcar en cascada.

   Cómo se monta (ver index.html; las filas salen de los datos, no del HTML):
     const l = Lote(document.querySelector('[data-lote]'), {
       envios: DEMO,        // [{ id, cuenta, ini, tono (1–6), destino, estado, peso, entrega }]
       deshacer: 6500,      // ms que dura el aviso con «Deshacer»
       alCambiar:  ({ seleccion, peso }) => {},   // cada vez que cambia lo marcado
       alArchivar: envios => {},                  // se pulsó «Archivar» (aún se puede deshacer)
       alDeshacer: envios => {},
       alExportar: envios => {},
     });
     l.seleccionados();   // los datos de las filas marcadas
     l.selecciona(['EN-4812', 'EN-4815']);
     l.limpia(); l.archiva(); l.deshace();
   Con datos de verdad: en alArchivar llama a tu API (y en alDeshacer, a su
   contraria); lo que hace este recurso es la interfaz y su movimiento.

   Qué se personaliza: los colores y las tipografías, el principio de lote.css
   (--lo-azul es la selección; los estados usan --lo-azul, --lo-verde y
   --lo-ambar); las columnas, en --lo-cols; los textos, DEMO y ESTADOS; los
   resortes, RESORTES. Solo se animan transform, opacity y clip-path. Sin
   dependencias y sin Date.
   ===================================================================== */
(function () {
  'use strict';

  const ESTADOS = { transito: 'En tránsito', retrasado: 'Retrasado', entregado: 'Entregado', preparando: 'Preparando' };
  const DEMO = [
    { id: 'EN-4807', cuenta: 'Panadería',   ini: 'P', tono: 1, destino: 'Lisboa',    estado: 'transito',   peso: 12.4, entrega: '16 oct' },
    { id: 'EN-4812', cuenta: 'Floristería', ini: 'F', tono: 2, destino: 'Oporto',    estado: 'entregado',  peso: 3.8,  entrega: '14 oct' },
    { id: 'EN-4815', cuenta: 'Librería',    ini: 'L', tono: 3, destino: 'Turín',     estado: 'transito',   peso: 9.6,  entrega: '17 oct' },
    { id: 'EN-4819', cuenta: 'Taller',      ini: 'T', tono: 4, destino: 'Rotterdam', estado: 'retrasado',  peso: 21.0, entrega: '15 oct' },
    { id: 'EN-4823', cuenta: 'Cervecería',  ini: 'C', tono: 5, destino: 'Hamburgo',  estado: 'preparando', peso: 14.2, entrega: '19 oct' },
    { id: 'EN-4826', cuenta: 'Estudio',     ini: 'E', tono: 6, destino: 'Marsella',  estado: 'transito',   peso: 6.5,  entrega: '18 oct' },
    { id: 'EN-4830', cuenta: 'Mercería',    ini: 'M', tono: 2, destino: 'Gdansk',    estado: 'entregado',  peso: 2.7,  entrega: '14 oct' },
    { id: 'EN-4834', cuenta: 'Vivero',      ini: 'V', tono: 5, destino: 'Bilbao',    estado: 'preparando', peso: 18.3, entrega: '20 oct' },
  ];
  // la lista se reacomoda con un resorte suave; el pincel sigue al puntero con uno más tenso
  const RESORTES = { lista: [170, 16], entra: [200, 15], barra: [210, 17], contador: [190, 16], pincel: [340, 25], peso: [150, 19] };

  /* ── resortes: el mismo solver de la familia Moxen ───────────────── */
  const resorte = (x, k, c) => ({ x, v: 0, meta: x, k, c });
  function avanza(r, h) { r.v += (r.k * (r.meta - r.x) - r.c * r.v) * h; r.x += r.v * h; }
  const reposo = (r, eps) => Math.abs(r.v) < eps * 6 && Math.abs(r.meta - r.x) < eps;

  // un resorte convertido en curva CSS linear(), para lo que se mueve con CSS o con WAAPI
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

  // 12.4 → «12,4»
  const kilos = v => v.toFixed(1).replace('.', ',');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  /* =====================================================================
     El contador que rueda
     Cada dígito es una columna recortada con una tira del 0 al 9: para
     cambiarlo solo se mueve la tira (--d). Los dígitos del final salen antes.
     ===================================================================== */
  function Rodillo(el) {
    let cols = [];
    el.textContent = '';
    function pon(n) {
      const dig = Array.from(String(n));
      while (cols.length > dig.length) el.removeChild(cols.shift());
      let nuevo = false;
      while (cols.length < dig.length) {
        const c = document.createElement('span'), t = document.createElement('span');
        c.className = 'lo-col'; t.className = 'lo-tira';
        c.setAttribute('aria-hidden', 'true');
        t.innerHTML = '0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9';
        t.style.setProperty('--d', 0);
        c.appendChild(t); el.insertBefore(c, el.firstChild); cols.unshift(c); nuevo = true;
      }
      if (nuevo) void el.offsetWidth;          // la tira parte del 0 y rueda hasta su cifra
      dig.forEach((ch, i) => { const t = cols[i].firstChild; t.style.setProperty('--i', dig.length - 1 - i); t.style.setProperty('--d', ch); });
    }
    return { pon };
  }

  function Lote(raiz, opciones) {
    const o = Object.assign({ envios: DEMO, deshacer: 6500, alCambiar: null, alArchivar: null, alDeshacer: null, alExportar: null }, opciones);
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const quieto = () => mq.matches;
    const $ = s => raiz.querySelector(s);
    const cuerpo = $('[data-cuerpo]'), lista = $('[data-lista]'), pincel = $('[data-pincel]'), vacio = $('[data-vacio]');
    const todas = $('[data-todas]'), barra = $('[data-barra]'), pie = $('[data-pie]'), vivo = $('[data-vivo]');
    const resumen = $('[data-resumen]'), capaSel = $('[data-capa-sel]'), capaHecho = $('[data-capa-hecho]');
    const uniEl = $('[data-uni]'), pesoEl = $('[data-peso]'), hechoTxt = $('[data-hecho-txt]'), btnExportar = $('[data-accion="exportar"]');
    const contador = Rodillo($('[data-num]')), total = Rodillo($('[data-total]')), totalTxt = $('[data-total-txt]');
    const ENTRA = muelle.apply(null, RESORTES.entra), ESTA = muelle.apply(null, RESORTES.lista);
    raiz.style.setProperty('--lo-muelle', muelle.apply(null, RESORTES.contador));

    let filas = [], ancla = null, extFin = null, pintando = null, guardado = null, tiempoId = 0, exportaId = 0, avisoId = 0, fTab = null, nPrevio = 0;
    const visibles = () => filas.filter(f => !f.arch);
    const marcadas = () => visibles().filter(f => f.sel);
    const avisa = s => { vivo.textContent = ''; vivo.textContent = s; };

    /* ── una fila ───────────────────────────────────────────────────────── */
    function creaFila(d) {
      const el = document.createElement('div');
      el.className = 'lo-fila'; el.setAttribute('role', 'row'); el.setAttribute('aria-selected', 'false'); el.dataset.fila = d.id;
      el.innerHTML = '<div class="lo-c lo-c-chk" role="gridcell">'
        + '<button class="lo-casilla" type="button" role="checkbox" aria-checked="false" tabindex="-1" aria-label="Seleccionar ' + esc(d.id) + ', ' + esc(d.cuenta) + '">'
        + '<span class="lo-caja"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="lo-vis" d="M3.6 8.4l3 3 5.8-6.4" pathLength="1"/></svg></span></button></div>'
        + '<div class="lo-c lo-c-env" role="gridcell"><span class="lo-av" aria-hidden="true" style="--lo-av-f:var(--lo-av' + d.tono + '-f);--lo-av-t:var(--lo-av' + d.tono + '-t)">' + esc(d.ini) + '</span>'
        + '<div><p class="lo-cuenta">' + esc(d.cuenta) + '</p><p class="lo-id">' + esc(d.id) + '<span class="lo-mini"> · ' + esc(d.destino) + '<span class="lo-mini-p"> · ' + kilos(d.peso) + ' kg</span></span></p></div></div>'
        + '<div class="lo-c lo-c-dest" role="gridcell">' + esc(d.destino) + '</div>'
        + '<div class="lo-c lo-c-est" role="gridcell"><span class="lo-chip lo-chip-' + d.estado + '"><i></i>' + ESTADOS[d.estado] + '</span></div>'
        + '<div class="lo-c lo-c-peso" role="gridcell">' + kilos(d.peso) + ' kg</div>'
        + '<div class="lo-c lo-c-fecha" role="gridcell">' + esc(d.entrega) + '</div>';
      return { d, el, chk: el.querySelector('.lo-casilla'), sel: false, arch: false };
    }

    // una fila archivada sale del flujo (display: none); la selección que tenía se guarda aparte, en el aviso
    const ponArch = (f, v) => { f.arch = v; f.el.classList.toggle('is-arch', v); };

    // alterna el estado de una fila; el retraso hace que varias se marquen en cascada
    function setSel(f, v, retraso) {
      if (f.sel === v) return false;
      f.sel = v;
      f.el.style.setProperty('--lo-d', (quieto() ? 0 : (retraso || 0)) + 'ms');
      f.el.classList.toggle('is-sel', v);
      f.el.setAttribute('aria-selected', v);
      f.chk.setAttribute('aria-checked', v);
      return true;
    }

    /* ── los resortes de cada cuadro: el pincel y el peso ───────────────── */
    // el pincel es una pastilla SVG cuyo borde de arriba y cuyo borde de abajo son dos resortes:
    // el de la fila donde empezaste se queda quieto y el del puntero la estira con un poco de rebote
    const pTop = resorte(0, ...RESORTES.pincel), pBot = resorte(0, ...RESORTES.pincel), pPeso = resorte(0, ...RESORTES.peso);
    let raf = 0, tPrev = 0;
    const barro = pincel.firstElementChild;
    function dibujaPincel() {
      const alto = Math.max(2, pBot.x - pTop.x);
      barro.setAttribute('y', pTop.x.toFixed(1)); barro.setAttribute('height', alto.toFixed(1)); barro.setAttribute('rx', Math.min(17, alto / 2).toFixed(1));
    }
    function dibujaPeso() { pesoEl.textContent = kilos(Math.max(0, pPeso.x)); }
    function paso(t) {
      raf = 0;
      const h = Math.min(.034, Math.max(.004, (t - tPrev) / 1000 || .016)); tPrev = t;
      avanza(pTop, h); avanza(pBot, h); avanza(pPeso, h);
      dibujaPincel(); dibujaPeso();
      if (!(reposo(pTop, .3) && reposo(pBot, .3) && reposo(pPeso, .02))) raf = requestAnimationFrame(paso);
      else { pTop.x = pTop.meta; pBot.x = pBot.meta; pPeso.x = pPeso.meta; dibujaPincel(); dibujaPeso(); }
    }
    function arranca() { if (!raf) { tPrev = performance.now(); raf = requestAnimationFrame(paso); } }
    function pincelA(a, b, salta) {
      const vis = visibles(), A = vis[Math.min(a, b)].el, B = vis[Math.max(a, b)].el;
      pTop.meta = A.offsetTop + 7; pBot.meta = B.offsetTop + B.offsetHeight - 7;
      if (salta || quieto()) { pTop.x = pTop.meta; pBot.x = pBot.meta; pTop.v = pBot.v = 0; dibujaPincel(); }
      else arranca();
    }

    /* ── FLIP: lo que cambia de sitio llega con un resorte ───────────────── */
    // antes se mide dónde está cada fila; después del cambio, cada una parte de donde estaba
    function flip(cambia, entran, escalon) {
      const antes = new Map();
      filas.forEach(f => { if (!f.arch) antes.set(f, f.el.getBoundingClientRect().top); });
      cambia();
      if (quieto()) return;
      filas.forEach(f => {
        if (f.arch) return;
        f.el.getAnimations().forEach(a => { if (a.id === 'flip') a.cancel(); });
        if (!antes.has(f)) return;
        const dy = antes.get(f) - f.el.getBoundingClientRect().top;
        if (Math.abs(dy) < .5) return;
        f.el.animate([{ transform: 'translateY(' + dy.toFixed(1) + 'px)' }, { transform: 'none' }], { id: 'flip', duration: 900, easing: ESTA });
      });
      (entran || []).forEach((f, k) => {
        f.el.animate([{ transform: 'translateY(16px) scale(.985)', opacity: 0 }, { transform: 'none', opacity: 1 }], { id: 'entra', duration: 820, delay: k * (escalon || 0), easing: ENTRA, fill: 'backwards' });
      });
    }

    /* ── el estado de la pantalla: contador, barra, cabecera ────────────── */
    function midebarra() {
      const c = barra.dataset.modo === 'hecho' ? capaHecho : capaSel;
      barra.style.setProperty('--lo-w', c.offsetWidth + 'px');
    }
    function actualizaResumen() {
      const vis = visibles(), cuenta = {};
      vis.forEach(f => { cuenta[f.d.estado] = (cuenta[f.d.estado] || 0) + 1; });
      Object.keys(ESTADOS).forEach(k => { const p = resumen.querySelector('[data-estado="' + k + '"]'); if (p) { p.rodillo.pon(cuenta[k] || 0); p.classList.toggle('is-cero', !cuenta[k]); } });
      total.pon(vis.length);
      totalTxt.textContent = vis.length === 1 ? 'envío activo' : 'envíos activos';
    }
    function sincroniza() {
      const vis = visibles(), sel = marcadas(), n = sel.length;
      const peso = sel.reduce((s, f) => s + f.d.peso, 0);
      if (n) {                                    // al bajar la barra no se vacían las cifras
        contador.pon(n); uniEl.textContent = n === 1 ? 'seleccionada' : 'seleccionadas';
        pPeso.meta = peso;
        if (quieto()) { pPeso.x = peso; dibujaPeso(); } else arranca();
      }
      todas.setAttribute('aria-checked', n === 0 ? 'false' : (n === vis.length ? 'true' : 'mixed'));
      todas.setAttribute('aria-label', n === 0 ? 'Seleccionar todos los envíos' : 'Quitar la selección de todos los envíos');
      todas.disabled = !vis.length;
      const modo = guardado ? 'hecho' : (n ? 'sel' : '');
      barra.dataset.modo = modo;
      capaSel.inert = modo !== 'sel'; capaHecho.inert = modo !== 'hecho';
      pie.classList.toggle('is-barra', modo !== '');
      midebarra();
      vacio.hidden = vis.length > 0;
      // el lector de pantalla oye la cuenta una vez que el pincel se detiene
      if (n !== nPrevio) {
        nPrevio = n;
        clearTimeout(avisoId);
        avisoId = setTimeout(() => { if (!guardado) avisa(n ? n + (n === 1 ? ' envío seleccionado' : ' envíos seleccionados') + ', ' + kilos(peso) + ' kilos en total.' : 'Selección vacía.'); }, 380);
      }
      if (typeof o.alCambiar === 'function') o.alCambiar({ seleccion: sel.map(f => f.d), peso });
    }

    /* ── pintar: el gesto principal ─────────────────────────────────────── */
    function indiceEn(y) {
      const vis = visibles();
      for (let i = 0; i < vis.length; i++) if (y < vis[i].el.getBoundingClientRect().bottom) return i;
      return vis.length - 1;
    }
    function pinta(j) {
      const vis = visibles(), p = pintando;
      const a = Math.min(p.ancla, j), b = Math.max(p.ancla, j);
      const cambios = [];
      vis.forEach((f, i) => {
        const quiere = i >= a && i <= b ? p.modo : p.base.get(f);
        if (f.sel !== quiere) cambios.push([f, quiere, Math.abs(i - p.ancla)]);
      });
      cambios.sort((x, y) => x[2] - y[2]);
      // si un salto marca varias filas de golpe, entran en cascada; una a una (el caso normal) entran al momento
      let k = 0;
      cambios.forEach(([f, v]) => setSel(f, v, v && cambios.length > 1 ? k++ * 46 : 0));
      pincelA(a, b);
      sincroniza();
    }
    function terminaPincel(ev) {
      if (!pintando || (ev && ev.pointerId !== pintando.id)) return;
      try { lista.releasePointerCapture(pintando.id); } catch (e) { /* ya estaba suelto */ }
      pintando = null;
      pincel.classList.remove('is-activo');
    }

    lista.addEventListener('pointerdown', ev => {
      if (ev.button > 0 || !ev.isPrimary) return;
      const celda = ev.target.closest('.lo-c-chk');
      if (!celda) return;
      const fila = filas.find(f => f.el === celda.closest('.lo-fila'));
      if (!fila) return;
      const vis = visibles(), i = vis.indexOf(fila);
      cierraAviso();
      extFin = null;                             // (la fila lleva user-select: none y la columna touch-action: none)
      if (ev.shiftKey && ancla != null && vis[ancla]) {      // Mayús + clic: un rango, sin arrastrar
        const v = vis[ancla].sel || !fila.sel, a = Math.min(ancla, i), b = Math.max(ancla, i);
        vis.forEach((f, n) => { if (n >= a && n <= b) setSel(f, v, Math.abs(n - ancla) * 38); });
        sincroniza();
        return;
      }
      const modo = !fila.sel;
      pintando = { id: ev.pointerId, ancla: i, ult: i, modo, base: new Map(vis.map(f => [f, f.sel])) };
      ancla = i;
      try { lista.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura, el gesto sigue dentro de la tabla */ }
      pincel.classList.add('is-activo');
      pincelA(i, i, true);
      pinta(i);
    });
    lista.addEventListener('pointermove', ev => {
      if (!pintando || ev.pointerId !== pintando.id) return;
      const j = indiceEn(ev.clientY);
      if (j !== pintando.ult) { pintando.ult = j; pinta(j); }
    });
    lista.addEventListener('pointerup', terminaPincel);
    lista.addEventListener('pointercancel', terminaPincel);
    lista.addEventListener('lostpointercapture', terminaPincel);

    /* ── clic en la fila, teclado y casilla de la cabecera ──────────────── */
    function alterna(f, conMayus) {
      cierraAviso();
      const vis = visibles(), i = vis.indexOf(f);
      extFin = null;
      if (conMayus && ancla != null && vis[ancla]) {
        const v = vis[ancla].sel || !f.sel, a = Math.min(ancla, i), b = Math.max(ancla, i);
        vis.forEach((g, n) => { if (n >= a && n <= b) setSel(g, v, Math.abs(n - ancla) * 38); });
      } else { setSel(f, !f.sel, 0); ancla = i; }
      sincroniza();
    }
    lista.addEventListener('click', ev => {
      if (ev.detail === 0) {                    // el teclado (Espacio / Intro) sobre una casilla
        const b = ev.target.closest('.lo-casilla');
        const f = b && filas.find(x => x.chk === b);
        if (f) alterna(f, false);
        return;
      }
      if (ev.target.closest('.lo-c-chk')) return;   // el pincel ya lo atendió al pulsar
      const el = ev.target.closest('.lo-fila');
      const f = el && filas.find(x => x.el === el);
      if (f) alterna(f, ev.shiftKey);
    });
    lista.addEventListener('focusin', ev => {
      const b = ev.target.closest('.lo-casilla');
      const f = b && filas.find(x => x.chk === b);
      if (f) ponTab(f);
    });
    // una sola casilla entra en el orden del Tab; las flechas mueven el foco entre filas
    function ponTab(f) {
      fTab = f;
      filas.forEach(g => g.chk.tabIndex = g === f ? 0 : -1);
    }
    function extiende(j) {
      const vis = visibles();
      if (ancla == null || !vis[ancla]) return;
      const prev = extFin == null ? ancla : extFin;
      const lo = Math.min(ancla, j), hi = Math.max(ancla, j);
      for (let k = Math.min(ancla, prev); k <= Math.max(ancla, prev); k++) if (k < lo || k > hi) setSel(vis[k], false, 0);
      for (let k = lo; k <= hi; k++) setSel(vis[k], true, quieto() ? 0 : Math.abs(k - ancla) * 30);
      extFin = j;
    }
    lista.addEventListener('keydown', ev => {
      const b = ev.target.closest('.lo-casilla');
      if (!b) return;
      const vis = visibles(), i = vis.findIndex(f => f.chk === b);
      let j = i;
      switch (ev.key) {
        case 'ArrowDown': j = Math.min(vis.length - 1, i + 1); break;
        case 'ArrowUp': j = Math.max(0, i - 1); break;
        case 'Home': j = 0; break;
        case 'End': j = vis.length - 1; break;
        case 'a': case 'A':
          if (ev.metaKey || ev.ctrlKey) { ev.preventDefault(); cierraAviso(); vis.forEach((f, n) => setSel(f, true, n * 36)); ancla = null; sincroniza(); }
          return;
        case 'Escape': if (marcadas().length) { ev.preventDefault(); limpia(); } return;
        default: return;
      }
      ev.preventDefault();
      cierraAviso();
      if (ev.shiftKey) {
        if (ancla == null || !vis[ancla]) { ancla = i; setSel(vis[i], true, 0); }
        extiende(j); sincroniza();
      } else { extFin = null; }
      vis[j].chk.focus({ preventScroll: true });
    });
    todas.addEventListener('click', () => {
      const vis = visibles();
      if (!vis.length) return;
      cierraAviso();
      const n = marcadas().length;
      if (n === 0) vis.forEach((f, i) => setSel(f, true, i * 42));       // todo, en ola de arriba abajo
      else vis.forEach((f, i) => setSel(f, false, i * 26));              // con una parte o con todo, se quita
      ancla = null; extFin = null;
      sincroniza();
      todas.focus({ preventScroll: true });
    });

    function limpia() {
      const vis = visibles();
      vis.forEach((f, i) => setSel(f, false, i * 24));
      ancla = null; extFin = null;
      sincroniza();
    }
    function selecciona(ids) {
      cierraAviso();
      visibles().forEach(f => setSel(f, ids.indexOf(f.d.id) >= 0, 0));
      sincroniza();
    }

    /* ── archivar, deshacer y restaurar ─────────────────────────────────── */
    function cierraAviso() {
      if (!guardado) return;
      clearTimeout(tiempoId);
      guardado = null;
      barra.classList.remove('is-corre');
      sincroniza();
    }
    function archiva() {
      cierraAviso();
      const sel = marcadas(), n = sel.length;
      if (!n) return;
      const tenia = sel.some(f => f.el.contains(document.activeElement));
      const g = guardado = { filas: sel };
      avisa(n + (n === 1 ? ' envío archivado.' : ' envíos archivados.') + ' Puedes deshacerlo.');
      const hunde = quieto() ? 0 : (n - 1) * 55 + 380 + 40;
      // 1) las filas elegidas se hunden una tras otra
      if (!quieto()) sel.forEach((f, k) => f.el.animate(
        [{ transform: 'none', opacity: 1 }, { transform: 'translateY(12px) scale(.985)', opacity: 0 }],
        { id: 'hunde', duration: 380, delay: k * 55, easing: 'cubic-bezier(.5, 0, .85, .45)', fill: 'forwards' }));
      // 2) la barra se convierte en el aviso, con su ✓ (y empieza a vaciarse la línea del «Deshacer»)
      setTimeout(() => {
        if (guardado !== g) return;
        hechoTxt.textContent = n + (n === 1 ? ' envío archivado' : ' envíos archivados');
        barra.dataset.modo = 'hecho';
        barra.style.setProperty('--lo-espera', o.deshacer + 'ms');
        barra.classList.remove('is-corre'); void barra.offsetWidth; barra.classList.add('is-corre');
        capaSel.inert = true; capaHecho.inert = false;
        midebarra();
        tiempoId = setTimeout(cierraAviso, o.deshacer);
      }, quieto() ? 0 : Math.min(260, hunde - 80));
      // 3) y cuando ya se hundieron, las demás cierran el hueco
      setTimeout(() => {
        if (guardado !== g) return;
        const primera = filas.indexOf(sel[0]);
        flip(() => {
          // se desmarcan sin que se vea: ya están ocultas, y al volver lo harán con su cascada
          sel.forEach(f => { ponArch(f, true); f.el.getAnimations().forEach(a => a.cancel()); setSel(f, false, 0); });
        });
        const vis = visibles();
        if (tenia && vis.length) {
          const sig = filas.slice(primera).find(f => !f.arch) || vis[vis.length - 1];
          ponTab(sig); sig.chk.focus({ preventScroll: true });
        }
        ancla = null; extFin = null;
        sincroniza(); actualizaResumen();
        if (typeof o.alArchivar === 'function') o.alArchivar(sel.map(f => f.d));
      }, hunde);
    }
    function deshace() {
      const g = guardado;
      if (!g) return;
      clearTimeout(tiempoId);
      guardado = null;
      barra.classList.remove('is-corre');
      const yaArchivadas = g.filas.every(f => f.arch);
      // si aún se estaban hundiendo, vuelven tal cual estaban
      g.filas.forEach(f => f.el.getAnimations().forEach(a => { if (a.id === 'hunde') a.cancel(); }));
      if (!yaArchivadas) { sincroniza(); return; }
      flip(() => { g.filas.forEach(f => ponArch(f, false)); }, g.filas, 55);
      void lista.offsetWidth;                    // así la cascada de marcas parte de «sin marcar»
      g.filas.forEach((f, k) => setSel(f, true, k * 55 + 200));
      ancla = visibles().indexOf(g.filas[0]);
      sincroniza(); actualizaResumen();
      avisa(g.filas.length + (g.filas.length === 1 ? ' envío restaurado.' : ' envíos restaurados.'));
      if (typeof o.alDeshacer === 'function') o.alDeshacer(g.filas.map(f => f.d));
    }
    function restaura() {
      cierraAviso();
      const vuelven = filas.filter(f => f.arch);
      if (!vuelven.length) return;
      flip(() => { vuelven.forEach(f => ponArch(f, false)); }, vuelven, 60);
      ancla = null;
      sincroniza(); actualizaResumen();
      avisa('Envíos restaurados.');
      const f = vuelven[0]; ponTab(f); f.chk.focus({ preventScroll: true });
    }
    function exporta() {
      const n = marcadas().length;
      if (!n) return;
      btnExportar.classList.add('is-ok');
      clearTimeout(exportaId);
      exportaId = setTimeout(() => btnExportar.classList.remove('is-ok'), 1700);
      avisa(n + (n === 1 ? ' envío exportado.' : ' envíos exportados.'));
      if (typeof o.alExportar === 'function') o.alExportar(marcadas().map(f => f.d));
    }

    raiz.addEventListener('click', ev => {
      const b = ev.target.closest('[data-accion]');
      if (!b || b.disabled) return;
      switch (b.dataset.accion) {
        case 'archivar': archiva(); break;
        case 'exportar': exporta(); break;
        case 'limpiar': limpia(); break;
        case 'deshacer': deshace(); break;
        case 'restaurar': restaura(); break;
      }
    });
    // Esc en cualquier parte de la pantalla quita la selección
    raiz.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && !ev.target.closest('.lo-lista') && marcadas().length) limpia();
    });

    /* ── al empezar ─────────────────────────────────────────────────────── */
    Object.keys(ESTADOS).forEach(k => {
      const li = document.createElement('li');
      li.className = 'lo-pill lo-pill-' + k; li.dataset.estado = k;
      li.innerHTML = '<i></i>' + ESTADOS[k] + '<span class="lo-n"></span>';
      li.rodillo = Rodillo(li.querySelector('.lo-n'));
      resumen.appendChild(li);
    });
    o.envios.forEach(d => { const f = creaFila(d); lista.appendChild(f.el); filas.push(f); });
    ponTab(filas[0]);
    actualizaResumen();
    contador.pon(0);
    sincroniza();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(midebarra);
    addEventListener('resize', midebarra);

    return {
      limpia, archiva, deshace, selecciona,
      seleccionados: () => marcadas().map(f => f.d),
    };
  }

  window.Lote = Lote;
})();
