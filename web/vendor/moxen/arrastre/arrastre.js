/* =====================================================================
   Arrastre · Moxen
   Una zona para soltar archivos que te siente llegar: a medida que el
   puntero se acerca, se inclina hacia él, una luz la recorre por dentro,
   los guiones del borde se funden en una línea y las tres hojas del
   centro se abren en abanico y se dejan atraer. Al soltar (o al hacer
   clic), cada archivo cae dentro volando como una hoja de papel —sale
   del puntero, describe un arco con gravedad, gira y se asienta con un
   aplastón— y se queda como el ícono de su fila. Mientras sube, sus
   renglones se van «imprimiendo»; el borde de la zona es la barra del
   total. Al terminar, cada fila salta con su ✓ y la zona da un pulso.
   Sin dependencias.

     const z = Arrastre(document.querySelector('[data-arrastre]'), {
       sube: (archivo, avance) => …,   // tu subida real; llama avance(0..1)
       vuelve: 0,                      // ms tras terminar para vaciarse sola (0: no)
     });
     z.agrega(archivos);   z.limpia();

   Sin `sube`, la subida se simula. Con `simula: [{ name, size }, …]`, un
   clic añade esos archivos de ejemplo en vez de abrir el selector.
   ===================================================================== */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const peso = b => b < 1e6 ? Math.max(1, Math.round(b / 1e3)) + ' KB' : (b / 1e6).toFixed(1).replace('.', ',') + ' MB';
  const acota = (v, a, b) => Math.max(a, Math.min(b, v));
  const suave = (a, b, x) => { const t = acota((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // azar con semilla: la demostración sale igual cada vez
  function azar(s) { return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // resortes: [rigidez, amortiguación]
  const CERCA = [90, 2 * .95 * Math.sqrt(90)];        // la cercanía: se enciende y se apaga sin rebote
  const LADEA = [140, 2 * .62 * Math.sqrt(140)];      // la inclinación: con un poco de inercia
  const IMAN = [170, 2 * .5 * Math.sqrt(170)];        // el abanico que se deja atraer
  const ASIENTA = [650, 2 * .24 * Math.sqrt(650)];    // el aplastón de la hoja al caer
  const BOTA = [420, 2 * .4 * Math.sqrt(420)];        // el saltito de la hoja al terminar
  const GRAVEDAD = 3000;                              // px/s², la del vuelo
  const VUELA = .52;                                  // s que dura el vuelo de cada hoja
  const ALCANCE = 260;                                // px a los que la zona empieza a sentir el puntero

  /* Una hoja de papel: el cuerpo con la esquina cortada, la esquina
     doblada, cuatro renglones (se imprimen con el progreso) y el sello. */
  const RENGLONES = [26, 31, 21, 28];
  function hoja(tipo) {
    const d = document.createElement('div');
    d.className = 'ar-papel';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 50 62');
    svg.innerHTML =
      '<path class="ar-hoja" d="M6 0H34L50 16V56a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6Z"/>' +
      '<path class="ar-doblez" d="M34 0V11a5 5 0 0 0 5 5H50Z"/>' +
      RENGLONES.map((w, i) => '<rect class="ar-renglon" x="8" y="' + (21 + i * 6.6) + '" width="' + w + '" height="2.6" rx="1.3"/>').join('') +
      '<rect class="ar-sello" x="6" y="47.5" width="' + (8 + tipo.length * 6.4).toFixed(1) + '" height="10" rx="3"/>' +
      '<text class="ar-sello-texto" x="' + (10 + tipo.length * 3.2).toFixed(1) + '" y="55.2" text-anchor="middle"></text>';
    svg.querySelector('text').textContent = tipo.toUpperCase();
    d.appendChild(svg);
    return d;
  }

  function Arrastre(zona, opciones) {
    const o = Object.assign({ simula: null, sube: null, vuelve: 0 }, opciones);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const q = s => zona.querySelector(s);
    const escena = zona.parentElement;
    const luz = q('.ar-luz'), guiones = q('.ar-guiones'), continuo = q('.ar-continuo'), progreso = q('.ar-progreso');
    const rects = zona.querySelectorAll('.ar-borde rect');
    const abanico = q('.ar-abanico'), hojasVacias = zona.querySelectorAll('.ar-hoja-vacia'), flecha = q('.ar-flecha');
    const lista = q('.ar-lista'), vuelo = q('.ar-vuelo'), input = q('input[type="file"]');
    const estado = escena.querySelector('[data-arrastre-estado]');
    const estadoTexto = estado && estado.querySelector('.ar-estado-texto');
    const reposo = estadoTexto ? estadoTexto.textContent : '';

    let archivos = [], rnd = azar(7), raf = 0, antes = 0, ahora = 0, vuelta = 0, saliendo = false;
    let W = 0, H = 0, X0 = 0, Y0 = 0, altoBase = 0;      // medidas de la zona (sin transformar)
    let px = -1e4, py = -1e4, conPuntero = false, encima = false;
    // cercanía, inclinación, imán y abanico, con sus velocidades
    let P = 0, vP = 0, rx = 0, vrx = 0, ry = 0, vry = 0, mx = 0, vmx = 0, my = 0, vmy = 0, F = 0, vF = 0;

    /* ── medidas (en eventos, nunca en el bucle) ──────────────────── */
    function mide() {
      W = zona.offsetWidth; H = zona.offsetHeight;
      // la posición sin la inclinación: se suma la cadena de offsets
      let x = 0, y = 0;
      for (let e = zona; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
      X0 = x; Y0 = y;
      const r = parseFloat(getComputedStyle(zona).borderTopLeftRadius) || 0;
      rects.forEach(el => {
        el.setAttribute('x', .8); el.setAttribute('y', .8);
        el.setAttribute('width', Math.max(0, W - 1.6)); el.setAttribute('height', Math.max(0, H - 1.6));
        el.setAttribute('rx', Math.max(0, r - .8));
      });
      archivos.forEach(ubica);
    }
    // dónde queda el ícono de una fila, en coordenadas de la zona
    function ubica(a) {
      const h = a.hueco;
      a.sx = lista.offsetLeft + a.li.offsetLeft + h.offsetLeft + h.offsetWidth / 2;
      a.sy = lista.offsetTop + a.li.offsetTop + h.offsetTop + h.offsetHeight / 2;
    }

    function dice(texto, clase) {
      if (!estado) return;
      if (estadoTexto.textContent !== texto) estadoTexto.textContent = texto;
      estado.classList.toggle('is-subiendo', clase === 'subiendo');
      estado.classList.toggle('is-lista', clase === 'lista');
    }

    /* ── llegan archivos ───────────────────────────────────────────── */
    function agrega(lote, desde) {
      lote = Array.from(lote);
      if (!lote.length) return;
      clearTimeout(vuelta);
      if (saliendo) termina();
      const origen = desde || { x: W / 2, y: H * .42 };
      zona.classList.remove('is-encima', 'is-lista', 'is-volviendo');
      zona.classList.add('is-ocupada');
      escena.classList.add('is-ocupada');
      encima = false;
      const nuevos = lote.map(f => {
        const li = document.createElement('li');
        li.className = 'ar-fila';
        li.innerHTML = '<span class="ar-hueco"></span><span class="ar-datos"><span class="ar-arriba"><span class="ar-nombre"></span>' +
          '<span class="ar-peso"></span></span><span class="ar-barra"><i></i><b></b></span></span>' +
          '<span class="ar-fin"><span class="ar-cifra">0 %</span><span class="ar-visto"><svg viewBox="0 0 24 24"><path d="M6.5 12.6l3.6 3.6 7.4-8" pathLength="1"/></svg></span></span>';
        li.querySelector('.ar-nombre').textContent = f.name;
        li.querySelector('.ar-peso').textContent = peso(f.size || 0);
        lista.appendChild(li);
        const tipo = ((f.name.split('.').pop() || '') + '').slice(0, 4) || 'arch';
        const papel = hoja(tipo);
        papel.style.opacity = 0;
        vuelo.appendChild(papel);
        // lo pequeño sube antes: la duración crece con el logaritmo del peso
        const dura = (.55 + .42 * Math.log10(Math.max(f.size || 1, 1e4) / 1e4)) * (.85 + .3 * rnd());
        const a = {
          f, li, papel, hueco: li.querySelector('.ar-hueco'), barra: li.querySelector('.ar-barra i'),
          pesoEl: li.querySelector('.ar-peso'), cifra: li.querySelector('.ar-cifra'),
          renglones: Array.from(papel.querySelectorAll('.ar-renglon')),
          total: f.size || 1, hecho: 0, dura, fase: rnd() * 6, real: false,
          sube: false, llego: false, lista: false, pc: -1,
          sq: 0, vsq: 0, b: 0, vb: 0, sale: 0,
        };
        if (o.sube) { a.real = true; o.sube(f, p => { a.hecho = acota(p, 0, 1) * a.total; anima(); }); }
        return a;
      });
      archivos = archivos.concat(nuevos);
      // si no caben, la zona crece (una sola vez, al llegar)
      const n = archivos.length, mov = matchMedia('(max-width: 640px)').matches;
      const necesita = n * (mov ? 74 : 82) + (n - 1) * (mov ? 10 : 12) + 80;
      if (necesita > altoBase) zona.style.height = necesita + 'px';
      mide();
      /* El vuelo: de dónde soltaste a su hueco en un tiempo fijo, con
         gravedad. Con el tiempo y la gravedad fijos, la velocidad inicial
         sale sola (un tiro parabólico), así que siempre aterriza justo. */
      const t0 = performance.now();
      nuevos.forEach((a, i) => {
        a.t0 = t0 + i * 110;
        a.T = VUELA + i * .04;
        a.x0 = origen.x + (rnd() - .5) * 30; a.y0 = origen.y + (rnd() - .5) * 16;
        a.vx = (a.sx - a.x0) / a.T;
        a.vy = (a.sy - a.y0) / a.T - GRAVEDAD * a.T / 2;
        a.giro = (rnd() - .5) * 70 + (a.sx < a.x0 ? -18 : 18);
        if (reduce) a.t0 = t0 - 1e4;
      });
      anima();
    }

    function aterriza(a, vyFinal) {
      a.llego = true; a.sube = true;
      a.vsq -= Math.min(5.5, vyFinal * .0042);          // se aplasta según lo fuerte que cae
      a.li.classList.add('is-llega', 'is-subiendo');
    }

    /* ── el cuadro ─────────────────────────────────────────────────── */
    function paso(t) {
      raf = 0;
      const dt = antes ? Math.min((t - antes) / 1000, 1 / 30) : 1 / 60;
      antes = t; ahora = t;
      const ocupada = archivos.length > 0;

      // a dónde quiere ir cada cosa según el puntero
      let metaP = 0, nx = 0, ny = 0;
      if (conPuntero) {
        const dx = Math.max(-px, 0, px - W), dy = Math.max(-py, 0, py - H);
        metaP = 1 - suave(0, ALCANCE, Math.hypot(dx, dy));
        nx = acota((px - W / 2) / (W / 2), -1.3, 1.3);
        ny = acota((py - H / 2) / (H / 2), -1.3, 1.3);
      }
      const k = ocupada ? .3 : 1;                          // ocupada se inclina menos: se lee la lista
      const metaRX = -ny * 4.5 * metaP * k, metaRY = nx * 6 * metaP * k;
      const metaF = ocupada ? 0 : metaP * (encima ? 1.35 : 1);
      const cx = W / 2, cy = H * .36;
      const metaMX = acota((px - cx) * .07, -28, 28) * metaP, metaMY = acota((py - cy) * .07, -18, 18) * metaP;

      const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
      for (let s = 0; s < n; s++) {
        vP += (CERCA[0] * (metaP - P) - CERCA[1] * vP) * h; P += vP * h;
        vrx += (LADEA[0] * (metaRX - rx) - LADEA[1] * vrx) * h; rx += vrx * h;
        vry += (LADEA[0] * (metaRY - ry) - LADEA[1] * vry) * h; ry += vry * h;
        vmx += (IMAN[0] * (metaMX - mx) - IMAN[1] * vmx) * h; mx += vmx * h;
        vmy += (IMAN[0] * (metaMY - my) - IMAN[1] * vmy) * h; my += vmy * h;
        vF += (IMAN[0] * (metaF - F) - IMAN[1] * vF) * h; F += vF * h;
        archivos.forEach(a => {
          a.vsq += (-ASIENTA[0] * a.sq - ASIENTA[1] * a.vsq) * h; a.sq += a.vsq * h;
          a.vb += (-BOTA[0] * a.b - BOTA[1] * a.vb) * h; a.b += a.vb * h;
        });
      }
      if (reduce) { P = metaP; rx = ry = mx = my = F = 0; vP = vrx = vry = vmx = vmy = vF = 0; }

      zona.style.transform = 'rotateX(' + rx.toFixed(3) + 'deg) rotateY(' + ry.toFixed(3) + 'deg)';
      luz.style.transform = 'translate(' + acota(px, -120, W + 120).toFixed(1) + 'px,' + acota(py, -120, H + 120).toFixed(1) + 'px)';
      luz.style.opacity = (P * .95).toFixed(3);
      continuo.style.opacity = (P * .85 * (ocupada ? .4 : 1)).toFixed(3);
      guiones.style.opacity = (1 - P * .75).toFixed(3);

      // el abanico: las hojas de los lados giran y se apartan; la del medio sube
      abanico.style.transform = 'translate(' + mx.toFixed(2) + 'px,' + my.toFixed(2) + 'px)';
      hojasVacias.forEach((e, i) => {
        const l = i - 1;
        e.style.transform = 'translate(' + (l * 17 * F).toFixed(2) + 'px,' + (-(l ? 4 : 12) * F).toFixed(2) + 'px) rotate(' + (l * 15 * F + l * 4).toFixed(2) + 'deg)';
      });
      flecha.style.transform = 'translate(' + (mx * .35).toFixed(2) + 'px,' + (6 * F).toFixed(2) + 'px) scale(' + (1 + .1 * F).toFixed(3) + ')';

      // las hojas: en vuelo, aterrizando, subiendo o saliendo
      let total = 0, hecho = 0, quedan = 0, vivos = false;
      archivos.forEach(a => {
        const u = (t - a.t0) / 1000;
        let x, y, giro = 0, esc = 1, op = 1;
        if (a.sale) {
          const v = acota((t - a.sale) / 420, 0, 1);
          x = a.sx; y = a.sy - 38 * v * v - a.b * 14; giro = 10 * v * (a.sx > W / 2 ? 1 : -1); esc = 1 - .12 * v; op = 1 - v;
          if (v < 1) vivos = true;
        } else if (u < 0) { x = a.x0; y = a.y0; op = 0; vivos = true; }
        else if (u < a.T) {
          // el tiro: x lineal, y con gravedad; gira hasta quedar derecha y se agranda al acercarse a la cámara
          x = a.x0 + a.vx * u; y = a.y0 + a.vy * u + GRAVEDAD * u * u / 2;
          const v = u / a.T;
          giro = a.giro * Math.pow(1 - v, 2);
          esc = .62 + .38 * v + .28 * Math.sin(Math.PI * v);
          op = acota(u / .08, 0, 1);
          vivos = true;
        } else {
          if (!a.llego) aterriza(a, a.vy + GRAVEDAD * a.T);
          x = a.sx; y = a.sy - a.b * 14;
        }
        const sq = a.sq;
        a.papel.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px) rotate(' + giro.toFixed(2) + 'deg) scale(' +
          (esc * (1 - sq * .5)).toFixed(4) + ',' + (esc * (1 + sq)).toFixed(4) + ')';
        a.papel.style.opacity = op.toFixed(3);

        // la subida simulada: la velocidad sube y baja con una onda propia, como una conexión de verdad
        if (a.sube && !a.real && a.hecho < a.total) {
          a.fase += dt;
          const ritmo = .5 + .95 * (.5 + .5 * Math.sin(a.fase * 3.3));
          a.hecho = Math.min(a.total, a.hecho + a.total / a.dura * dt * ritmo);
        }
        const p = a.llego ? a.hecho / a.total : 0;
        if (a.llego && !a.sale) {
          a.barra.style.transform = 'scaleX(' + p.toFixed(4) + ')';
          a.renglones.forEach((r, i) => { r.style.transform = 'scaleX(' + acota(p * 4.4 - i * 1.05, 0, 1).toFixed(3) + ')'; });
          const pc = Math.floor(p * 100);
          if (pc !== a.pc) {
            a.pc = pc;
            a.cifra.textContent = pc + ' %';
            a.pesoEl.textContent = p >= 1 ? peso(a.total) + ' · listo' : peso(a.hecho) + ' de ' + peso(a.total);
          }
          if (p >= 1 && !a.lista) {
            a.lista = true;
            a.li.classList.remove('is-subiendo');
            a.li.classList.add('is-lista');
            if (!reduce) { a.vb += 7; a.vsq += 2; }          // la hoja da un saltito de alegría
          }
        }
        total += a.total; hecho += a.llego ? a.hecho : 0;
        if (!a.lista) quedan++;
        if (Math.abs(a.sq) + Math.abs(a.vsq) + Math.abs(a.b) + Math.abs(a.vb) > .002) vivos = true;
      });

      const pt = total ? hecho / total : 0;
      if (!saliendo) progreso.style.strokeDasharray = pt.toFixed(4) + ' 1';
      const na = archivos.length;
      if (na && !saliendo) {
        if (quedan) dice('Subiendo ' + na + (na === 1 ? ' archivo' : ' archivos') + ' · ' + Math.floor(pt * 100) + ' %', 'subiendo');
        else if (!zona.classList.contains('is-lista')) {
          zona.classList.add('is-lista');
          dice((na === 1 ? '1 archivo listo' : na + ' archivos listos') + ' · ' + peso(total), 'lista');
          if (o.vuelve) vuelta = setTimeout(limpia, o.vuelve);
        }
      }

      const quieto = !vivos && !quedan && Math.abs(metaP - P) < .001 && Math.abs(vP) < .01 &&
        Math.abs(metaRX - rx) + Math.abs(metaRY - ry) < .005 && Math.abs(vrx) + Math.abs(vry) < .01 &&
        Math.abs(metaMX - mx) + Math.abs(metaMY - my) + Math.abs(metaF - F) < .005 && Math.abs(vmx) + Math.abs(vmy) + Math.abs(vF) < .01;
      if (!quieto) raf = requestAnimationFrame(paso);
      else antes = 0;
    }
    function anima() { if (!raf) { antes = 0; raf = requestAnimationFrame(paso); } }

    /* ── vaciar ────────────────────────────────────────────────────── */
    /* Las fichas se van hacia arriba una tras otra con su hoja, el borde
       se apaga y vuelve el estado vacío. */
    let fin = 0;
    function limpia() {
      clearTimeout(vuelta);
      if (!archivos.length || saliendo) return;
      saliendo = true;
      zona.classList.add('is-saliendo');
      const t = performance.now();
      archivos.forEach((a, i) => {
        a.sale = t + i * 70;
        a.li.style.setProperty('--sale', (i * 70) + 'ms');
        a.li.classList.add('is-sale');
      });
      if (o.sube && o.cancela) archivos.forEach(a => o.cancela(a.f));
      fin = setTimeout(termina, reduce ? 0 : 420 + archivos.length * 70);
      anima();
    }
    function termina() {
      clearTimeout(fin);
      archivos.forEach(a => { a.li.remove(); a.papel.remove(); });
      archivos = []; rnd = azar(7); saliendo = false;
      zona.style.height = '';
      progreso.style.strokeDasharray = '0 1';
      zona.classList.remove('is-ocupada', 'is-lista', 'is-saliendo');
      zona.classList.add('is-volviendo');
      escena.classList.remove('is-ocupada');
      dice(reposo, '');
      mide();
      anima();
    }

    /* ── eventos ───────────────────────────────────────────────────── */
    function elige(desde) {
      if (archivos.length) return;
      if (o.simula) agrega(o.simula, desde); else input.click();
    }
    const enZona = ev => ({ x: ev.pageX - X0, y: ev.pageY - Y0 });
    function sigue(ev) {
      if (ev.pointerType === 'touch') return;
      const p = enZona(ev);
      px = p.x; py = p.y; conPuntero = true;
      anima();
    }
    addEventListener('pointermove', sigue, { passive: true });
    addEventListener('pointerdown', sigue, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { conPuntero = false; anima(); });
    // pasar por encima (con el cursor o arrastrando algo) la hace abrir del todo el abanico
    const marca = si => {
      encima = si && !archivos.length;
      zona.classList.toggle('is-encima', encima);
      anima();
    };
    zona.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') marca(true); });
    zona.addEventListener('pointerleave', () => marca(false));
    zona.addEventListener('click', ev => elige(ev.detail ? enZona(ev) : null));
    zona.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elige(null); } });
    input.addEventListener('change', () => { if (input.files.length) agrega(input.files); input.value = ''; });
    addEventListener('dragover', e => { const p = enZona(e); px = p.x; py = p.y; conPuntero = true; anima(); });
    zona.addEventListener('dragover', e => { e.preventDefault(); if (!encima) marca(true); });
    zona.addEventListener('dragleave', e => { if (!zona.contains(e.relatedTarget)) marca(false); });
    zona.addEventListener('drop', e => { e.preventDefault(); marca(false); if (e.dataTransfer.files.length) agrega(e.dataTransfer.files, enZona(e)); });
    addEventListener('resize', () => { if (!archivos.length) altoBase = zona.offsetHeight; mide(); anima(); });

    altoBase = zona.offsetHeight;
    mide();
    anima();
    return { agrega, limpia };
  }

  window.Arrastre = Arrastre;
})();
