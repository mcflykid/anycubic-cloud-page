/* =====================================================================
   Remesa · Moxen
   Un panel de subida de archivos completo. A la izquierda, una zona de
   soltar con trazo discontinuo que «marcha» y una carpeta de la que sale
   una nube: al arrastrar archivos encima (dragenter y dragover reales) la
   zona crece, el trazo se enciende y la nube respira. Al soltar —o al
   elegirlos con el botón, que abre un <input type="file" multiple> de
   verdad— unas hojitas caen dentro de la nube y las filas aparecen en la
   lista con un resorte. Cada fila tiene el ícono de su tipo, el nombre, el
   tamaño y un anillo de progreso propio que se llena a velocidad variable;
   al terminar el anillo se vuelve un ✓ que se dibuja. Una subida falla a
   mitad (la fila se sacude y se tiñe de rojo suave) y «Reintentar» la
   reanuda donde iba. Arriba, una barra global con la cifra que rueda y el
   estado «3 de 5 listos». Una fila se cancela desplazándola hacia un lado
   (ratón o dedo), con el anillo (×) o con Supr. Cuando todo está listo la
   zona celebra: pulso azul, la nube se vuelve de un azul pleno y se dibuja un ✓
   grande. «Subir más» lo deja todo como al principio.

     <main data-remesa data-acepta=".pdf,image/*" data-max-mb="25"> … </main>
     const r = Remesa(document.querySelector('[data-remesa]'), {
       onSube: (archivo, progreso, señal) => subeTuArchivo(archivo, progreso, señal),
       acepta: '.pdf,image/*',   // tipos admitidos (también data-acepta; vacío = todos)
       maxMB: 25,                // peso máximo por archivo (también data-max-mb)
       velocidad: 1,             // solo en la simulación: 2 = el doble de rápido
       muestras: [ { nombre: 'a.pdf', tam: 2.4e6, dur: 2, falla: true } ],   // los de «Probar con archivos de ejemplo»
       alCambiar: estado => { … },   // al terminar, fallar o quitar una fila
     });
     r.anade([file1, file2]);   r.reinicia();   r.lista();

   CONECTAR LA SUBIDA REAL: pasa onSube(archivo, progreso, señal). Debe devolver una
   promesa: llama a progreso(0…1) mientras sube, resuelve al terminar y rechaza
   si falla (la fila muestra «Reintentar», que vuelve a llamar a onSube). La
   señal (AbortSignal) se cancela si la persona quita la fila. Sin onSube la
   subida es una simulación: no sale nada de tu equipo y, en cada tanda, una
   subida falla una vez para que se vea el estado de error.

   Personalizar: los colores (azul de la marca, azul de éxito y rojo de error, los
   seis colores por tipo de archivo y el modo oscuro) están en las variables
   del principio de remesa.css (--rm-*). La extensión de cada archivo decide
   su ícono (TIPOS, abajo). El azar tiene semilla: la simulación y el vídeo
   salen siempre igual. Solo se anima transform y opacity (y el ancho de las
   cifras); sin dependencias.
   ===================================================================== */
(function () {
  'use strict';

  /* ── resortes ─────────────────────────────────────────────────────── */
  // un resorte convertido en curva CSS linear(), para lo que se mueve con CSS o con la Web Animations API
  function muelle(k, c) {
    const pts = [0];
    let x = 0, v = 0, t = 0;
    while (t < 3) {
      v += (k * (1 - x) - c * v) / 240; x += v / 240; t += 1 / 240;
      pts.push(x);
      if (t > .15 && Math.abs(1 - x) < .001 && Math.abs(v) < .01) break;
    }
    const out = [];
    for (let i = 0; i <= 48; i++) out.push(pts[Math.round(i / 48 * (pts.length - 1))].toFixed(4));
    out[48] = '1';
    return { easing: 'linear(' + out.join(', ') + ')', duration: Math.round(t * 1000) };
  }
  // azar con semilla: las velocidades y los destellos salen siempre iguales
  function mulberry32(s) {
    return () => {
      s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const limita = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const numero = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
  const peso = b => b < 1024 ? b + ' B' : b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : numero.format(b / 1048576) + ' MB';

  /* ── el tipo de cada archivo: la extensión decide el ícono y el color ── */
  const TIPOS = {
    pdf: 'pdf',
    png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', svg: 'img', avif: 'img', heic: 'img',
    xls: 'hoja', xlsx: 'hoja', csv: 'hoja', ods: 'hoja', numbers: 'hoja',
    zip: 'zip', rar: 'zip', '7z': 'zip', gz: 'zip', tar: 'zip',
    txt: 'txt', md: 'txt', log: 'txt',
    doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', ppt: 'doc', pptx: 'doc',
  };
  const tipoDe = n => TIPOS[(n.split('.').pop() || '').toLowerCase()] || 'doc';
  // la hoja con la esquina doblada y, dentro, el dibujo del tipo (hereda el color de .rm-t-*)
  const HOJA = '<path class="rm-hoja" d="M14 9.5a3 3 0 0 1 3-3h10.5L34 13v23.5a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z"/><path class="rm-doblez" d="M27.5 6.5V11a2 2 0 0 0 2 2H34"/>';
  const ICONOS = {
    doc: '<path class="rm-trazo" d="M18.5 20.5h11M18.5 25.5h11M18.5 30.5h6.5"/>',
    img: '<circle class="rm-sol" cx="25.5" cy="21" r="2.6"/><path class="rm-relleno" d="M17.5 35.5l5.2-7.4 3.6 4.6 2.6-3.2 3.6 6z"/>',
    hoja: '<rect class="rm-relleno" x="18" y="19" width="12" height="4.6" rx="1.2" opacity=".28"/><path class="rm-trazo" stroke-width="1.7" d="M19.2 19h9.6a1.2 1.2 0 0 1 1.2 1.2v13a1.2 1.2 0 0 1-1.2 1.2h-9.6A1.2 1.2 0 0 1 18 33.2v-13A1.2 1.2 0 0 1 19.2 19zM18 24h12M18 29h12M24 19v15.4"/>',
    pdf: '<path class="rm-trazo" d="M18.5 19.5h11M18.5 23.2h7"/><rect class="rm-relleno" x="16.5" y="27" width="15" height="8.4" rx="2.2"/><text x="24" y="33.4" text-anchor="middle" font-size="5.9" font-weight="700" fill="#fff" style="font-family:Switzer,system-ui,sans-serif;letter-spacing:.02em">PDF</text>',
    zip: '<path class="rm-trazo" stroke-dasharray="2.1 2.1" d="M22 7v15"/><rect class="rm-relleno" x="19.4" y="22" width="5.2" height="9" rx="1.7"/><rect x="21.2" y="25.4" width="1.6" height="3.4" rx=".8" fill="#fff"/>',
    txt: '<path class="rm-trazo" d="M18.5 19.5h11M18.5 23.8h7.5M18.5 28.1h11M18.5 32.4h5"/>',
  };
  const iconoTipo = t => '<svg viewBox="3 1 40 44" aria-hidden="true">' + HOJA + ICONOS[t] + '</svg>';

  // los archivos de ejemplo (nombres genéricos): el cuarto falla una vez a mitad de camino
  const MUESTRAS = [
    { nombre: 'informe-trimestral.pdf', tam: 2516582, dur: 2.2 },
    { nombre: 'portada.png', tam: 1887436, dur: 1.7 },
    { nombre: 'presupuesto.xlsx', tam: 655360, dur: 1.3 },
    { nombre: 'recursos.zip', tam: 13212057, dur: 2.7, falla: true },
    { nombre: 'notas.txt', tam: 4096, dur: .8 },
  ];

  const IC = {
    x: '<path class="rm-a-x" d="M13.2 13.2l9.6 9.6M22.8 13.2l-9.6 9.6"/>',
    papelera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9.5 7V4.8h5V7M6.7 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h5.8a1.5 1.5 0 0 0 1.5-1.4l.9-12"/></svg>',
    reintenta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5M19.5 4.5v4.2h-4.2"/></svg>',
  };
  const C = 2 * Math.PI * 15;      // el perímetro del anillo (r = 15 en un lienzo de 38)

  function Remesa(raiz, opciones) {
    const o = Object.assign({
      onSube: null, acepta: raiz.dataset.acepta || '', maxMB: +raiz.dataset.maxMb || 0, velocidad: 1, semilla: 7,
      muestras: MUESTRAS, alCambiar: null,
    }, opciones);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const $ = s => raiz.querySelector(s);
    const FILA = muelle(190, 21), SUAVE = muelle(110, 15), SALTO = muelle(260, 15);
    raiz.style.setProperty('--rm-muelle', SUAVE.easing);

    const zona = $('[data-zona]'), borde = $('[data-borde]'), entrada = $('[data-entrada]'), ejemplo = $('[data-ejemplo]');
    const lista = $('[data-lista]'), vacio = $('[data-vacio]'), barra = $('[data-barra]'), estado = $('[data-estado]');
    const tit = $('[data-zona-tit]'), txt = $('[data-zona-txt]'), botonTxt = $('[data-boton-txt]'), ilu = $('[data-ilu]');
    const vuelos = $('.rm-vuelos'), chorroG = $('.rm-i-chorro'), nube = $('.rm-i-nube');
    const avisa = s => { const v = $('[data-vivo]'); v.textContent = ''; v.textContent = s; };
    if (o.acepta) entrada.accept = o.acepta;

    let F = [], sig = 0, listo = false, nListos = 0, reloj = 0, ultimo = 0, t = 0, azar = mulberry32(o.semilla), temporizadores = [];
    const luego = (fn, ms) => { const id = setTimeout(fn, ms); temporizadores.push(id); return id; };
    const porId = id => F.find(f => f.id === id);

    /* ── el trazo discontinuo: se mide para que los guiones cierren sin costura ── */
    function mideBorde() {
      const w = zona.offsetWidth, h = zona.offsetHeight, r = 24;
      borde.setAttribute('x', 1); borde.setAttribute('y', 1);
      borde.setAttribute('width', Math.max(0, w - 2)); borde.setAttribute('height', Math.max(0, h - 2)); borde.setAttribute('rx', r - 1);
      const per = 2 * (w + h) - (8 - 2 * Math.PI) * r;
      borde.setAttribute('pathLength', String(2 * Math.max(8, Math.round(per / 17))));
    }
    mideBorde();
    if (window.ResizeObserver) new ResizeObserver(mideBorde).observe(zona);

    /* ── la cifra que rueda: un cuentakilómetros continuo ─────────────
       Cada columna es una tira 0…9,0 que se desplaza con el valor suave
       (un resorte lo persigue); las decenas avanzan cuando las unidades
       pasan del 9, como en un odómetro de verdad. */
    const cols = Array.from(raiz.querySelectorAll('[data-d]')), tiras = cols.map(c => {
      const t = document.createElement('span'); t.className = 'rm-tira';
      t.innerHTML = '0123456789'.split('').concat('0').map(d => '<i>' + d + '</i>').join('');
      c.appendChild(t); return t;
    });
    let vistoPct = 0, metaPct = 0, velPct = 0, giroPct = 0, ultimoGiro = 0;
    function pintaTiras(v) {
      const u = v % 10, d = Math.floor(v / 10) % 10 + Math.max(0, u - 9), c = Math.max(0, Math.min(1, v - 99));
      [c, d, u].forEach((x, k) => { tiras[k].style.transform = 'translateY(' + (-x / 11 * 100).toFixed(3) + '%)'; });
    }
    function giraPct(ts) {
      giroPct = 0;
      const dt = Math.min(.05, Math.max(.001, (ts - ultimoGiro) / 1000)); ultimoGiro = ts;
      velPct += (60 * (metaPct - vistoPct) - 12 * velPct) * dt; vistoPct += velPct * dt;
      if (Math.abs(metaPct - vistoPct) < .02 && Math.abs(velPct) < .2) { vistoPct = metaPct; velPct = 0; }
      vistoPct = limita(vistoPct, 0, 100);
      pintaTiras(vistoPct);
      if (vistoPct !== metaPct) giroPct = requestAnimationFrame(giraPct);
    }
    function pintaPct(n) {
      metaPct = n;
      cols[0].classList.toggle('is-fuera', n < 100); cols[1].classList.toggle('is-fuera', n < 10);
      if (reduce) { vistoPct = n; pintaTiras(n); return; }
      if (!giroPct && vistoPct !== n) { ultimoGiro = performance.now(); giroPct = requestAnimationFrame(giraPct); }
    }
    cols[0].classList.add('is-fuera'); cols[1].classList.add('is-fuera'); pintaTiras(0);

    /* ── la zona: sus tres textos ────────────────────────────────────── */
    let modoZona = '';
    function textosZona(modo) {
      if (modo === modoZona) return;
      modoZona = modo;
      const n = F.filter(f => !f.rechazo).length;
      const T = {
        reposo: ['Suelta tus archivos aquí', 'o elígelos desde tu equipo', 'Elegir archivos'],
        mas: ['Suelta más archivos aquí', 'o elige otros desde tu equipo', 'Elegir más'],
        sobre: ['Suéltalos para subirlos', 'Aparecerán en la lista al instante', 'Elegir archivos'],
        listo: ['¡Todo subido!', n + (n === 1 ? ' archivo' : ' archivos') + ' en su sitio', 'Subir más'],
      }[modo];
      const antes = [tit.textContent, txt.textContent];
      tit.textContent = T[0]; txt.textContent = T[1]; botonTxt.textContent = T[2];
      if (!reduce && antes[0] !== T[0] && modo !== 'sobre') [tit, txt].forEach((el, k) => el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: k * 60, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'backwards' }));
    }
    const modoBase = () => listo ? 'listo' : F.length ? 'mas' : 'reposo';
    zona.setAttribute('aria-label', 'Elegir archivos o soltarlos aquí');

    /* ── pintar una fila ─────────────────────────────────────────────── */
    function htmlFila(f) {
      return '<li class="rm-fila" data-id="' + f.id + '">' +
        '<div class="rm-quitar" aria-hidden="true"><span>Quitar</span>' + IC.papelera + '</div>' +
        '<div class="rm-fila-in">' +
          '<span class="rm-tipo rm-t-' + f.tipo + '">' + iconoTipo(f.tipo) + '</span>' +
          '<div class="rm-info"><b class="rm-nombre" title="' + esc(f.nombre) + '">' + esc(f.nombre) + '</b>' +
            '<span class="rm-meta"><span>' + peso(f.tam) + '</span><span class="rm-sub" data-sub></span></span></div>' +
          '<button class="rm-reintenta" type="button" data-reintenta hidden>' + IC.reintenta + '<span>Reintentar</span></button>' +
          '<button class="rm-anillo" type="button" data-anillo>' +
            '<svg viewBox="0 0 38 38" aria-hidden="true"><circle class="rm-a-pista" cx="19" cy="19" r="15"/><circle class="rm-a-prog" cx="19" cy="19" r="15" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + C.toFixed(2) + '"/>' +
            '<circle class="rm-a-disco" cx="19" cy="19" r="15"/><path class="rm-a-ok" pathLength="1" d="M12.6 19.6l4.4 4.4 8.4-9"/>' + IC.x +
            '<path class="rm-a-ex" d="M19 11.8v8.2M19 25.2v.2"/></svg></button>' +
        '</div></li>';
    }
    function sub(f, txtSub) { if (f.sub !== txtSub) { f.sub = txtSub; f.li.querySelector('[data-sub]').textContent = txtSub; } }
    function pintaProg(f) {
      f.anillo.setAttribute('stroke-dashoffset', (C * (1 - f.p)).toFixed(2));
      if (f.estado === 'sube') sub(f, 'Subiendo · ' + Math.min(99, Math.floor(f.p * 100)) + ' %');
    }
    function pintaEstado(f) {
      const li = f.li, b = li.querySelector('[data-anillo]'), r = li.querySelector('[data-reintenta]');
      li.classList.toggle('is-listo', f.estado === 'listo');
      li.classList.toggle('is-falla', f.estado === 'falla');
      r.hidden = f.estado !== 'falla' || !!f.rechazo;
      if (f.estado === 'listo') { sub(f, 'Listo'); b.setAttribute('aria-label', 'Quitar ' + f.nombre + ' de la lista'); }
      else if (f.estado === 'falla') { sub(f, f.rechazo || 'Falló · ' + Math.floor(f.p * 100) + ' %'); b.setAttribute('aria-label', 'Quitar ' + f.nombre + ' de la lista'); r.setAttribute('aria-label', 'Reintentar la subida de ' + f.nombre); }
      else { if (f.estado === 'espera') sub(f, 'En cola'); b.setAttribute('aria-label', 'Cancelar la subida de ' + f.nombre); }
    }

    /* ── el estado global: barra, cifra y «3 de 5 listos» ────────────── */
    function global() {
      const act = F.filter(f => !f.rechazo), n = act.length, ok = act.filter(f => f.estado === 'listo').length;
      const fallan = F.filter(f => f.estado === 'falla').length;
      const suma = act.reduce((a, f) => a + (f.estado === 'listo' ? 1 : f.p), 0);
      const pct = !n ? 0 : ok === n ? 100 : Math.min(99, Math.floor(suma / n * 100));
      raiz.style.setProperty('--rm-p', (n ? suma / n : 0).toFixed(4));
      barra.setAttribute('aria-valuenow', pct);
      pintaPct(pct);
      const t = !F.length ? 'Aún no hay archivos' : n && ok === n ? n + ' de ' + n + ' listos' : ok + ' de ' + n + ' listos' + (fallan ? ' · ' + fallan + (fallan === 1 ? ' con error' : ' con error') : '');
      if (estado.textContent !== t) estado.textContent = t;
      raiz.classList.toggle('is-quieta', !F.some(f => f.estado === 'sube'));
      vacio.classList.toggle('is-oculto', F.length > 0);
    }
    function resumen() { return { total: F.length, archivos: F.map(f => ({ nombre: f.nombre, tam: f.tam, estado: f.estado, progreso: f.p })) }; }
    const cambio = () => { if (o.alCambiar) o.alCambiar(resumen()); };

    /* ── la simulación: velocidad variable con una onda por archivo ──── */
    function ciclo(ts) {
      reloj = 0;
      const dt = Math.min(.05, Math.max(0, (ts - ultimo) / 1000)); ultimo = ts; t += dt;
      let vivos = false;
      F.slice().forEach(f => {
        if (f.real) return;
        if (f.estado === 'espera') { f.espera -= dt; if (f.espera <= 0) { f.estado = 'sube'; pintaEstado(f); } else { vivos = true; return; } }
        if (f.estado !== 'sube') return;
        vivos = true;
        const onda = .5 + .5 * (.65 * Math.sin(t * f.w1 + f.f1) + .35 * Math.sin(t * f.w2 + f.f2));
        f.p = Math.min(1, f.p + f.base * (.32 + 1.36 * onda) * dt * o.velocidad);
        if (f.fallaEn && !f.yaFallo && f.p >= f.fallaEn) { f.yaFallo = true; f.p = f.fallaEn; falla(f); return; }
        pintaProg(f);
        if (f.p >= 1) termina(f);
      });
      global();
      if (vivos) enciende();
    }
    function enciende() { if (!reloj) reloj = requestAnimationFrame(ciclo); }
    function arranca(f) {
      f.estado = 'sube'; pintaEstado(f);
      if (!o.onSube) { f.real = false; ultimo = performance.now(); enciende(); return; }
      f.real = true;
      const ctrl = f.ctrl = new AbortController();
      const progreso = x => { if (f.estado === 'sube' && !ctrl.signal.aborted) { f.p = limita(+x || 0, 0, .995); pintaProg(f); global(); } };
      Promise.resolve().then(() => o.onSube(f.file || { name: f.nombre, size: f.tam }, progreso, ctrl.signal))
        .then(() => { if (!ctrl.signal.aborted && f.estado === 'sube') termina(f); },
              err => { if (!ctrl.signal.aborted && f.estado === 'sube') falla(f, err && err.message); });
    }
    function termina(f) {
      f.p = 1; f.estado = 'listo'; pintaProg(f); pintaEstado(f);
      f.li.classList.add('is-ping'); luego(() => f.li.classList.remove('is-ping'), 900);
      if (!reduce) f.li.querySelector('[data-anillo]').animate([{ transform: 'scale(.82)' }, { transform: 'none' }], SALTO);
      global(); cambio(); revisa();
    }
    function falla(f, mensaje) {
      f.estado = 'falla'; if (mensaje && f.real) f.mensaje = mensaje;
      pintaProg(f); pintaEstado(f);
      if (!reduce) {
        f.li.querySelector('.rm-fila-in').animate([{ transform: 'none' }, { transform: 'translateX(-9px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.36, .07, .19, .97)' });
        f.li.querySelector('[data-reintenta]').animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: SALTO.duration, easing: SALTO.easing, delay: 120, fill: 'backwards' });
      }
      avisa(f.nombre + ': la subida se interrumpió. Puedes reintentarla.');
      global(); cambio();
    }
    function reintenta(id) {
      const f = porId(id);
      if (!f || f.estado !== 'falla' || f.rechazo) return;
      f.base = 1 / (1.8 + azar() * .3);             // la segunda vez avanza sin tropiezos
      f.estado = 'sube'; f.intento = (f.intento || 1) + 1;
      pintaEstado(f); pintaProg(f);
      f.li.querySelector('[data-anillo]').focus({ preventScroll: true });
      avisa(f.nombre + ': reanudando la subida.');
      if (f.real || o.onSube) arranca(f); else { ultimo = performance.now(); enciende(); }
      global();
    }

    /* ── cuando todo está listo: la celebración ──────────────────────── */
    function revisa() {
      const act = F.filter(f => !f.rechazo);
      if (act.length && act.every(f => f.estado === 'listo')) {
        if (!listo) celebra();
        else if (act.length !== nListos) { nListos = act.length; modoZona = ''; textosZona('listo'); }   // quitaste una fila con todo listo: el recuento cambia
      } else if (listo) apaga();
    }
    function celebra() {
      listo = true; nListos = F.filter(f => !f.rechazo).length;
      zona.classList.add('is-listo'); raiz.classList.add('is-listo');
      modoZona = ''; textosZona('listo');
      zona.setAttribute('aria-label', 'Subir más archivos');
      avisa('Todo subido: ' + F.filter(f => !f.rechazo).length + ' archivos en su sitio.');
      if (!reduce) chorro();
    }
    function apaga() {
      listo = false;
      zona.classList.remove('is-listo'); raiz.classList.remove('is-listo');
      zona.setAttribute('aria-label', 'Elegir archivos o soltarlos aquí');
      modoZona = ''; textosZona(modoBase());
    }
    // una explosión de motas azules desde la nube
    function chorro() {
      const NS = 'http://www.w3.org/2000/svg', az = mulberry32(o.semilla * 31 + 5);
      for (let i = 0; i < 16; i++) {
        const c = document.createElementNS(NS, 'circle'), a = i / 16 * Math.PI * 2 + az() * .4, d = 70 + az() * 62, r = 2.4 + az() * 3.4;
        c.setAttribute('cx', 130); c.setAttribute('cy', 98); c.setAttribute('r', r.toFixed(1)); c.setAttribute('class', 'rm-chorro-p');
        c.style.transformBox = 'fill-box'; c.style.transformOrigin = 'center';
        chorroG.appendChild(c);
        const dx = Math.cos(a) * d, dy = Math.sin(a) * d * .8 - 10;
        c.animate([{ transform: 'translate(0,0) scale(.3)', opacity: 1 }, { transform: 'translate(' + (dx * .75).toFixed(1) + 'px,' + (dy * .75).toFixed(1) + 'px) scale(1)', opacity: 1, offset: .55 }, { transform: 'translate(' + dx.toFixed(1) + 'px,' + (dy + 14).toFixed(1) + 'px) scale(.1)', opacity: 0 }],
          { duration: 800 + az() * 360, delay: 180, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'both' }).onfinish = () => c.remove();
      }
    }

    /* ── añadir archivos: caen hojitas en la nube y aparecen las filas ── */
    function cumple(file) {
      const l = o.acepta.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (!l.length) return true;
      const n = file.name.toLowerCase(), m = (file.type || '').toLowerCase();
      return l.some(a => a[0] === '.' ? n.endsWith(a) : a.endsWith('/*') ? m.startsWith(a.slice(0, -1)) : m === a);
    }
    function nuevoArchivo(src, k, lote, demo) {
      const nombre = src.nombre || src.name, tam = src.tam != null ? src.tam : src.size;
      const f = {
        id: 'f' + (++sig), nombre, tam, tipo: tipoDe(nombre), file: demo ? null : src, p: 0, estado: 'espera', demo,
        espera: (reduce ? .1 : .6) + k * .1, base: 1 / (src.dur || limita(.8 + Math.sqrt(tam / 1048576) * .75, .8, 3.2)),
        w1: 2.2 + azar() * 2.6, w2: 5 + azar() * 4, f1: azar() * 6.28, f2: azar() * 6.28,
      };
      if (demo && src.falla) f.fallaEn = .5;
      else if (!demo && !o.onSube && lote.length >= 3 && k === lote.length - 1) f.fallaEn = .5 + azar() * .15;   // en la simulación, uno falla una vez
      if (!demo && o.maxMB && tam > o.maxMB * 1048576) { f.rechazo = 'Pesa más de ' + o.maxMB + ' MB'; f.estado = 'falla'; }
      else if (!demo && !cumple(src)) { f.rechazo = 'Tipo de archivo no admitido'; f.estado = 'falla'; }
      return f;
    }
    function anade(archivos, demo) {
      archivos = Array.from(archivos || []);
      if (!archivos.length) return;
      if (listo) apaga();
      // con los archivos de ejemplo no hay arrastre real: la zona reacciona igual un momento, como si los soltaras
      if (demo && !reduce) { zona.classList.add('is-sobre'); luego(() => zona.classList.remove('is-sobre'), 760); }
      const lote = archivos.map((a, k) => nuevoArchivo(a, k, archivos, !!demo));
      lote.forEach((f, k) => {
        F.push(f);
        lista.insertAdjacentHTML('beforeend', htmlFila(f));
        f.li = lista.lastElementChild; f.anillo = f.li.querySelector('.rm-a-prog');
        f.li.querySelector('.rm-nombre').title = f.nombre;
        pintaEstado(f); if (f.rechazo) sub(f, f.rechazo);
        swipe(f);
        if (!reduce) f.li.querySelector('.rm-fila-in').animate([{ opacity: 0, transform: 'translateY(-38px) scale(.95)' }, { opacity: 1, transform: 'none' }],
          { duration: FILA.duration, easing: FILA.easing, delay: 230 + k * 105, fill: 'backwards' });
        if (o.onSube && !f.rechazo) luego(() => { if (porId(f.id)) arranca(f); }, 330 + k * 105);
      });
      if (!o.onSube) { ultimo = performance.now(); enciende(); }
      lista.scrollTop = 0;
      vuelo(lote.filter(f => !f.rechazo).slice(0, 5));
      textosZona(modoBase());
      global(); cambio();
      avisa(lote.length + (lote.length === 1 ? ' archivo añadido' : ' archivos añadidos') + ' a la lista.');
    }
    // hojitas del color de cada tipo que caen dentro de la nube; al entrar, la nube hace «glup»
    function vuelo(lote) {
      if (reduce || !lote.length) return;
      const r = ilu.getBoundingClientRect(), cx = r.left + r.width * .5, cy = r.top + r.height * .36;
      lote.forEach((f, k) => {
        const el = document.createElement('div'), lado = (k % 2 ? 1 : -1) * (40 + k * 18);
        el.className = 'rm-vuela rm-tipo rm-t-' + f.tipo; el.innerHTML = iconoTipo(f.tipo);
        vuelos.appendChild(el);
        const x0 = cx + lado * 1.5, y0 = r.top - 70 - k * 14, rot = (k % 2 ? 1 : -1) * (16 + k * 5);
        el.animate([
          { transform: 'translate(' + x0 + 'px,' + y0 + 'px) rotate(' + rot + 'deg) scale(.8)', opacity: 0 },
          { transform: 'translate(' + (cx + lado * .7) + 'px,' + (cy - 40) + 'px) rotate(' + (rot * .4) + 'deg) scale(1)', opacity: 1, offset: .5 },
          { transform: 'translate(' + cx + 'px,' + (cy + 12) + 'px) rotate(0deg) scale(.28)', opacity: 0 },
        ], { duration: 640, delay: k * 85, easing: 'cubic-bezier(.45, 0, .6, 1)', fill: 'both' }).onfinish = () => el.remove();
      });
      const llega = 640 + (lote.length - 1) * 85 - 120;
      nube.animate([{ transform: 'none' }, { transform: 'scale(1.1, .9)' }, { transform: 'scale(.96, 1.06)' }, { transform: 'none' }], { duration: 560, delay: llega - 100, easing: 'ease-out' });
    }

    /* ── quitar una fila: sale hacia un lado y las demás suben (FLIP) ── */
    function flip(cambia) {
      const els = Array.from(lista.children), antes = new Map(els.map(e => [e, e.getBoundingClientRect().top]));
      cambia();
      if (reduce) return;
      Array.from(lista.children).forEach(e => {
        if (!antes.has(e)) return;
        const dy = antes.get(e) - e.getBoundingClientRect().top;
        if (Math.abs(dy) > .5) e.animate([{ transform: 'translateY(' + dy.toFixed(1) + 'px)' }, { transform: 'none' }], FILA);
      });
    }
    function quita(id, via, desde) {
      const f = porId(id);
      if (!f) return;
      if (f.ctrl) f.ctrl.abort();
      const foco = lista.contains(document.activeElement);
      const i = F.indexOf(f), vecino = F[i + 1] || F[i - 1];
      F.splice(i, 1);
      avisa((f.estado === 'sube' || f.estado === 'espera' ? 'Cancelado: ' : 'Quitado: ') + f.nombre + '.');
      const fin = () => { flip(() => f.li.remove()); if (foco && vecino && vecino.li.isConnected) vecino.li.querySelector('[data-anillo]').focus({ preventScroll: true }); else if (foco) zona.focus({ preventScroll: true }); };
      if (reduce) fin();
      else {
        f.li.style.pointerEvents = 'none';
        const inn = f.li.querySelector('.rm-fila-in');
        inn.animate([{ transform: 'translateX(' + (desde || 0) + 'px)', opacity: 1 }, { transform: 'translateX(-60%)', opacity: 0 }], { duration: 300, easing: 'cubic-bezier(.5, 0, .9, .5)', fill: 'forwards' }).onfinish = fin;
        f.li.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 40, fill: 'forwards' });
      }
      global(); cambio(); revisa();
      if (!F.length) { if (listo) apaga(); textosZona('reposo'); }
    }

    /* ── deslizar una fila a un lado para quitarla (ratón y dedo) ────── */
    function swipe(f) {
      const li = f.li, inn = li.querySelector('.rm-fila-in');
      let g = null;
      inn.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.closest('button')) return;
        g = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, vivo: false, t: e.timeStamp, v: 0 };
      });
      inn.addEventListener('pointermove', e => {
        if (!g || e.pointerId !== g.id) return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (!g.vivo) {
          if (Math.abs(dx) > 7 && Math.abs(dx) > Math.abs(dy) * 1.2) { g.vivo = true; inn.setPointerCapture(e.pointerId); li.classList.add('is-arrastra'); }
          else { if (Math.abs(dy) > 12) g = null; return; }
        }
        g.v = (dx - g.dx) / Math.max(1, e.timeStamp - g.t); g.t = e.timeStamp; g.dx = dx;
        const x = dx < 0 ? dx : dx * .16;
        inn.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
        li.style.setProperty('--rm-sw', limita(-x / 90, 0, 1).toFixed(3));
      });
      const suelta = e => {
        if (!g || e.pointerId !== g.id) return;
        const d = g; g = null;
        if (!d.vivo) return;
        li.classList.remove('is-arrastra');
        const x = d.dx < 0 ? d.dx : d.dx * .16;
        if (e.type !== 'pointercancel' && (d.dx < -92 || (d.dx < -40 && d.v < -.6))) { inn.style.transform = ''; quita(f.id, 'deslizar', x); return; }
        inn.style.transform = ''; li.style.setProperty('--rm-sw', 0);
        if (!reduce) inn.animate([{ transform: 'translateX(' + x.toFixed(1) + 'px)' }, { transform: 'none' }], FILA);
      };
      inn.addEventListener('pointerup', suelta); inn.addEventListener('pointercancel', suelta);
    }
    lista.addEventListener('click', e => {
      const li = e.target.closest('.rm-fila');
      if (!li) return;
      const id = li.dataset.id, f = porId(id);
      if (e.target.closest('[data-reintenta]')) reintenta(id);
      else if (e.target.closest('[data-anillo]') && f) quita(id, 'boton');
    });
    lista.addEventListener('keydown', e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.closest('[data-anillo]')) { e.preventDefault(); quita(e.target.closest('.rm-fila').dataset.id, 'teclado'); }
    });

    /* ── la zona: pulsar, teclado y arrastrar de verdad ──────────────── */
    function eligeOSube() { if (listo) reinicia(); else entrada.click(); }
    zona.addEventListener('click', eligeOSube);
    zona.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); eligeOSube(); } });
    entrada.addEventListener('change', () => { anade(entrada.files); entrada.value = ''; });
    ejemplo.addEventListener('click', () => { if (listo) apaga(); anade(o.muestras.slice(), true); });

    let prof = 0;
    const traeArchivos = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') > -1;
    const limpiaArrastre = () => { prof = 0; zona.classList.remove('is-sobre', 'is-cerca'); textosZona(modoBase()); };
    document.addEventListener('dragenter', e => { if (traeArchivos(e)) { prof++; zona.classList.add('is-cerca'); } });
    document.addEventListener('dragleave', e => { if (traeArchivos(e) && --prof <= 0) limpiaArrastre(); });
    document.addEventListener('dragover', e => {
      if (!traeArchivos(e)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      const sobre = zona.contains(e.target);
      if (sobre !== zona.classList.contains('is-sobre')) { zona.classList.toggle('is-sobre', sobre); if (!listo) textosZona(sobre ? 'sobre' : modoBase()); }
    });
    document.addEventListener('drop', e => {
      if (!traeArchivos(e)) return;
      e.preventDefault();
      const archivos = Array.from(e.dataTransfer.files || []);
      limpiaArrastre();
      if (archivos.length) anade(archivos);
    });

    /* ── volver al principio («Subir más») ───────────────────────────── */
    function reinicia() {
      temporizadores.forEach(clearTimeout); temporizadores = [];
      if (reloj) { cancelAnimationFrame(reloj); reloj = 0; }
      F.forEach(f => { if (f.ctrl) f.ctrl.abort(); });
      const filas = Array.from(lista.children);
      const vacia = () => {
        lista.textContent = ''; F = []; sig = 0; azar = mulberry32(o.semilla); t = 0;
        listo = false; zona.classList.remove('is-listo'); raiz.classList.remove('is-listo');
        zona.setAttribute('aria-label', 'Elegir archivos o soltarlos aquí');
        modoZona = ''; textosZona('reposo'); global(); cambio();
      };
      // se despiden de abajo arriba y la zona vuelve a su reposo
      if (reduce || !filas.length) return vacia();
      zona.classList.remove('is-listo'); raiz.classList.remove('is-listo'); listo = false;
      filas.forEach((li, k) => { li.style.pointerEvents = 'none'; li.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-34px) scale(.96)' }], { duration: 300, delay: (filas.length - 1 - k) * 55, easing: 'cubic-bezier(.5, 0, .9, .5)', fill: 'forwards' }); });
      luego(vacia, 300 + (filas.length - 1) * 55);
      avisa('Lista vacía. Puedes subir más archivos.');
    }

    textosZona('reposo'); global();
    return { anade: arch => anade(arch, false), reinicia, quita, lista: () => resumen(), reintenta };
  }

  Remesa.MUESTRAS = MUESTRAS;
  window.Remesa = Remesa;
})();
