/* =====================================================================
   Canica · Moxen
   Un interruptor cuya perilla es una canica de vidrio que rueda por un
   carril tallado en arcilla. Al encenderlo la canica acelera a lo largo
   del carril, golpea el tope con un destello, rebota dos o tres veces
   cada vez más bajito (restitución ≈ .38) y se queda quieta; el carril se
   llena de rosa justo hasta su centro y en el vidrio se ve, invertido y
   ampliado, ese mismo borde (refracción falsa). El remolino de dentro gira
   según lo rodado (ángulo = distancia / radio) y la sombra se estira, se
   corre y se ablanda con la velocidad y al levantar la canica. La canica
   también se arrastra con el ratón o el dedo: sigue al puntero y, al
   soltarla, decide por su posición y su velocidad si se queda o vuelve.
   Con el teclado es un role="switch" de verdad: Espacio o Intro alternan
   y las flechas izquierda y derecha apagan y encienden.

     <main data-canica> … </main>             (se monta solo)
     <button class="cn-int" role="switch" aria-checked="false"
             aria-labelledby="id-del-nombre" data-int="wifi"
             data-texto-on="Conectado" data-texto-off="Sin conexión">
       … (el carril y la canica, como en index.html)
     </button>
     <button class="cn-int cn-int--g" …>      (la versión grande)
     data-activo                               (empieza encendido)

     const c = Canica(document.querySelector('[data-canica]'), {
       gravedad: 1,        // 1 = tal cual; más alto, rueda más rápido
       rebote: .38,        // restitución del golpe en el tope (0 = sin rebote)
       alCambiar: (id, activo) => {},    // aquí va tu lógica (se llama al decidir, antes de que llegue al tope)
     });
     c.fija('wifi', true);   c.alterna('wifi');   c.estado('wifi');   c.activos();

   Personalizar: los tamaños de cada interruptor, en --cn-w, --cn-h y --cn-p
   (ancho, alto y margen del carril; la canica mide alto menos dos márgenes);
   los colores de la arcilla, del relleno (--cn-rosa) y del vidrio (--cn-v-*),
   en las variables del principio de canica.css. La física está en FISICA.
   Solo se anima transform y opacity; sin dependencias.
   ===================================================================== */
(function () {
  'use strict';

  const FISICA = {
    g0: 800, gL: 20,       // gravedad a lo largo del carril: g0 + gL × recorrido (px/s²)
    roce: 1.4,             // rodadura (frena un poco)
    paso: 1 / 240,         // paso fijo de la simulación (s)
    patada: 1.2,           // impulso inicial al pulsar, por recorrido (px/s por px)
    sigue: 46,             // qué tan pegada va la canica al puntero al arrastrarla
    proyecta: .12,         // segundos de velocidad que se suman a la posición al soltar
    minGolpe: .06,         // fuerza relativa mínima para que un rebote haga destello
  };

  /* ── resortes (los de acceso.js) ──────────────────────────────────── */
  const resorte = (x, k, c) => ({ x, v: 0, meta: x, k, c });
  function avanza(r, h) { r.v += (r.k * (r.meta - r.x) - r.c * r.v) * h; r.x += r.v * h; }
  // un resorte convertido en curva CSS linear(), para lo que se anima con la Web Animations API
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
    return { easing: 'linear(' + out.join(', ') + ')', duration: Math.round(t * 1000) };
  }
  const limita = (v, a, b) => Math.max(a, Math.min(b, v));

  function Canica(raiz, opciones) {
    const o = Object.assign({ gravedad: 1, rebote: .38, alCambiar: null }, opciones);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const MUELLE = muelle(210, 17), POP = muelle(300, 11);
    const vivo = raiz.querySelector('[data-vivo]');
    const total = raiz.querySelectorAll('.cn-int').length;
    if (reduce) raiz.classList.add('cn-quieto');

    /* ── un texto que rueda: el viejo sube y se va, el nuevo entra desde abajo ── */
    function Rueda(el) {
      let actual = el.firstElementChild;
      return texto => {
        if (actual.textContent === texto) return;
        const viejo = actual, nuevo = document.createElement('span');
        nuevo.textContent = texto; el.appendChild(nuevo); actual = nuevo;
        if (reduce) { viejo.remove(); return; }
        viejo.animate([{ transform: 'none', opacity: 1, filter: 'blur(0)' }, { transform: 'translateY(-60%)', opacity: 0, filter: 'blur(2px)' }],
          { duration: 230, easing: 'cubic-bezier(.5, 0, .9, .5)', fill: 'forwards' }).onfinish = () => viejo.remove();
        nuevo.animate([{ transform: 'translateY(70%)', opacity: 0, filter: 'blur(2px)' }, { transform: 'none', opacity: 1, filter: 'blur(0)' }], MUELLE);
      };
    }
    const cuenta = Rueda(raiz.querySelector('[data-cuenta]'));

    /* ── el motor: un bucle para todos los interruptores despiertos ─────── */
    const despiertos = new Set();
    let raf = 0, antes = 0, acc = 0;
    function tick(ts) {
      raf = 0;
      const dt = antes ? Math.min(.05, (ts - antes) / 1000) : 0;
      antes = ts; acc += dt;
      while (acc >= FISICA.paso) { despiertos.forEach(s => s.paso(FISICA.paso)); acc -= FISICA.paso; }
      despiertos.forEach(s => { s.pinta(); if (s.dormido()) despiertos.delete(s); });
      if (despiertos.size) raf = requestAnimationFrame(tick); else { antes = 0; acc = 0; }
    }
    function despierta(s) { despiertos.add(s); if (!raf) raf = requestAnimationFrame(tick); }

    /* ── un interruptor ───────────────────────────────────────────────── */
    function Interruptor(el) {
      const $ = s => el.querySelector(s);
      const canica = $('.cn-canica'), vidrio = $('.cn-vidrio'), refrac = $('.cn-refrac'), remolino = $('.cn-remolino');
      const relleno = $('.cn-relleno'), luz = $('.cn-luz'), sombra = $('.cn-sombra'), tink = $('.cn-tink');
      const ondas = Array.from(el.querySelectorAll('.cn-onda'));
      const fila = el.closest('[data-fila]'), icono = fila && fila.querySelector('.cn-icono');
      const estado = fila && Rueda(fila.querySelector('[data-estado]'));
      const id = el.dataset.int || '';
      const tOn = el.dataset.textoOn || 'Activado', tOff = el.dataset.textoOff || 'Desactivado';
      const nombre = () => { const n = document.getElementById(el.getAttribute('aria-labelledby')); return n ? n.textContent.trim() : id; };

      let W = 0, H = 0, pad = 0, D = 0, r = 0, L = 1, G = 1, VREF = 1;
      let x = 0, v = 0, rot = 0, vs = 0;            // posición (0 … L), velocidad, giro (grados) y velocidad suavizada
      let activo = el.hasAttribute('data-activo'), pendiente = false, reposo = true, ar = null, suprime = false, onda = 0;
      const sq = resorte(0, 430, 15), up = resorte(0, 300, 21);
      let lado = 1;                                  // hacia qué tope se aplasta
      el.setAttribute('aria-checked', String(activo));
      const pone = () => { if (fila) fila.classList.toggle('is-on', activo); };

      /* medidas: salen del CSS, así que cada interruptor puede tener su tamaño */
      function mide() {
        const progreso = L ? x / L : (activo ? 1 : 0);
        W = el.clientWidth; H = el.clientHeight; D = canica.offsetWidth; r = D / 2; pad = (H - D) / 2;
        L = Math.max(1, W - 2 * pad - D);
        G = (FISICA.g0 + FISICA.gL * L) * o.gravedad;
        VREF = Math.sqrt(2 * G * L);
        x = limita(progreso, 0, 1) * L;
        pinta();
      }

      /* ── cada cuadro: todo sale de x, v y los resortes ───────────────── */
      function pinta() {
        const prog = x / L, vel = v, centro = pad + r + x;
        // el borde del relleno va pegado a la canica; en los extremos se esconde (a la izquierda) o cubre todo (a la derecha)
        let borde = centro - 6;
        if (x < r) borde -= (pad + r + 6) * (1 - x / r); else if (x > L - r) borde += (pad + r + 6) * (1 - (L - x) / r);
        const off = borde - centro;                              // dónde queda ese borde respecto al centro de la canica
        canica.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0)';
        relleno.style.transform = 'translate3d(' + (borde - W).toFixed(2) + 'px,0,0)';
        refrac.style.transform = 'translate3d(' + (-off * 1.5).toFixed(2) + 'px,0,0)';
        remolino.style.transform = 'rotate(' + rot.toFixed(2) + 'deg)';
        // el vidrio se aplasta contra el tope y crece un poco al levantarlo
        const s = sq.x, u = up.x;
        vidrio.style.transformOrigin = lado > 0 ? '100% 50%' : '0% 50%';
        vidrio.style.transform = 'scale(' + (1 - s + u * .07).toFixed(3) + ',' + (1 + s * .5 + u * .07).toFixed(3) + ')';
        // la sombra: cae abajo a la derecha, se corre y se estira con la velocidad, y al levantar se ensancha y se aclara
        const alza = limita(u, 0, 1.4), smear = 1 + Math.min(.38, Math.abs(vel) / (VREF * 1.7));
        const ox = D * (.2 + .13 * alza) - vel * .004 * (D / 56), oy = D * (.26 + .14 * alza);
        sombra.style.transform = 'translate3d(' + (pad + x + ox).toFixed(2) + 'px,' + (pad + oy).toFixed(2) + 'px,0) scale(' + (smear * (1 + .1 * alza)).toFixed(3) + ',' + (1 + .08 * alza).toFixed(3) + ')';
        sombra.style.opacity = (1 - .32 * alza).toFixed(3);
        luz.style.transform = 'translate3d(' + (pad + x + D * (.28 + .1 * alza) - vel * .003 * (D / 56)).toFixed(2) + 'px,' + (pad + D * (.3 + .1 * alza)).toFixed(2) + 'px,0) scale(' + (.62 + .12 * alza).toFixed(3) + ')';
        luz.style.opacity = (.55 + .45 * Math.min(1, prog * 1.6)).toFixed(3);
      }

      /* ── la simulación: un paso fijo ───────────────────────────────────── */
      function paso(h) {
        avanza(sq, h); avanza(up, h);
        const x0 = x;
        if (ar && ar.mov) {
          // arrastrando: la canica va tras el puntero con un hilo de retraso
          const meta = limita(ar.tx, 0, L), exceso = ar.tx - meta;
          x += (meta - x) * (1 - Math.exp(-h * FISICA.sigue));
          v = (x - x0) / h;
          vs += (v - vs) * (1 - Math.exp(-h * 32));
          if (Math.abs(exceso) > 4) { lado = exceso > 0 ? 1 : -1; sq.x = Math.max(sq.x, Math.min(.16, Math.abs(exceso) / 150)); sq.v = 0; }
        } else if (!reposo) {
          const dir = activo ? 1 : -1;
          v += (G * dir - FISICA.roce * v) * h;
          x += v * h;
          if (x >= L && v > 0) choca(1); else if (x <= 0 && v < 0) choca(-1);
        }
        rot += (x - x0) / r * 57.2958;
      }
      function choca(dir) {
        const vi = Math.abs(v), f = vi / VREF, nuevo = vi * o.rebote;
        x = dir > 0 ? L : 0;
        const meta = (dir > 0) === activo;
        if (meta && nuevo < VREF * .02) { v = 0; reposo = true; } else v = -dir * nuevo;
        if (f > FISICA.minGolpe || (pendiente && meta)) golpe(dir, Math.min(1, f), meta);
        if (meta && reposo) acaba();
      }

      /* ── la recompensa: destello, ondas, aplastón y el cambio de etiqueta ── */
      function golpe(dir, f, meta) {
        lado = dir; sq.x = .06 + .15 * f; sq.v = 0;
        if (meta && pendiente) aplica();
        if (reduce) return;
        const cx = dir > 0 ? W - pad : pad;                  // dónde toca el vidrio con el tope
        tink.style.left = (cx + (dir > 0 ? -D * .06 : D * .06)) + 'px'; tink.style.top = (H / 2 - D * .24) + 'px';
        tink.animate([
          { opacity: 0, transform: 'scale(.2) rotate(-22deg)' },
          { opacity: 1, transform: 'scale(' + (.55 + .7 * f).toFixed(2) + ') rotate(8deg)', offset: .26 },
          { opacity: 0, transform: 'scale(' + (.3 + .3 * f).toFixed(2) + ') rotate(38deg)' }], { duration: 470, easing: 'cubic-bezier(.2, .7, .3, 1)' });
        vidrio.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(' + (1.1 + .16 * f).toFixed(2) + ') saturate(1.12)', offset: .16 }, { filter: 'brightness(1)' }], { duration: 400, easing: 'ease-out' });
        const n = f > .5 ? 3 : f > .2 ? 2 : 1;                 // los golpes fuertes sueltan más ondas
        for (let k = 0; k < n; k++) {
          const w = ondas[onda++ % ondas.length], pos = 'translateX(' + (cx - r) + 'px) ';
          w.animate([{ opacity: (.95 - k * .22) * (.45 + .55 * f), transform: pos + 'scale(.5)' }, { opacity: 0, transform: pos + 'scale(' + (1.7 + 1.5 * f + k * .45).toFixed(2) + ')' }],
            { duration: 640 + 130 * k, delay: k * 120, easing: 'cubic-bezier(.2, .65, .3, 1)', fill: 'backwards' });
        }
      }
      // lo que cambia cuando la canica llega a su tope: la etiqueta, el disco del ícono y la cuenta
      function aplica() {
        pendiente = false; pone();
        if (estado) estado(activo ? tOn : tOff);
        if (icono && !reduce) icono.animate([{ transform: 'scale(.8)' }, { transform: 'none' }], POP);
        api.cuenta();
        if (vivo) { vivo.textContent = ''; vivo.textContent = nombre() + (activo ? ': activado' : ': desactivado'); }
      }
      function acaba() { if (pendiente) aplica(); }

      /* ── decidir: de dónde a dónde ─────────────────────────────────────── */
      function cambia(nuevo, avisa) {
        if (nuevo === activo) return;
        activo = nuevo; pendiente = true;
        el.setAttribute('aria-checked', String(activo));
        if (o.alCambiar && avisa !== false) o.alCambiar(id, activo);
      }
      function alterna() {
        cambia(!activo);
        const d = activo ? 1 : -1;
        if (reduce) { x = activo ? L : 0; v = 0; reposo = true; aplica(); pinta(); return; }
        v = d * Math.max(FISICA.patada * L, v * d);          // un empujoncito en la dirección nueva (o la que ya llevaba)
        reposo = false; despierta(self);
      }
      function fija(valor) {                                   // sin rodar: para el estado inicial o desde fuera
        activo = !!valor; pendiente = false; el.setAttribute('aria-checked', String(activo));
        x = activo ? L : 0; v = 0; reposo = true; pone(); pinta();
        if (estado) estado(activo ? tOn : tOff);
        api.cuenta();
      }

      /* ── puntero: la canica se agarra y se arrastra (ratón y dedo) ──────── */
      el.addEventListener('pointerdown', ev => {
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        const rc = canica.getBoundingClientRect(), cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
        const enBola = Math.hypot(ev.clientX - cx, ev.clientY - cy) <= r * 1.35;
        ar = { id: ev.pointerId, x0: ev.clientX, mov: false, enBola, dx: cx - ev.clientX, tx: x };
        suprime = false; up.meta = enBola ? 1 : 0;
        try { el.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura también funciona */ }
        despierta(self);
      });
      // al pasar el ratón por la canica se levanta un poco (en el dedo no hay «pasar»)
      const sobreBola = ev => { const rc = canica.getBoundingClientRect(); return Math.hypot(ev.clientX - rc.left - rc.width / 2, ev.clientY - rc.top - rc.height / 2) <= r * 1.2; };
      el.addEventListener('pointermove', ev => {
        if (!ar && ev.pointerType === 'mouse') { const m = sobreBola(ev) ? .3 : 0; if (m !== up.meta) { up.meta = m; despierta(self); } return; }
        if (!ar || ev.pointerId !== ar.id) return;
        if (!ar.mov && Math.abs(ev.clientX - ar.x0) > 5) {
          ar.mov = true; reposo = false; v = 0; vs = 0; up.meta = 1; el.classList.add('is-arrastra');
        }
        if (ar.mov) ar.tx = ev.clientX + (ar.enBola ? ar.dx : 0) - el.getBoundingClientRect().left - pad - r;
      });
      const suelta = ev => {
        if (!ar || ev.pointerId !== ar.id) return;
        const arrastro = ar.mov;
        ar = null; up.meta = 0; el.classList.remove('is-arrastra');
        try { el.releasePointerCapture(ev.pointerId); } catch (e) { /* ya estaba suelto */ }
        if (!arrastro) return;                                  // un clic sin arrastre lo resuelve «click»
        suprime = true; setTimeout(() => { suprime = false; }, 60);
        // decide por la posición y por lo rápido que iba
        cambia(x + vs * FISICA.proyecta > L / 2);
        v = limita(vs, -VREF * 1.3, VREF * 1.3); reposo = false;
        if (reduce) { x = activo ? L : 0; v = 0; reposo = true; aplica(); pinta(); }
        despierta(self);
      };
      el.addEventListener('pointerleave', () => { if (!ar && up.meta) { up.meta = 0; despierta(self); } });
      el.addEventListener('pointerup', suelta);
      el.addEventListener('pointercancel', suelta);
      el.addEventListener('lostpointercapture', suelta);
      el.addEventListener('click', () => { if (suprime) { suprime = false; return; } alterna(); });
      el.addEventListener('keydown', ev => {                    // además de Espacio e Intro (el botón ya los entiende)
        if (ev.key === 'ArrowRight' && !activo) { ev.preventDefault(); alterna(); }
        else if (ev.key === 'ArrowLeft' && activo) { ev.preventDefault(); alterna(); }
      });

      const self = {
        el, id,
        paso, pinta, alterna, fija, mide,
        get activo() { return activo; },
        dormido: () => !ar && reposo && Math.abs(sq.x) < .002 && Math.abs(sq.v) < .02 && Math.abs(up.x - up.meta) < .002 && Math.abs(up.v) < .02,
      };
      mide();
      x = activo ? L : 0; pone(); pinta();
      if (estado) estado(activo ? tOn : tOff);
      if (window.ResizeObserver) new ResizeObserver(() => mide()).observe(el);
      return self;
    }

    const lista = Array.from(raiz.querySelectorAll('.cn-int')).map(Interruptor);
    const porId = id => lista.find(s => s.id === id);
    const api = {
      cuenta() { cuenta(lista.filter(s => s.activo).length + ' de ' + total + ' activos'); },
      fija(id, valor) { const s = porId(id); if (s) s.fija(valor); },
      alterna(id) { const s = porId(id); if (s) s.alterna(); },
      estado(id) { const s = porId(id); return s ? s.activo : null; },
      activos() { return lista.filter(s => s.activo).map(s => s.id); },
    };
    api.cuenta();
    return api;
  }

  window.Canica = Canica;
  document.querySelectorAll('[data-canica]').forEach(el => { el.canica = Canica(el); });
})();
